import type { PadOutcome } from '@/domain/scoring/padLine';
import type { BootCache, MatchQueue } from '@/domain/scoring/queue';
import {
  openMatch,
  step,
  type MatchEffect,
  type MatchEvent,
  type MatchState,
} from '@/domain/scoring/scoringMatch';
import type { LedgerEvent } from '@/domain/scoring/wire';
import type { Ports } from '@/hooks/usePorts';
import { readScoringLink } from '@/services/scoringLinkStore';
import type { ScoringLink } from '@/services/scoringPort';

/**
 * The effectful half of one match (plan S2-1 Task 9), around the pure reducer in `scoringMatch.ts`: it owns the state
 * of the latest step, runs each effect in the order the reducer gave it, and hands every result back as an event. It
 * decides nothing about the match: a save before a send, one fetch at a time and the rest of the rules are the reducer's
 * (what to do) and this file's (doing it, once, in order).
 *
 * Two modes. `focused`: the pad is on screen, so it folds and judges the match, reads the bootstrap, and a live owner
 * (`scoringLive.ts`) keeps it told of other scorers. `headless`: the background sender for a match nobody is looking at
 * (ruling 29): it sends the queue's taps in order and lets the server judge each one, never folds, never reads the
 * bootstrap, never touches Realtime.
 */

export type RunnerPorts = Pick<
  Ports,
  'scoring' | 'tapQueue' | 'kv' | 'foreground' | 'clock' | 'logger'
>;

export type RunnerMode = 'focused' | 'headless';

/** What the match is before it is playing: being read, with no link saved, or with a file this phone cannot read. */
export type RunnerSnapshot =
  | { readonly kind: 'loading' }
  | { readonly kind: 'noLink' }
  | { readonly kind: 'unreadable'; readonly what: 'queue' | 'link' }
  | { readonly kind: 'ready'; readonly state: MatchState };

const LOADING: RunnerSnapshot = { kind: 'loading' };

export type ScoringRunner = {
  readonly fixtureId: string;
  readonly mode: RunnerMode;
  /** Reads the files and opens the match; resolves once the first reads are on their way. */
  start(): Promise<void>;
  /** Stops everything this runner does and waits for the saves already made; nothing is sent after it. */
  stop(): Promise<void>;
  /** One event to the reducer, on the latest state. Returns what a tap came to, or null for any other event. */
  dispatch(event: MatchEvent): PadOutcome | null;
  subscribe(listener: () => void): () => void;
  snapshot(): RunnerSnapshot;
  /** The link this runner reads with, once loaded: for the live owner. */
  link(): ScoringLink | null;
};

type Options = {
  readonly fixtureId: string;
  readonly mode: RunnerMode;
  /** Said once, when a headless runner has nothing left to send (its queue is empty, or dead): the hub lets it go. */
  readonly onIdle?: () => void;
};

const emptyQueue = (fixtureId: string): MatchQueue => ({
  fixtureId,
  label: '',
  pending: [],
  ownEventIds: [],
  dead: null,
});

