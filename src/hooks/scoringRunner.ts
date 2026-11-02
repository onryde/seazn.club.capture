import type { PadOutcome } from '@/domain/scoring/padLine';
import type { BootCache, MatchQueue } from '@/domain/scoring/queue';
import {
  openMatch,
  step,
  wakeAt,
  type MatchEffect,
  type MatchEvent,
  type MatchState,
} from '@/domain/scoring/scoringMatch';
import type { LedgerEvent, ReadFailure } from '@/domain/scoring/wire';
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
  'scoring' | 'tapQueue' | 'kv' | 'foreground' | 'clock' | 'logger' | 'hosts'
>;

export type RunnerMode = 'focused' | 'headless';

/** What the match is before it is playing: being read, with no link saved, or with a file this phone cannot read. */
export type RunnerSnapshot =
  | { readonly kind: 'loading' }
  | { readonly kind: 'noLink' }
  | { readonly kind: 'unreadable'; readonly what: 'queue' | 'link' }
  | { readonly kind: 'ready'; readonly state: MatchState };

const LOADING: RunnerSnapshot = { kind: 'loading' };
const OFFLINE: ReadFailure = { kind: 'offline' };

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
  const sending = new Set<Promise<void>>();
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
    arm(state);
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
      dispatch(ok ? { kind: 'saved', n: effect.n } : { kind: 'saveFailed', key: effect.tap });
    else if (unsettled === 0 && state !== null && !stopped) publish({ kind: 'ready', state });
    return ok;
  };

  /** A send goes only after every save before it has landed, and never from a stopped runner or a backgrounded app. */
  const send = (effect: Extract<MatchEffect, { kind: 'send' }>): void => {
    const call = (async () => {
      const landed = await lastSave;
      const held = link;
      if (stopped || held === null) return;
      if (!landed || !ports.foreground.isForeground()) {
        dispatch({ kind: 'abandoned', key: effect.sent.key });
        return;
      }
      const answer = await answered(() => ports.scoring.append(held, fixtureId, effect.body));
      if (answer === null) dispatch({ kind: 'abandoned', key: effect.sent.key });
      else dispatch({ kind: 'answered', sent: effect.sent, answer });
    })();
    sending.add(call);
    void call.finally(() => sending.delete(call));
  };

  /**
   * A port call, its answer or null if it threw. The port's contract is that no call rejects; one that does (a native
   * module that fell over) must still end as a failed call, never as a read or a send left in flight for good.
   */
  const answered = async <T>(call: () => Promise<T>): Promise<T | null> => {
    try {
      return await call();
    } catch {
      ports.logger.warn('scoring.call.threw', {});
      return null;
    }
  };

  /**
   * A read that is asked for again while it is out is one more read after it, not one each. `read` does one read and
   * hands the answer to the reducer; it comes back before the next starts. A stopped runner starts no more.
   */
  const coalesced = (read: () => Promise<void>): (() => void) => {
    let out = false;
    let again = false;
    return () => {
      if (out) {
        again = true;
        return;
      }
      out = true;
      void (async () => {
        try {
          do {
            again = false;
            await read();
          } while (again && !stopped);
        } finally {
          out = false;
        }
      })();
    };
  };

  const readLedger = async (): Promise<void> => {
    const held = link;
    if (held === null) return;
    const read = await answered(() => ports.scoring.events(held, fixtureId, state?.sync.tip ?? 0));
    if (read === null) dispatch({ kind: 'fetchFailed', failure: OFFLINE });
    else if ('kind' in read) dispatch({ kind: 'fetchFailed', failure: read });
    else dispatch({ kind: 'fetched', events: read });
  };

  const readRules = async (): Promise<void> => {
    const held = link;
    if (held === null) return;
    const read = await answered(() => ports.scoring.rules(held, fixtureId));
    if (read === null) dispatch({ kind: 'rulesFailed', failure: OFFLINE });
    else if ('cfg' in read) dispatch({ kind: 'rulesRead', rules: read });
    else dispatch({ kind: 'rulesFailed', failure: read });
  };

  const readBootstrap = async (): Promise<void> => {
    const held = link;
    if (held === null) return;
    const read = await answered(() => ports.scoring.bootstrap(held));
    if (read === null) dispatch({ kind: 'bootstrapFailed', failure: OFFLINE });
    else if (read.kind === 'ok') dispatch({ kind: 'bootstrapRead', bootstrap: read.bootstrap });
    else dispatch({ kind: 'bootstrapFailed', failure: read });
  };

  const fetchLedger = coalesced(readLedger);
  const loadRules = coalesced(readRules);
  const loadBootstrap = coalesced(readBootstrap);

  /**
   * One timer, at the earliest wait still ahead in the state (`wakeAt`), set again after every step: a wait that comes
   * after another is armed when the first has passed. A tick finds out what is due (`step` asks sync again).
   */
  const arm = (next: MatchState): void => {
    const at = wakeAt(next, now());
    if (wakeTimer !== null && wakeTimer.at === at) return;
    if (wakeTimer !== null) clearTimeout(wakeTimer.id);
    wakeTimer = null;
    if (at === null) return;
    const id = setTimeout(
      () => {
        wakeTimer = null;
        dispatch({ kind: 'tick' });
      },
      Math.max(0, at - now()),
    );
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
    }
  };

  // --- loading --------------------------------------------------------------------------------------------------

  const load = async (): Promise<RunnerSnapshot | { kind: 'open'; open: Opened }> => {
    const stored = await readScoringLink(ports.kv, fixtureId, ports.hosts[0] ?? '');
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
    await Promise.all([lastSave, ...sending]);
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
