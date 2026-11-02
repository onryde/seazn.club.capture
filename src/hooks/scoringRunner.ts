import type { PadOutcome } from '@/domain/scoring/padLine';
import type { BootCache, MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step, wakeAt } from '@/domain/scoring/scoringMatch';
import type {
  MatchEffect,
  MatchEvent,
  MatchHeld,
  MatchState,
  SaveEffect,
} from '@/domain/scoring/scoringMatchState';
import type { AnySport } from '@/domain/scoring/scoringSport';
import { sportFor } from '@/domain/scoring/sports';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { createReads } from '@/hooks/scoringRunnerReads';
import { createSaver } from '@/hooks/scoringRunnerSaves';
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

/**
 * What the match is before it is playing: being read, with no link saved, with a file this phone cannot read, or kept
 * as a sport this build does not score (its link names it), which is never opened.
 */
export type RunnerSnapshot =
  | { readonly kind: 'loading' }
  | { readonly kind: 'noLink' }
  | { readonly kind: 'unreadable'; readonly what: 'queue' | 'link' }
  | { readonly kind: 'unsupportedSport'; readonly sportKey: string }
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

export function createScoringRunner(ports: RunnerPorts, options: Options): ScoringRunner {
  const { fixtureId, mode } = options;
  let snapshot: RunnerSnapshot = LOADING;
  let state: MatchState | null = null;
  let link: ScoringLink | null = null;
  let stopped = false;
  let started = false;
  let idled = false;
  let wakeTimer: { at: number; id: ReturnType<typeof setTimeout> } | null = null;
  const sending = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  const leaving: Array<() => void> = [];

  const publish = (next: RunnerSnapshot): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const now = (): number => ports.clock().getTime();

  // --- the reducer's step ------------------------------------------------------------------------------------------

  const dispatch = (event: MatchEvent): PadOutcome | null => {
    if (stopped || state === null) return null;
    const result = step(state, event, now());
    state = result.state;
    result.effects.forEach(run);
    if (saver.unsettled() === 0) publish({ kind: 'ready', state });
    arm(state);
    idleCheck(state);
    return result.outcome;
  };

  /** A headless sender with nothing left to send says so once: the hub lets it go. */
  const idleCheck = (current: MatchState): void => {
    if (mode !== 'headless' || idled || options.onIdle === undefined) return;
    const { queue } = current.sync;
    if (queue.dead === null && queue.pending.length > 0) return;
    idled = true;
    options.onIdle();
  };

  // --- what the reducer asks for -----------------------------------------------------------------------------------

  /** A queue save is done: the reducer is told; a save of the caches alone only lets the screen show what it holds. */
  const landed = (effect: SaveEffect, ok: boolean): void => {
    if (effect.queue !== null) {
      dispatch(ok ? { kind: 'saved', n: effect.n } : { kind: 'saveFailed', key: effect.tap });
    } else if (saver.unsettled() === 0 && state !== null && !stopped) {
      publish({ kind: 'ready', state });
    }
  };
  const saver = createSaver({ ports, fixtureId, landed });
  const reads = createReads({
    ports,
    fixtureId,
    link: () => link,
    tip: () => state?.sync.tip ?? 0,
    stopped: () => stopped,
    dispatch,
  });

  /** A send goes only after every save before it has landed, and never from a stopped runner or a backgrounded app. */
  const send = (effect: Extract<MatchEffect, { kind: 'send' }>): void => {
    const call = (async () => {
      const saved = await saver.pending();
      const held = link;
      if (stopped || held === null) return;
      if (!saved || !ports.foreground.isForeground()) {
        dispatch({ kind: 'abandoned', key: effect.sent.key });
        return;
      }
      const answer = await reads.answered(() => ports.scoring.append(held, fixtureId, effect.body));
      if (answer === null) dispatch({ kind: 'abandoned', key: effect.sent.key });
      else dispatch({ kind: 'answered', sent: effect.sent, answer });
    })();
    sending.add(call);
    void call.finally(() => sending.delete(call));
  };

  const run = (effect: MatchEffect): void => {
    switch (effect.kind) {
      case 'save':
        return saver.save(effect);
      case 'send':
        return send(effect);
      case 'fetch':
        return reads.fetchLedger();
      case 'loadRules':
        return reads.loadRules();
      case 'loadBootstrap':
        return reads.loadBootstrap();
    }
  };

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

  // --- starting and stopping ---------------------------------------------------------------------------------------

  const open = (loaded: Opened): void => {
    const opened = openMatch(heldOf(loaded, mode, ports.foreground.isForeground()), now());
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
    const loaded = await loadMatch(ports, fixtureId, mode, (found) => (link = found)).catch(
      unreadable,
    );
    if (stopped) return;
    if (loaded.kind !== 'open') return publish(loaded);
    open(loaded.open);
  };

  const stop = async (): Promise<void> => {
    stopped = true;
    leaving.splice(0).forEach((leave) => leave());
    if (wakeTimer !== null) clearTimeout(wakeTimer.id);
    wakeTimer = null;
    await Promise.all([saver.pending(), ...sending]);
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
  /** The sport the match's link was kept with: the match is scored as it, by every runner, from the start. */
  readonly sport: AnySport;
  readonly queue: MatchQueue;
  readonly ledger: readonly LedgerEvent[];
  readonly boot: BootCache | null;
};

const emptyQueue = (fixtureId: string): MatchQueue => ({
  fixtureId,
  label: '',
  pending: [],
  ownEventIds: [],
  dead: null,
});

/**
 * The link, then the three files: what the match is before it is playing. The link's token is protected in the log
 * before anything is read with it, and handed to `onLink` as soon as it is known (the live owner reads it back). The
 * sport is the link's (`scoringLinkStore`): a match of a sport this build does not score is said, and nothing more is
 * read for it.
 */
async function loadMatch(
  ports: RunnerPorts,
  fixtureId: string,
  mode: RunnerMode,
  onLink: (link: ScoringLink) => void,
): Promise<RunnerSnapshot | { kind: 'open'; open: Opened }> {
  const stored = await readScoringLink(ports.kv, fixtureId, ports.hosts[0] ?? '');
  if (stored.kind === 'failed') return { kind: 'unreadable', what: 'link' };
  if (stored.kind === 'none') {
    await markNoLink(ports, fixtureId);
    return { kind: 'noLink' };
  }
  ports.logger.protectLink(stored.link.token);
  onLink(stored.link);
  const sport = sportFor(stored.sportKey);
  if (sport === null) return { kind: 'unsupportedSport', sportKey: stored.sportKey };
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
    open: { sport, queue: queue ?? emptyQueue(fixtureId), ledger: ledger ?? [], boot },
  };
}