export function createScoringRunner(ports: RunnerPorts, options: Options): ScoringRunner {
  const { fixtureId, mode } = options;
  let snapshot: RunnerSnapshot = LOADING;
  let state: MatchState | null = null;
  let link: ScoringLink | null = null;
  let stopped = false;
  let started = false;
  let idled = false;
  let unsettled = 0;
  let lastSave: Promise<boolean> = Promise.resolve(true);
  let fetching = false;
  let fetchAgain = false;
  let wakeTimer: { at: number; id: ReturnType<typeof setTimeout> } | null = null;
  const listeners = new Set<() => void>();
  const leaving: Array<() => void> = [];

  const publish = (next: RunnerSnapshot): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const now = (): number => ports.clock().getTime();

  // --- effects --------------------------------------------------------------------------------------------------

  const dispatch = (event: MatchEvent): PadOutcome | null => {
    if (stopped || state === null) return null;
    const result = step(state, event, now());
    state = result.state;
    result.effects.forEach(run);
    if (unsettled === 0) publish({ kind: 'ready', state });
    idleCheck(state);
    return result.outcome;
  };

  /** A headless sender with nothing left to send says so once: the hub lets it go. */
  const idleCheck = (now_: MatchState): void => {
    if (mode !== 'headless' || idled || options.onIdle === undefined) return;
    const { queue } = now_.sync;
    if (queue.dead === null && queue.pending.length > 0) return;
    idled = true;
    options.onIdle();
  };

  /** One save, in order behind the last: the queue (whose failure the reducer is told), then the two caches. */
  const save = (effect: Extract<MatchEffect, { kind: 'save' }>): void => {
    const owesTap = effect.tap !== null && effect.queue !== null;
    if (owesTap) unsettled += 1;
    const previous = lastSave;
    lastSave = previous.then(() => persist(effect)).then((ok) => settled(effect, ok, owesTap));
  };

  const persist = async (effect: Extract<MatchEffect, { kind: 'save' }>): Promise<boolean> => {
    const { tapQueue, logger } = ports;
    if (effect.boot !== null)
      await cached(() => tapQueue.saveBoot(fixtureId, effect.boot as BootCache));
    if (effect.ledger !== null) {
      const ledger = effect.ledger;
      await cached(() => tapQueue.saveLedger(fixtureId, ledger));
    }
    if (effect.queue === null) return true;
    try {
      await tapQueue.save(effect.queue);
      return true;
    } catch {
      logger.warn('scoring.queue.saveFailed', {});
      return false;
    }
  };

  /** A cache that cannot be written costs the next reopen a network read, never a tap: said, not thrown. */
  const cached = async (write: () => Promise<void>): Promise<void> => {
    try {
      await write();
    } catch {
      ports.logger.warn('scoring.cache.saveFailed', {});
    }
  };

  const settled = (
    effect: Extract<MatchEffect, { kind: 'save' }>,
    ok: boolean,
    owesTap: boolean,
  ): boolean => {
    if (owesTap) unsettled -= 1;
    if (effect.queue !== null)
      dispatch(ok ? { kind: 'saved' } : { kind: 'saveFailed', key: effect.tap });
    else if (unsettled === 0 && state !== null && !stopped) publish({ kind: 'ready', state });
    return ok;
  };

  /** A send goes only after every save before it has landed, and never from a stopped runner or a backgrounded app. */
  const send = (effect: Extract<MatchEffect, { kind: 'send' }>): void => {
    void (async () => {
      const landed = await lastSave;
      if (stopped || link === null) return;
      if (!landed || !ports.foreground.isForeground()) {
        dispatch({ kind: 'abandoned', key: effect.sent.key });
        return;
      }
      const answer = await ports.scoring.append(link, fixtureId, effect.body);
      dispatch({ kind: 'answered', sent: effect.sent, answer });
    })();
  };

  /** One ledger read at a time: a ping that comes while one is out asks for one more after it, not for one each. */
  const fetchLedger = (): void => {
    if (fetching) {
      fetchAgain = true;
      return;
    }
    fetching = true;
    void (async () => {
      do {
        fetchAgain = false;
        const since = state?.sync.tip ?? 0;
        if (link === null) break;
        const read = await ports.scoring.events(link, fixtureId, since);
        if ('kind' in read) dispatch({ kind: 'fetchFailed', failure: read });
        else dispatch({ kind: 'fetched', events: read });
      } while (fetchAgain && !stopped);
      fetching = false;
    })();
  };

  const loadRules = (): void => {
    void (async () => {
      if (link === null) return;
      const read = await ports.scoring.rules(link, fixtureId);
      if ('cfg' in read) dispatch({ kind: 'rulesRead', rules: read });
      else dispatch({ kind: 'rulesFailed', failure: read });
    })();
  };

  const loadBootstrap = (): void => {
    void (async () => {
      if (link === null) return;
      const read = await ports.scoring.bootstrap(link);
      if (read.kind === 'ok') dispatch({ kind: 'bootstrapRead', bootstrap: read.bootstrap });
      else dispatch({ kind: 'bootstrapFailed', failure: read });
    })();
  };

  /** One timer, at the earliest time asked for: a tick finds out what is due (`step` asks sync again). */
  const wake = (ms: number): void => {
    const at = now() + ms;
    if (wakeTimer !== null && wakeTimer.at <= at) return;
    if (wakeTimer !== null) clearTimeout(wakeTimer.id);
    const id = setTimeout(() => {
      wakeTimer = null;
      dispatch({ kind: 'tick' });
    }, ms);
    wakeTimer = { at, id };
  };

  const run = (effect: MatchEffect): void => {
    switch (effect.kind) {
      case 'save':
        return save(effect);
      case 'send':
        return send(effect);
      case 'fetch':
        return fetchLedger();
      case 'loadRules':
        return loadRules();
      case 'loadBootstrap':
        return loadBootstrap();
      case 'wake':
        return wake(effect.ms);
    }
  };

  // --- loading --------------------------------------------------------------------------------------------------

  const load = async (): Promise<RunnerSnapshot | { kind: 'open'; open: Opened }> => {
    const stored = await readScoringLink(ports.kv, fixtureId);
    if (stored.kind === 'failed') return { kind: 'unreadable', what: 'link' };
    if (stored.kind === 'none') return { kind: 'noLink' };
    ports.logger.protectLink(stored.link.token);
    link = stored.link;
    const [queue, ledger, boot] = await Promise.all([
      ports.tapQueue.load(fixtureId),
      ports.tapQueue.loadLedger(fixtureId),
      mode === 'focused' ? ports.tapQueue.loadBoot(fixtureId) : Promise.resolve(null),
    ]);
    if (queue === null && (await unreadableQueue(ports, fixtureId))) {
      return { kind: 'unreadable', what: 'queue' };
    }
    return {
      kind: 'open',
      open: { queue: queue ?? emptyQueue(fixtureId), ledger: ledger ?? [], boot },
    };
  };

  const open = (loaded: Opened): void => {
    const rulesVersion = Math.max(1, ...loaded.queue.pending.map((tap) => tap.rulesVersion));
    const opened = openMatch(
      {
        queue: loaded.queue,
        ledger: loaded.ledger,
        bootstrap: loaded.boot?.bootstrap ?? null,
        toss: loaded.boot?.toss ?? null,
        judge: mode === 'focused' ? 'fold' : 'trust',
        foreground: ports.foreground.isForeground(),
        rulesVersion: loaded.boot?.bootstrap.rulesVersion ?? rulesVersion,
      },
      now(),
    );
    state = opened.state;
    opened.effects.forEach(run);
    publish({ kind: 'ready', state });
    leaving.push(
      ports.foreground.subscribe(() => dispatch({ kind: 'foreground' })),
      ports.foreground.subscribeBackground(() => dispatch({ kind: 'background' })),
    );
  };

  const start = async (): Promise<void> => {
    if (started) return;
    started = true;
    const loaded = await load().catch(unreadable);
    if (stopped) return;
    if (loaded.kind !== 'open') return publish(loaded);
    open(loaded.open);
  };

  const stop = async (): Promise<void> => {
    stopped = true;
    leaving.splice(0).forEach((leave) => leave());
    if (wakeTimer !== null) clearTimeout(wakeTimer.id);
    wakeTimer = null;
    await lastSave;
  };

  return {
    fixtureId,
    mode,
    start,
    stop,
    dispatch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => snapshot,
    link: () => link,
  };
}

type Opened = {
  readonly queue: MatchQueue;
  readonly ledger: readonly LedgerEvent[];
  readonly boot: BootCache | null;
};

/** A store that throws instead of answering (a native module that is missing) is a queue this phone cannot read: said, not silent. */
const unreadable = (): RunnerSnapshot => ({ kind: 'unreadable', what: 'queue' });

/** `load` answers null for none and for a file that cannot be read: the list tells them apart (`unreadable`). */
async function unreadableQueue(ports: RunnerPorts, fixtureId: string): Promise<boolean> {
  const entries = await ports.tapQueue.list();
  return entries.some((entry) => entry.kind === 'unreadable' && entry.fixtureId === fixtureId);
}
