import type { PadOutcome } from '@/domain/scoring/padLine';
import type { BootCache, MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step, wakeAt } from '@/domain/scoring/scoringMatch';
import { askSaying, type AskSaid } from '@/domain/scoring/scoringMatchAsk';
import { stallOf, type Stall } from '@/domain/scoring/scoringMatchStall';
import {
  type MatchEffect,
  type MatchEvent,
  type MatchHeld,
  type MatchState,
  type SaveEffect,
} from '@/domain/scoring/scoringMatchState';
import type { AnySport } from '@/domain/scoring/scoringSport';
import { sportFor } from '@/domain/scoring/sports';
import { isAsking } from '@/domain/scoring/sync';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { createReads } from '@/hooks/scoringRunnerReads';
import { createSaver } from '@/hooks/scoringRunnerSaves';
import type { Ports } from '@/hooks/usePorts';
import { readScoringLink } from '@/services/scoringLinkStore';
import type { ScoringLink } from '@/services/scoringPort';
import type { LogFields } from '@/services/scrub';

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

/**
 * Where the start of the Undo window of a match this phone decided is kept between runners (the hub's, per match; owner,
 * 2026-11-03). A runner reads it when it opens and writes it whenever its reducer moves it (`MatchState.decidedAt`).
 */
export type UndoStart = {
  readonly read: () => number | null;
  readonly write: (at: number | null) => void;
};

type Options = {
  readonly fixtureId: string;
  readonly mode: RunnerMode;
  /** Said once, when a headless runner has nothing left to send (its queue is empty, or dead): the hub lets it go. */
  readonly onIdle?: () => void;
  /** The Undo window's start, kept by the hub; none for a runner that is on its own (a test's). */
  readonly undoStart?: UndoStart;
};