/**
 * Taps queued on a match with no link to send them on (lost, another host's, or never kept) can never go, so the queue
 * is marked dead on its link, which is what makes Home offer Dismiss (behind its confirm) and what a fresh scan of the
 * match revives (plan S2-1 Task 10 review, fix 1). A queue with nothing in it, or dead already, is left as it is. The
 * disk refusing the mark is recorded and nothing more: the runner still says `noLink`.
 */
async function markNoLink(ports: RunnerPorts, fixtureId: string): Promise<void> {
  try {
    const queue = await ports.tapQueue.load(fixtureId);
    if (queue === null || queue.pending.length === 0 || queue.dead !== null) return;
    await ports.tapQueue.save({ ...queue, dead: 'LINK_INVALID' });
  } catch {
    ports.logger.warn('scoring.no-link-mark-refused', {});
  }
}

/**
 * What the reducer opens a match from: the sport its link names, the files, the judge this mode has, and whether the
 * app is in the foreground.
 */
function heldOf(loaded: Opened, mode: RunnerMode, foreground: boolean): MatchHeld {
  const rulesVersion = Math.max(1, ...loaded.queue.pending.map((tap) => tap.rulesVersion));
  return {
    sport: loaded.sport,
    queue: loaded.queue,
    ledger: loaded.ledger,
    bootstrap: loaded.boot?.bootstrap ?? null,
    toss: loaded.boot?.toss ?? null,
    judge: mode === 'focused' ? 'fold' : 'trust',
    foreground,
    rulesVersion: loaded.boot?.bootstrap.rulesVersion ?? rulesVersion,
  };
}

/** A store that throws instead of answering (a native module that is missing) is a queue this phone cannot read: said, not silent. */
const unreadable = (): RunnerSnapshot => ({ kind: 'unreadable', what: 'queue' });

/** `load` answers null for none and for a file that cannot be read: the list tells them apart (`unreadable`). */
async function unreadableQueue(ports: RunnerPorts, fixtureId: string): Promise<boolean> {
  const entries = await ports.tapQueue.list();
  return entries.some((entry) => entry.kind === 'unreadable' && entry.fixtureId === fixtureId);
}