export function createScoringRunner(ports: RunnerPorts, options: Options): ScoringRunner {
  const { fixtureId, mode } = options;
  let snapshot: RunnerSnapshot = LOADING;
  let state: MatchState | null = null;
  let link: ScoringLink | null = null;
  let stopped = false;
  let started = false;
  let idled = false;
  let stalled: Stall | null = null;
  /** The reconnect question in the record: not said, said and standing, or said moot while a dead link hides it. */
  let asked: AskSaid = 'idle';
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
    if (result.state.decidedAt !== state.decidedAt)
      options.undoStart?.write(result.state.decidedAt);
    state = result.state;
    result.effects.forEach(run);
    if (saver.unsettled() === 0) publish({ kind: 'ready', state });
    arm(state);
    idleCheck(state);
    sayStall(state);
    sayAsk(state, event);
    return result.outcome;
  };

  /**
   * What the record says of the reconnect question (owner ruling 43): the rules are `askSaying`'s. Only the screen's
   * runner says it: a sender with no screen holds the queue without asking, and the screen that opens next asks (and says
   * so).
   */
  const sayAsk = (current: MatchState, event: MatchEvent | null): void => {
    if (mode !== 'focused') return;
    const saying = askSaying(asked, current, event?.kind === 'answerAsk' ? event.answer : null);
    asked = saying.said;
    if (saying.line !== null) ports.logger.info(saying.line.event, { ...saying.line.fields });
  };

  /**
   * A stall (`stallOf`) is said once when it begins and once when it ends, never per step: a taps-that-cannot-go state
   * with no line in the record looks exactly like a phone that is merely slow (recurring failure class 3). The app in the
   * background sends nothing, which `stallOf` reads as no stall: that is not the stall ending, so nothing is said until the
   * app is back and the reading is the stall's own (review, 2026-11-02: no false "over" and "again" across a background).
   */
  const sayStall = (current: MatchState): void => {
    if (!current.foreground) return;
    const now = stallOf(current);
    const was = stalled;
    if (reasonOf(was) === reasonOf(now)) return;
    stalled = now;
    if (was !== null) ports.logger.info('scoring.unstalled', { reason: reasonOf(was) });
    if (now !== null) ports.logger.warn('scoring.stalled', stallFields(current, now));
  };

  /** A headless sender with nothing left to send says so once: the hub lets it go. */
  const idleCheck = (current: MatchState): void => {
    if (mode !== 'headless' || idled || options.onIdle === undefined) return;
    const { queue } = current.sync;
    // A queue held for the scorer's answer has nothing for a sender to do: the screen that opens next owns it.
    if (queue.dead === null && queue.pending.length > 0 && !isAsking(current.sync)) return;
    idled = true;
    options.onIdle();
  };

  // --- what the reducer asks for -----------------------------------------------------------------------------------

  /**
   * A queue save is done: the reducer is told; a save of the caches alone only lets the screen show what it holds. A boot
   * cache is told too, written or not: it holds the scorer's pick and pending picks (S2-4 Batch 2 fix round 1), and a
   * written one takes back a line that said they were not saved (re-review N2).
   */
  const landed = (effect: SaveEffect, ok: boolean, bootOk: boolean): void => {
    if (effect.queue !== null) {
      dispatch(ok ? { kind: 'saved', n: effect.n } : { kind: 'saveFailed', key: effect.tap });
    } else if (saver.unsettled() === 0 && state !== null && !stopped) {
      publish({ kind: 'ready', state });
    }
    if (effect.boot !== null) dispatch(bootOk ? { kind: 'bootSaved' } : { kind: 'bootSaveFailed' });
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
      case 'dropped':
        return sayDropped(effect);
    }
  };

  /**
   * Taps the phone's own check or the server's refusal took out of the queue without counting. The pad says "Not recorded"
   * once on its line; the record says how many and why (spec section 6.3 residual: never silent). The field is `reason`,
   * not `code`: the scrub masks any field named `code`. The word is `CODE_WORD`-checked in the reducer, and no tap, id,
   * payload or URL goes with it.
   */
  const sayDropped = (effect: Extract<MatchEffect, { kind: 'dropped' }>): void => {
    ports.logger.warn('scoring.dropped', { reason: effect.code, count: effect.count });
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
    const decidedAt = options.undoStart?.read() ?? null;
    const opened = openMatch(
      heldOf(loaded, mode, ports.foreground.isForeground(), decidedAt),
      now(),
    );
    state = opened.state;
    opened.effects.forEach(run);
    publish({ kind: 'ready', state });
    sayAsk(state, null);
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

/** A match with no queue file: nothing queued, and the ids of this phone's own taps from before it was left, if kept. */
const emptyQueue = (fixtureId: string, kept: readonly string[]): MatchQueue => ({
  fixtureId,
  label: '',
  pending: [],
  ownEventIds: kept,
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
    await markUnsendable(ports, fixtureId);
    return { kind: 'noLink' };
  }
  ports.logger.protectLink(stored.link.token);
  onLink(stored.link);
  const sport = sportFor(stored.sportKey);
  if (sport === null) {
    await markUnsendable(ports, fixtureId);
    return { kind: 'unsupportedSport', sportKey: stored.sportKey };
  }
  const [queue, ledger, boot] = await Promise.all([
    ports.tapQueue.load(fixtureId),
    ports.tapQueue.loadLedger(fixtureId),
    mode === 'focused' ? ports.tapQueue.loadBoot(fixtureId) : Promise.resolve(null),
  ]);
  if (queue === null && (await unreadableQueue(ports, fixtureId))) {
    return { kind: 'unreadable', what: 'queue' };
  }
  // A match scanned again within a day of being left finds its own taps as they were (owner ruling 46, 2026-11-03).
  const kept =
    queue === null ? await ports.tapQueue.loadKept(fixtureId, ports.clock().getTime()) : null;
  return {
    kind: 'open',
    open: { sport, queue: queue ?? emptyQueue(fixtureId, kept ?? []), ledger: ledger ?? [], boot },
  };
}

/**
 * Taps queued on a match this build cannot send, for want of a link (lost, another host's, or never kept) or of the
 * sport (a sport it does not score), can never go: the queue is marked dead on its link, which is what makes Home offer
 * Dismiss (behind its confirm) instead of counting them as sending, and what a fresh scan of the match revives (plan
 * S2-1 Task 10 review, fix 1; Batch D review, fix 5). A queue with nothing in it, or dead already, is left as it is. The
 * disk refusing the mark is recorded and nothing more: the runner still says what it found. A secure store that does not
 * answer is not this: that says nothing of the link, and nothing is marked.
 */
async function markUnsendable(ports: RunnerPorts, fixtureId: string): Promise<void> {
  try {
    const queue = await ports.tapQueue.load(fixtureId);
    if (queue === null || queue.pending.length === 0 || queue.dead !== null) return;
    await ports.tapQueue.save({ ...queue, dead: 'LINK_INVALID' });
  } catch {
    ports.logger.warn('scoring.queue-mark-refused', {});
  }
}

/**
 * The lowest `rules_version` a match can have: the column's default (`V469__fixture_rules_override.sql`) is 0, and the
 * web's schemas say `min(0)`. A phone that has read nothing yet guesses this and no higher: it never sends a version
 * the server has not said, and `onBootstrapRead` and `onRules` only raise it. (It once guessed 1: against a match the
 * organiser had never corrected, every send was refused for good, 2026-11-02.)
 */
const NO_RULES_VERSION = 0;

/**
 * What the reducer opens a match from: the sport its link names, the files, the judge this mode has, whether the
 * app is in the foreground, and the start of the Undo window the hub kept for the match, if any.
 */
function heldOf(
  loaded: Opened,
  mode: RunnerMode,
  foreground: boolean,
  decidedAt: number | null,
): MatchHeld {
  const rulesVersion = Math.max(
    NO_RULES_VERSION,
    ...loaded.queue.pending.map((tap) => tap.rulesVersion),
  );
  return {
    sport: loaded.sport,
    queue: loaded.queue,
    ledger: loaded.ledger,
    bootstrap: loaded.boot?.bootstrap ?? null,
    toss: loaded.boot?.toss ?? null,
    picks: loaded.boot?.picks,
    judge: mode === 'focused' ? 'fold' : 'trust',
    foreground,
    rulesVersion: loaded.boot?.bootstrap.rulesVersion ?? rulesVersion,
    decidedAt,
  };
}

/** A store that throws instead of answering (a native module that is missing) is a queue this phone cannot read: said, not silent. */
const unreadable = (): RunnerSnapshot => ({ kind: 'unreadable', what: 'queue' });

/** `load` answers null for none and for a file that cannot be read: the list tells them apart (`unreadable`). */
async function unreadableQueue(ports: RunnerPorts, fixtureId: string): Promise<boolean> {
  const entries = await ports.tapQueue.list();
  return entries.some((entry) => entry.kind === 'unreadable' && entry.fixtureId === fixtureId);
}

/** Why it stalls, as the record says it: the reason, not the count (it grows with every refusal and is said once). */
const reasonOf = (stall: Stall | null): string | null => {
  if (stall === null) return null;
  return stall.kind === 'fold' ? 'fold' : stall.by;
};

/**
 * What a stall says in the record: the reason, the hold that stands, the rules version the phone sends under and the
 * one the server last named (numbers, so the scrub keeps them), and how many refusals in a row.
 */
function stallFields(state: MatchState, stall: Stall): LogFields {
  const { sync } = state;
  return {
    reason: reasonOf(stall),
    state: sync.hold ?? 'none',
    held: sync.rulesVersion,
    said: sync.rulesSaid,
    count: stall.kind === 'refused' ? stall.count : 0,
  };
}
