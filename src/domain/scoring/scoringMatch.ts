import { foldEpochOf } from '@seazn/engine/sport';
import { badmintonEventFor, payloadForSend } from '@/domain/scoring/badmintonEvents';
import type { BadmintonTap, BadmintonUndoneTap } from '@/domain/scoring/badmintonPad';
import { undoneTap } from '@/domain/scoring/badmintonFold';
import {
  TAKEN,
  noteLine,
  refusalLine,
  refusing,
  type PadLineWords,
  type PadOutcome,
  type PadRefusal,
} from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { BootCache, MatchQueue, QueueDead, QueuedEvent } from '@/domain/scoring/queue';
import { foldMemo } from '@/domain/scoring/scoringMatchFold';
import {
  canDiscardQueued,
  closedBy,
  discardQueued,
  markSending,
  nextSend,
  onAnswer,
  onBootstrapStatus,
  onFetchFailed,
  onLedger,
  onReadFailed,
  onRules,
  openSync,
  retryRules,
  revalidate,
  type SyncEffect,
  type SyncState,
} from '@/domain/scoring/sync';
import { undoEventFor, undoTarget, type UndoTarget } from '@/domain/scoring/undoTarget';
import type {
  AppendAnswer,
  AppendBody,
  Bootstrap,
  LedgerEvent,
  ReadFailure,
  Rules,
} from '@/domain/scoring/wire';
import type { BadmintonFold } from '@/domain/scoring/badmintonFold';

/**
 * One scoring match on the phone, as ONE pure reducer (plan S2-1 Task 9): every change to what the phone holds (a tap, an
 * Undo, a server's answer, a fetch, the rules, the bootstrap, the app going to the background, a save that did not
 * land) goes through `step` on the latest state, and comes out as the next state and the effects to run, in order.
 * Nothing here touches a clock, a file or the network: `now` is the caller's, and an effect is only a word for what the
 * hook then does (`scoringRunner.ts`).
 *
 * Not a second state machine of the capture session (AGENTS §2): the authority is the server's ledger, and the match is
 * a fold of it through @seazn/engine, as the web's pad does. What this adds to `sync.ts` (which judges answers) is the
 * orchestration around it: which fold judges a tap, what an Undo takes back, when `revalidate` runs, the payload a send
 * is made with, and what a save that failed means.
 */

/** `foldEpochOf('badminton')`: the engine epoch this build folds with, sent with every tap. */
export const ENGINE_EPOCH: number = foldEpochOf('badminton');

/** The sport this build scores. A link for any other is a visible state, never folded by the badminton engine. */
export const SPORT = 'badminton';

/** The wait before a save that did not land is tried again. */
const SAVE_RETRY_MS = 5000;

/**
 * The bootstrap is read at most this often once it is held: while a card shows (a poll, since the web sends no
 * per-fixture ping for a big schedule write), and when a ledger read finds the match decided (to learn it was finalized).
 */
const BOOTSTRAP_PACE_MS = 15_000;

/**
 * A `now` no wait is over at: sync's `accepted` answer sends the next tap itself when `nextSend(now)` says it may, and a
 * send made inside it would skip the payload decision (`payloadForSend`) the pump makes before it marks an attempt.
 * Handing it a time before every wait means the pump is the only sender.
 */
const NOT_YET = Number.NEGATIVE_INFINITY;

// ---------------------------------------------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------------------------------------------

/** The tap on its way to the server, with the seq it was sent at: the copy of it a fetch may bring in before the answer. */
export type InFlight = { readonly key: string; readonly expectedSeq: number };

/** A discarded queued tap's "undone" line, which the ledger cannot say (no void exists): valid while the match is as it was left. */
export type UndoneLine = { readonly tap: BadmintonUndoneTap; readonly over: string };

/**
 * The queue file may differ from the queue: a save failed. `tap`: it was a tap's, whose "not recorded" waits for the
 * re-save. `after`: the number of the last save issued before the failure, which may still be in the file's way: the
 * debt is paid only by a save numbered above it.
 */
export type SaveOwed = {
  readonly tap: boolean;
  readonly retryAt: number | null;
  readonly after: number;
};

export type MatchState = {
  readonly sync: SyncState;
  /** The bootstrap last read, its `cfg` and `rulesVersion` the rules adopted since; null until one is held. */
  readonly bootstrap: Bootstrap | null;
  /** The side picked to serve first (the Start screen), kept while the match's first rally may still carry it. */
  readonly toss: PadSide | null;
  /** `fold`: the pad folds the match. `trust`: the background sender sends its queue and lets the server judge each tap. */
  readonly judge: 'fold' | 'trust';
  readonly foreground: boolean;
  /** What a read or the bootstrap's status said closes the match, with or without taps queued (the queue's own is `sync.queue.dead`). */
  readonly closed: QueueDead | null;
  /** The bootstrap could not be read for want of a signal, and none is held. */
  readonly bootOffline: boolean;
  readonly sent: InFlight | null;
  readonly undone: UndoneLine | null;
  readonly line: PadLineWords;
  readonly saveOwed: SaveOwed | null;
  /** Queue saves asked for and not yet answered by `saved` or `saveFailed`: while any is out, nothing new is sent. */
  readonly saving: number;
  /** The number of the last save asked for (`MatchEffect` `save`): each is numbered, one after another from 1. */
  readonly saveSeq: number;
  /** When the bootstrap was last asked for (the caller's clock), or null: the bootstrap is read at most every 15 s. */
  readonly bootstrapAskedAt: number | null;
  /** A ledger read of a decided match wanted the bootstrap inside that window: it is read when the window is over. */
  readonly bootstrapOwed: boolean;
};

/** What the hook did last, and what is left of it: the queue and the match as they stand. */
export type MatchStep = {
  readonly state: MatchState;
  readonly effects: readonly MatchEffect[];
  /** What a tap came to, for the bounce guard and the flash; null for every event that is no tap. */
  readonly outcome: PadOutcome | null;
};

/**
 * What the hook does, in this order. `save` goes first; a `send` goes only after the save before it has resolved
 * (Review Focus 1). `ledger` is a cache, written when it can and never waited for.
 */
export type MatchEffect =
  | SaveEffect
  | { readonly kind: 'send'; readonly body: AppendBody; readonly sent: QueuedEvent }
  | { readonly kind: 'fetch'; readonly since: number }
  | { readonly kind: 'loadRules' }
  | { readonly kind: 'loadBootstrap' };

export type SaveEffect = {
  readonly kind: 'save';
  /** This save's number: `saved` says which landed, and a debt is paid only by a save numbered after the failure. */
  readonly n: number;
  readonly queue: MatchQueue | null;
  readonly boot: BootCache | null;
  readonly ledger: readonly LedgerEvent[] | null;
  /** The key of the tap this save makes durable: if the save fails it did not happen, and the tap is taken back out. */
  readonly tap: string | null;
};

/** What a handler asks for: a save has no number until `step` numbers it. */
type Planned = Exclude<MatchEffect, SaveEffect> | Omit<SaveEffect, 'n'>;

export type MatchEvent =
  | { readonly kind: 'tap'; readonly tap: BadmintonTap; readonly key: string; readonly at: string }
  | {
      readonly kind: 'undo';
      readonly key: string;
      readonly at: string;
      readonly only?: 'sanction';
    }
  | { readonly kind: 'pickServer'; readonly side: PadSide }
  | { readonly kind: 'answered'; readonly sent: QueuedEvent; readonly answer: AppendAnswer }
  /** A send that never went (its save failed, or the app left): fed back as an answer of `offline`, so `sending` never sticks. */
  | { readonly kind: 'abandoned'; readonly key: string }
  | { readonly kind: 'fetched'; readonly events: readonly LedgerEvent[] }
  | { readonly kind: 'fetchFailed'; readonly failure: ReadFailure }
  | { readonly kind: 'rulesRead'; readonly rules: Rules }
  | { readonly kind: 'rulesFailed'; readonly failure: ReadFailure }
  | { readonly kind: 'bootstrapRead'; readonly bootstrap: Bootstrap }
  | { readonly kind: 'bootstrapFailed'; readonly failure: ReadFailure }
  /** A ping, a poll, a channel joined, a return to the foreground: read the ledger. */
  | { readonly kind: 'read' }
  | { readonly kind: 'foreground' }
  | { readonly kind: 'background' }
  | { readonly kind: 'tick' }
  /** The queue save numbered `n` landed. */
  | { readonly kind: 'saved'; readonly n: number }
  /** A save failed: `key` is the tap it was to make durable, if any. */
  | { readonly kind: 'saveFailed'; readonly key: string | null }
  | { readonly kind: 'say'; readonly words: PadLineWords };

// ---------------------------------------------------------------------------------------------------------------
// Opening a match
// ---------------------------------------------------------------------------------------------------------------

/** What is held when a match opens: the queue and ledger from disk, and what the boot cache kept. */
export type MatchHeld = {
  readonly queue: MatchQueue;
  readonly ledger: readonly LedgerEvent[];
  readonly bootstrap: Bootstrap | null;
  readonly toss: PadSide | null;
  readonly judge: 'fold' | 'trust';
  readonly foreground: boolean;
  /** The rules version to send under when no bootstrap is held: the newest a queued tap was made under. */
  readonly rulesVersion: number;
};

/**
 * A match opened from what was kept. The tip is the LEDGER's last seq, never `bootstrap.lastSeq` (a bootstrap is a
 * moment, the ledger is what folds). With taps queued nothing is sent until the ledger has been read and the queue
 * judged on it (hold `ledger`, a revalidation owed): the phone may have been closed while another scorer finished the
 * game. The ledger and the bootstrap are read at once, unless the queue is already dead.
 */
export function openMatch(held: MatchHeld, now: number): MatchStep {
  const opened = openSync({
    queue: held.queue,
    ledger: held.ledger,
    rulesVersion: held.bootstrap?.rulesVersion ?? held.rulesVersion,
    engineEpoch: ENGINE_EPOCH,
  });
  const owing = held.queue.pending.length > 0 && held.queue.dead === null;
  const sync: SyncState = owing ? { ...opened, hold: 'ledger', revalidateOwed: true } : opened;
  const state: MatchState = {
    sync,
    bootstrap: held.bootstrap,
    toss: held.toss,
    judge: held.judge,
    foreground: held.foreground,
    closed: null,
    bootOffline: false,
    sent: null,
    undone: null,
    line: null,
    saveOwed: null,
    saving: 0,
    saveSeq: 0,
    bootstrapAskedAt: null,
    bootstrapOwed: false,
  };
  if (held.queue.dead !== null) return { state, effects: [], outcome: null };
  const asks = held.judge === 'fold';
  return {
    state: asks ? { ...state, bootstrapAskedAt: now } : state,
    effects: [{ kind: 'fetch', since: sync.tip }, ...(asks ? [LOAD_BOOTSTRAP] : [])],
    outcome: null,
  };
}

const LOAD_BOOTSTRAP: MatchEffect = { kind: 'loadBootstrap' };

// ---------------------------------------------------------------------------------------------------------------
// What the state says
// ---------------------------------------------------------------------------------------------------------------

/** Why the match takes no more taps from this phone, whichever of the queue and a read said it. */
export const deadOf = (state: MatchState): QueueDead | null =>
  state.sync.queue.dead ?? state.closed;

/** The server needs a newer engine than this build's: its answer (426) or its bootstrap said so. */
export const isOutdated = (state: MatchState): boolean =>
  state.sync.status === 'outdated' ||
  (state.bootstrap !== null && state.bootstrap.epochRequired > state.sync.engineEpoch);

const closedByStatus = (status: string): QueueDead | null =>
  status === 'finalized' || status === 'cancelled' ? status : null;

/** The screens whose card means the pad takes no tap (the others are the pad itself, or the Start screen). */
const CARD_SCREENS: ReadonlySet<string> = new Set(['viewOnly', 'divisionNotStarted', 'waiting']);

/** Whether the pad takes a tap now. */
function padTakes(state: MatchState): boolean {
  const { bootstrap, sync } = state;
  if (bootstrap === null || bootstrap.sportKey !== SPORT) return false;
  if (deadOf(state) !== null || isOutdated(state) || sync.status === 'tooLarge') return false;
  return !CARD_SCREENS.has(bootstrap.screen);
}

/** Order-free equality of two JSON values: the server's copy of a payload may come back with its keys in another order. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const [keysA, keysB] = [Object.keys(a), Object.keys(b)];
  if (keysA.length !== keysB.length) return false;
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>];
  return keysA.every((key) => key in right && sameJson(left[key], right[key]));
}

/**
 * The ledger's copy of the tap in flight, or null: a ping's fetch beat the answer. It sits at the seq the tap was sent
 * at, plus one, with the same type and the same payload, the keys in any order (Postgres reorders them), and it was
 * written by this phone's link: a co-scorer's identical rally at that seq is theirs, and counts.
 */
function inFlightCopy(state: MatchState): LedgerEvent | null {
  const { sent, sync, bootstrap } = state;
  if (sent === null || sync.inFlight !== sent.key || bootstrap === null) return null;
  const head = sync.queue.pending.find((tap) => tap.key === sent.key);
  const copy = sync.ledger.find((event) => event.seq === sent.expectedSeq + 1);
  const same =
    head !== undefined &&
    copy !== undefined &&
    copy.deviceLinkId === bootstrap.linkId &&
    copy.type === head.type &&
    sameJson(copy.payload, head.payload);
  return same ? copy : null;
}

/**
 * The queued taps the fold counts. The tap in flight is left out when the ledger already holds its copy: folded as
 * both, it would score twice until the answer came. A tap an Undo is waiting on is taken back at once: it and its Undo
 * are left out, and once the ledger holds the server's copy the Undo stands in as a void of that copy.
 */
export function foldQueue(state: MatchState): readonly QueuedEvent[] {
  const { pending } = state.sync.queue;
  const copy = inFlightCopy(state);
  const undone = new Set(
    pending.flatMap((tap) => (tap.voidsKey === undefined ? [] : [tap.voidsKey])),
  );
  return pending.flatMap((tap): QueuedEvent[] => {
    if (tap.voidsKey !== undefined) return copy === null ? [] : [resolved(tap, copy.id)];
    if (undone.has(tap.key)) return [];
    return copy !== null && tap.key === state.sent?.key ? [] : [tap];
  });
}

/** An Undo that waited for its tap's answer, made a plain void of the event the answer names. */
function resolved(waiting: QueuedEvent, eventId: string): QueuedEvent {
  const { key, rulesVersion, createdAt, attempts } = waiting;
  return { key, ...undoEventFor(eventId), rulesVersion, createdAt, attempts };
}

/**
 * The event ids that are this phone's own for THIS link (design §6.2): a browser on another link wrote the events that
 * name another link, whatever the queue file remembers. A stand-in for an accepted tap has no link yet, and is own.
 */
export function ownIds(state: MatchState): readonly string[] {
  const { bootstrap, sync } = state;
  const copy = inFlightCopy(state);
  const own = copy === null ? sync.queue.ownEventIds : [...sync.queue.ownEventIds, copy.id];
  if (bootstrap === null) return own;
  const links = new Map(sync.ledger.map((event) => [event.id, event.deviceLinkId]));
  const mine = own.filter((id) => {
    const link = links.get(id);
    return link === undefined || link === null || link === bootstrap.linkId;
  });
  return mine.length === own.length ? own : mine;
}

/** The match folded, the queue as `queued` says (the queue the fold counts, unless a caller judges another). */
export function foldOfState(
  state: MatchState,
  queued: readonly QueuedEvent[] = foldQueue(state),
): BadmintonFold | null {
  const { bootstrap } = state;
  if (bootstrap === null || bootstrap.sportKey !== SPORT) return null;
  return foldMemo({
    bootstrap,
    ledger: state.sync.ledger,
    queued,
    ownEventIds: ownIds(state),
    toss: state.toss,
  });
}

/** What Undo would take back now: the fold's legal queued taps and the ledger, the one rule (`undoTarget`). */
export function undoTargetOf(state: MatchState, fold: BadmintonFold): UndoTarget {
  const legal = fold.kind === 'folded' ? new Set(fold.legalQueued) : new Set<string>();
  const taps = foldQueue(state).filter((tap) => legal.has(tap.key));
  return undoTarget(state.sync.ledger, taps, ownIds(state), (key) =>
    canDiscardQueued(state.sync, key),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// What is waited for
// ---------------------------------------------------------------------------------------------------------------

/**
 * The earliest time after `now` at which the state wants a step, or null: a send's backoff, a rules read asked again, a
 * save tried again. The runner arms ONE timer at it after every step, so a wait that comes after another is armed when
 * the first has passed, never left without a timer. Times are the caller's clock. Nothing is waited for in the
 * background (the return steps the match), and a dead queue sends nothing.
 */
export function wakeAt(state: MatchState, now: number): number | null {
  if (!state.foreground) return null;
  const { sync } = state;
  const sends = sync.queue.pending.length > 0 && deadOf(state) === null;
  const times = [
    sends ? sync.notBefore : null,
    sync.rulesRetryAt,
    state.saveOwed?.retryAt ?? null,
    bootstrapDueAt(state),
  ];
  const ahead = times.filter((at): at is number => at !== null && at > now);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

// ---------------------------------------------------------------------------------------------------------------
// One step
// ---------------------------------------------------------------------------------------------------------------

type Part = { readonly state: MatchState; readonly effects: readonly Planned[] };
/** What a handler decided. `pump: false`: a tap was added to the queue, which is saved before anything is sent. */
type Handled = Part & { readonly outcome: PadOutcome | null; readonly pump: boolean };

const part = (state: MatchState, effects: readonly Planned[] = []): Part => ({
  state,
  effects,
});
const handled = (p: Part, extra: { outcome?: PadOutcome; pump?: boolean } = {}): Handled => ({
  ...p,
  outcome: extra.outcome ?? null,
  pump: extra.pump ?? true,
});

export function step(state: MatchState, event: MatchEvent, now: number): MatchStep {
  const result = handle(state, event, now);
  const settled = result.pump ? pump(result.state, now) : part(result.state);
  const final = withoutOrphanVoids(settled.state);
  const save = saveOf(state, final);
  const planned = [...(save === null ? [] : [save]), ...result.effects, ...settled.effects];
  const { effects, last } = numbered(planned, final.saveSeq);
  const owed = effects.filter((effect) => effect.kind === 'save' && effect.queue !== null).length;
  return {
    state: { ...final, saving: final.saving + owed, saveSeq: last },
    effects,
    outcome: result.outcome,
  };
}

/** Each save, in the order made, gets the next number after `seq`. */
function numbered(
  planned: readonly Planned[],
  seq: number,
): { effects: MatchEffect[]; last: number } {
  let last = seq;
  const effects = planned.map((effect): MatchEffect => {
    if (effect.kind !== 'save') return effect;
    last += 1;
    return { ...effect, n: last };
  });
  return { effects, last };
}

function handle(state: MatchState, event: MatchEvent, now: number): Handled {
  switch (event.kind) {
    case 'tap':
      return onTap(state, event);
    case 'undo':
      return onUndo(state, event);
    case 'pickServer':
      return onPick(state, event.side);
    case 'answered':
      return onAnswered(state, event.sent, event.answer, now);
    case 'abandoned':
      return handled(abandon(state, event.key, now));
    case 'fetched':
      return handled(onFetched(state, event.events, now));
    case 'rulesRead':
      return handled(onRulesRead(state, event.rules));
    case 'bootstrapRead':
      return handled(onBootstrapRead(state, event.bootstrap));
    case 'fetchFailed':
    case 'rulesFailed':
    case 'bootstrapFailed':
      return handled(onFailed(state, event.kind, event.failure, now));
    case 'read':
    case 'foreground':
      return handled(
        wanting(event.kind === 'foreground' ? { ...state, foreground: true } : state, now),
      );
    case 'background':
      return handled(part({ ...state, foreground: false }));
    case 'tick':
      return handled(part(state));
    case 'saved':
      return handled(part(savedOf(landedSave(state), event.n)));
    case 'saveFailed':
      return handled(onSaveFailed(landedSave(state), event.key, now));
    case 'say':
      return handled(part({ ...state, line: event.words }));
  }
}

const refused = (state: MatchState, refusal: PadRefusal): Handled =>
  handled(part(state), { outcome: refusing(refusal), pump: false });

// ---------------------------------------------------------------------------------------------------------------
// A tap, an Undo, the pick
// ---------------------------------------------------------------------------------------------------------------

/** A new tap in the queue, made now under the rules the phone holds. */
const queuedOf = (
  state: MatchState,
  make: { type: string; payload: unknown },
  key: string,
  at: string,
): QueuedEvent => ({
  key,
  type: make.type,
  payload: make.payload,
  rulesVersion: state.sync.rulesVersion,
  createdAt: at,
  attempts: 0,
});

const withTap = (state: MatchState, tap: QueuedEvent): MatchState => ({
  ...state,
  sync: {
    ...state.sync,
    queue: { ...state.sync.queue, pending: [...state.sync.queue.pending, tap] },
  },
});

/** Whether the fold takes `tap` on top of the queue, as the server would take it: the one judge of a tap (`legalQueued`). */
function takes(state: MatchState, tap: QueuedEvent): boolean {
  const fold = foldOfState(state, [...foldQueue(state), tap]);
  return fold !== null && fold.kind === 'folded' && fold.legalQueued.includes(tap.key);
}

function onTap(state: MatchState, event: Extract<MatchEvent, { kind: 'tap' }>): Handled {
  const fold = padTakes(state) ? foldOfState(state) : null;
  if (fold === null || fold.kind !== 'folded' || state.bootstrap === null)
    return refused(state, 'notNow');
  const { tap } = event;
  const made = badmintonEventFor(tap, { bootstrap: state.bootstrap, display: fold.display });
  if (made === null) return refused(state, 'notNow');
  const queued = queuedOf(state, made, event.key, event.at);
  if (!takes(state, queued)) {
    return refused(state, tap.kind === 'setScore' ? 'invalidScore' : 'notNow');
  }
  const toss = tap.kind === 'start' ? tap.server : state.toss;
  const next = { ...withTap(state, queued), toss, line: null, undone: null };
  return handled(part(next), { outcome: TAKEN, pump: false });
}

function onPick(state: MatchState, side: PadSide): Handled {
  const fold = foldOfState(state);
  if (fold === null || fold.kind !== 'folded' || fold.display.phase !== 'notStarted') {
    return handled(part(state));
  }
  return handled(part({ ...state, toss: side }));
}

/** The tap Undo takes back may be the match's start: the Start screen then asks again, and the old pick goes. */
const isStart = (state: MatchState, target: UndoTarget): boolean =>
  typeToUndo(state, target) === 'core.start';

function typeToUndo(state: MatchState, target: UndoTarget): string | null {
  if (target.kind === 'ledger') {
    return state.sync.ledger.find((event) => event.id === target.eventId)?.type ?? null;
  }
  if (target.kind === 'blocked') return null;
  return state.sync.queue.pending.find((tap) => tap.key === target.key)?.type ?? null;
}

function onUndo(state: MatchState, event: Extract<MatchEvent, { kind: 'undo' }>): Handled {
  const fold = padTakes(state) ? foldOfState(state) : null;
  if (fold === null || fold.kind !== 'folded' || state.bootstrap === null)
    return refused(state, 'notNow');
  const target = undoTargetOf(state, fold);
  if (target.kind === 'blocked') return refused(state, blockedRefusal(target.reason));
  if (event.only === 'sanction' && !fold.display.awaitingEnding) return refused(state, 'notNow');
  const next = isStart(state, target) ? { ...state, toss: null } : state;
  return undoing(next, target, event, fold);
}

/** Undo with nothing of this phone's to take back says so; another scorer's tap since is the line's standing note. */
const blockedRefusal = (reason: Extract<UndoTarget, { kind: 'blocked' }>['reason']): PadRefusal =>
  reason === 'nothing' ? 'nothingToUndo' : 'notNow';

function undoing(
  state: MatchState,
  target: Exclude<UndoTarget, { kind: 'blocked' }>,
  event: Extract<MatchEvent, { kind: 'undo' }>,
  fold: Extract<BadmintonFold, { kind: 'folded' }>,
): Handled {
  if (target.kind === 'awaitAnswer') return waiting(state, target.key, event);
  if (target.kind === 'queued') return discarding(state, target.key, fold);
  return voiding(state, target.eventId, event.key, event.at);
}

/**
 * Undo of a tap that may be at the server already: a void that names it by key, queued behind it and saved at once, so
 * a kill or leaving the match keeps it. Its tap's answer gives the id (`resolveUndo`).
 */
function waiting(
  state: MatchState,
  tapKey: string,
  event: Extract<MatchEvent, { kind: 'undo' }>,
): Handled {
  const made = queuedOf(state, undoEventFor(''), event.key, event.at);
  const next = { ...withTap(state, { ...made, voidsKey: tapKey }), line: null, undone: null };
  return handled(part(next), { outcome: TAKEN, pump: false });
}

/** Undo of a tap still only queued: it leaves the queue, nothing is sent, and the line says it was undone. */
function discarding(
  state: MatchState,
  key: string,
  fold: Extract<BadmintonFold, { kind: 'folded' }>,
): Handled {
  const stepped = discardQueued(state.sync, key);
  const did = fold.display.lastTap;
  const tap = did === null || did.kind === 'undone' ? null : undoneTap(did);
  const moved: MatchState = { ...state, sync: stepped.state, line: null };
  const next: MatchState = {
    ...moved,
    undone: tap === null ? null : { tap, over: signatureOf(moved) },
  };
  return handled(part(next), {
    outcome: stepped.state === state.sync ? refusing('notNow') : TAKEN,
    pump: false,
  });
}

/**
 * Undo of an accepted event: a `core.void` of it. `undoTarget` has named an event that still stands, so the void is
 * queued without a second look; a server that refuses it refuses that tap alone, and the line says so.
 */
function voiding(state: MatchState, eventId: string, key: string, at: string): Handled {
  const queued = queuedOf(state, undoEventFor(eventId), key, at);
  return handled(part({ ...withTap(state, queued), line: null, undone: null }), {
    outcome: TAKEN,
    pump: false,
  });
}

/** The match as an "undone" line was said over it: the ledger's length and the queue's keys. Any change ends the line. */
export const signatureOf = (state: MatchState): string =>
  `${state.sync.ledger.length}:${state.sync.queue.pending.map((tap) => tap.key).join(',')}`;

/** An Undo that waits for a tap that is no longer queued (refused, dropped) is nothing now: it goes with it. */
function withoutOrphanVoids(state: MatchState): MatchState {
  const { pending } = state.sync.queue;
  const orphaned = (tap: QueuedEvent): boolean =>
    tap.voidsKey !== undefined && !pending.some((other) => other.key === tap.voidsKey);
  return pending.some(orphaned)
    ? withPending(
        state,
        pending.filter((tap) => !orphaned(tap)),
      )
    : state;
}

const withPending = (state: MatchState, pending: readonly QueuedEvent[]): MatchState => ({
  ...state,
  sync: { ...state.sync, queue: { ...state.sync.queue, pending } },
});

// ---------------------------------------------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------------------------------------------

/**
 * Maps sync's effects to the hook's. `persist` is the save the diff makes; `send` is the pump's alone (`NOT_YET`);
 * `retryIn` is read off the state (`wakeAt`), not carried out as an effect of its own.
 */
function effectsOf(effects: readonly SyncEffect[]): { effects: MatchEffect[]; refused: boolean } {
  const out: MatchEffect[] = [];
  let refused = false;
  for (const effect of effects) {
    if (effect.kind === 'fetchSince') out.push({ kind: 'fetch', since: effect.seq });
    else if (effect.kind === 'reloadRules') out.push({ kind: 'loadRules' });
    else if (effect.kind === 'reloadBootstrap') out.push(LOAD_BOOTSTRAP);
    else if (effect.kind === 'refused') refused = true;
  }
  return { effects: out, refused };
}

/** The state after sync moved, and what it asked for; a tap that left the queue refused is said, once, on the line. */
function withSync(
  state: MatchState,
  step: { state: SyncState; effects: readonly SyncEffect[] },
): Part {
  const mapped = effectsOf(step.effects);
  const line = mapped.refused ? refusalLine('scoring.refusal.notCounted') : state.line;
  return part({ ...state, sync: step.state, line }, mapped.effects);
}

function onAnswered(
  state: MatchState,
  sent: QueuedEvent,
  answer: AppendAnswer,
  now: number,
): Handled {
  const accepted = answer.kind === 'accepted';
  const stepped = onAnswer(state.sync, sent, answer, accepted ? NOT_YET : now);
  const landed = state.sent?.key === sent.key ? { ...state, sent: null } : state;
  const moved = withSync(landed, stepped);
  const waits = moved.state.sync.queue.pending.some((tap) => tap.voidsKey === sent.key);
  if (!accepted || !waits) return handled(moved);
  return handled(resolveUndo(moved, sent.key, answer.eventId), { pump: false });
}

/**
 * The tap an Undo waited for was accepted: the Undo becomes a plain void of the id the answer names, in its place in the
 * queue. The fold must take it (another scorer may have voided the tap already: then it is dropped); the background
 * sender judges nothing and keeps it, and the server judges it.
 */
function resolveUndo(moved: Part, tapKey: string, eventId: string): Part {
  const { pending } = moved.state.sync.queue;
  const waiting = pending.find((tap) => tap.voidsKey === tapKey);
  if (waiting === undefined) return moved;
  const plain = resolved(waiting, eventId);
  const next = withPending(
    moved.state,
    pending.map((tap) => (tap === waiting ? plain : tap)),
  );
  const fold = foldOfState(next);
  const legal =
    next.judge === 'trust' ||
    (fold !== null && fold.kind === 'folded' && fold.legalQueued.includes(plain.key));
  const kept = legal
    ? next
    : withPending(
        moved.state,
        pending.filter((tap) => tap !== waiting),
      );
  return part(kept, moved.effects);
}

/** A send that never went: its tap stays, its attempt counted, and the sender waits as it does for no network. */
function abandon(state: MatchState, key: string, now: number): Part {
  const tap = state.sync.queue.pending.find((queued) => queued.key === key);
  const landed = state.sent?.key === key ? { ...state, sent: null } : state;
  if (tap === undefined) return part(landed);
  return withSync(landed, onAnswer(landed.sync, tap, { kind: 'offline' }, now));
}

// ---------------------------------------------------------------------------------------------------------------
// Reads: the ledger, the rules, the bootstrap
// ---------------------------------------------------------------------------------------------------------------

/**
 * A ping, a poll, a return to the foreground: the ledger again. The bootstrap goes with it at once while the screen is
 * not the pad (a card, or none held yet), and, paced, when the match is decided: the ledger cannot say it was finalized.
 */
function wanting(state: MatchState, now: number): Part {
  if (state.sync.status === 'tooLarge' || deadOf(state) !== null) return part(state);
  const fetch: MatchEffect = { kind: 'fetch', since: state.sync.tip };
  if (state.judge !== 'fold') return part(state, [fetch]);
  if (showsNoPad(state)) return asking(state, now, [fetch]);
  if (!isDecided(state)) return part(state, [fetch]);
  return paced(state, now)
    ? asking(state, now, [fetch])
    : part({ ...state, bootstrapOwed: true }, [fetch]);
}

/** No bootstrap is held, or the server's screen is a card in place of the pad. */
const showsNoPad = (state: MatchState): boolean =>
  state.bootstrap === null || CARD_SCREENS.has(state.bootstrap.screen);

function isDecided(state: MatchState): boolean {
  const fold = foldOfState(state);
  return fold !== null && fold.kind === 'folded' && fold.display.phase === 'decided';
}

/** Whether the last read of the bootstrap is far enough back for another. */
const paced = (state: MatchState, now: number): boolean =>
  state.bootstrapAskedAt === null || now - state.bootstrapAskedAt >= BOOTSTRAP_PACE_MS;

/** The bootstrap is asked for now: the time is kept, and what was owed is paid. */
function asking(state: MatchState, now: number, others: readonly MatchEffect[] = []): Part {
  return part({ ...state, bootstrapAskedAt: now, bootstrapOwed: false }, [
    ...others,
    LOAD_BOOTSTRAP,
  ]);
}

/**
 * When the bootstrap is next to be read on its own: 15 s after it was last asked for, while a read is owed, a card
 * shows or none is held yet. Only the foreground folding runner reads it; the background sender judges nothing.
 */
function bootstrapDueAt(state: MatchState): number | null {
  const asked = state.bootstrapAskedAt;
  if (asked === null || state.judge !== 'fold') return null;
  if (state.sync.status === 'tooLarge' || deadOf(state) !== null) return null;
  const wanted = state.bootstrapOwed || showsNoPad(state);
  return wanted ? asked + BOOTSTRAP_PACE_MS : null;
}

/** Events the ledger already holds are nothing new (a fetch that lost the race with another); the rest merge. */
function onFetched(state: MatchState, events: readonly LedgerEvent[], now: number): Part {
  const fresh = events.filter((event) => event.seq > state.sync.tip);
  void now;
  return withSync(state, onLedger(state.sync, fresh));
}

/** The rules a read brought: the phone folds under them only when they are the version it holds now. */
function onRulesRead(state: MatchState, rules: Rules): Part {
  const sync = onRules(state.sync, rules);
  const { bootstrap } = state;
  const adopted =
    bootstrap !== null && rules.rulesVersion === sync.rulesVersion
      ? { ...bootstrap, cfg: rules.cfg, rulesVersion: rules.rulesVersion }
      : bootstrap;
  return part({ ...state, sync, bootstrap: adopted });
}

/**
 * A bootstrap read: its status goes through sync (a closed match, a tap held on ALREADY_DECIDED), its rules count only
 * if they are no older than those held, and it clears what an earlier failed read said of the link. One read before the
 * seq of the one held (`lastSeq`) is a late answer and changes nothing: a stale "in play" must not reopen a finalized match.
 */
function onBootstrapRead(state: MatchState, read: Bootstrap): Part {
  const held = state.bootstrap;
  if (held !== null && read.lastSeq < held.lastSeq) return part(state);
  const status = onBootstrapStatus(state.sync, read.status);
  const newer = held === null || read.rulesVersion >= held.rulesVersion;
  const bootstrap: Bootstrap = newer
    ? read
    : { ...read, cfg: held.cfg, rulesVersion: held.rulesVersion };
  const sync =
    read.rulesVersion > status.state.rulesVersion
      ? onRules(status.state, { rulesVersion: read.rulesVersion })
      : status.state;
  const next: MatchState = {
    ...state,
    bootstrap,
    closed: closedByStatus(read.status),
    bootOffline: false,
  };
  return withSync(next, { state: sync, effects: status.effects });
}

/** A read that did not come to its data: sync's word on it, and what it says of the link even with nothing queued. */
function onFailed(
  state: MatchState,
  kind: 'fetchFailed' | 'rulesFailed' | 'bootstrapFailed',
  failure: ReadFailure,
  now: number,
): Part {
  const closed = closedBy(failure) ?? state.closed;
  const trouble =
    kind === 'bootstrapFailed' && state.bootstrap === null && closedBy(failure) === null;
  const next: MatchState = { ...state, closed, bootOffline: trouble || state.bootOffline };
  return withSync(next, onReadFailed(state.sync, failure, now));
}

// ---------------------------------------------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------------------------------------------

/**
 * The save this step owes: the queue if it moved (or a failed save leaves it owed), the boot cache if the bootstrap or
 * the pick did, the ledger if it grew. The key of a tap this step added is named: if the save fails it never happened.
 */
function saveOf(prev: MatchState, next: MatchState): Omit<SaveEffect, 'n'> | null {
  const queueMoved = prev.sync.queue !== next.sync.queue;
  const bootMoved = prev.bootstrap !== next.bootstrap || prev.toss !== next.toss;
  const ledgerMoved = prev.sync.ledger !== next.sync.ledger;
  const boot =
    bootMoved && next.bootstrap !== null && next.judge === 'fold'
      ? { bootstrap: next.bootstrap, toss: next.toss }
      : null;
  if (!queueMoved && boot === null && !ledgerMoved) return null;
  const added = next.sync.queue.pending.find(
    (tap) => !prev.sync.queue.pending.some((before) => before.key === tap.key),
  );
  return {
    kind: 'save',
    queue: queueMoved ? next.sync.queue : null,
    boot,
    ledger: ledgerMoved ? next.sync.ledger : null,
    tap: added?.key ?? null,
  };
}

/** One queue save has been answered, whichever way. */
const landedSave = (state: MatchState): MatchState => ({
  ...state,
  saving: Math.max(0, state.saving - 1),
});

/**
 * A queue save landed: whatever the file held that the queue does not is overwritten, if it was issued after the failure.
 * A tap's "not recorded" is now true.
 */
function savedOf(state: MatchState, n: number): MatchState {
  if (state.saveOwed === null || n <= state.saveOwed.after) return state;
  const line = state.saveOwed.tap ? refusalLine('scoring.refusal.notSaved') : state.line;
  return { ...state, saveOwed: null, line };
}

/**
 * A save did not land. The tap it was to make durable is taken back out (the screen never showed it), and the queue
 * is saved again WITHOUT it: the move may have failed after the new file was written, and a read promotes that file
 * (`tapQueueStore`), so a tap the scorer was told was not recorded could come back. "Not recorded" is said only once
 * that save has landed (`savedOf`); until then the line says it could not save.
 */
function onSaveFailed(state: MatchState, key: string | null, now: number): Part {
  const pending = state.sync.queue.pending.filter((tap) => tap.key !== key || tap.attempts > 0);
  const moved = pending.length !== state.sync.queue.pending.length;
  const sync = moved ? { ...state.sync, queue: { ...state.sync.queue, pending } } : state.sync;
  const tap = key !== null || state.saveOwed?.tap === true;
  const owed: SaveOwed = { tap, retryAt: now + SAVE_RETRY_MS, after: state.saveSeq };
  const line = key === null ? state.line : refusalLine('scoring.refusal.savePending');
  const next: MatchState = { ...state, sync, line, saveOwed: owed };
  const first = state.saveOwed === null || key !== null;
  return part(next, first && !moved ? [resave(sync.queue)] : []);
}

const resave = (queue: MatchQueue): Planned => ({
  kind: 'save',
  queue,
  boot: null,
  ledger: null,
  tap: null,
});

// ---------------------------------------------------------------------------------------------------------------
// The pump: what can be done now
// ---------------------------------------------------------------------------------------------------------------

type Stage = (state: MatchState, now: number) => Part;

/** Runs each stage on the state the one before left, in order, collecting what they ask for. */
function chain(state: MatchState, stages: readonly Stage[], now: number): Part {
  return stages.reduce<Part>((acc, stage) => {
    const next = stage(acc.state, now);
    return part(next.state, [...acc.effects, ...next.effects]);
  }, part(state));
}

/** Foreground only: in the background nothing is judged or sent, and the return calls this again. */
function pump(state: MatchState, now: number): Part {
  if (!state.foreground) return part(state);
  return chain(state, [resaving, rulesRetry, rereading, revalidating, sending], now);
}

/** A failed save is tried again once it is due. */
function resaving(state: MatchState, now: number): Part {
  const owed = state.saveOwed;
  if (owed === null || owed.retryAt === null || now < owed.retryAt) return part(state);
  return part({ ...state, saveOwed: { ...owed, retryAt: null } }, [resave(state.sync.queue)]);
}

/** The bootstrap is read again once it is due (`bootstrapDueAt`): a card's poll, or a read a ping owed. */
function rereading(state: MatchState, now: number): Part {
  const due = bootstrapDueAt(state);
  return due === null || now < due ? part(state) : asking(state, now);
}

/** A rules read that failed is asked for again once due (`retryRules`), even with nothing queued. */
function rulesRetry(state: MatchState, now: number): Part {
  return withSync(state, retryRules(state.sync, now));
}

type Judge = (queued: readonly QueuedEvent[]) => readonly string[];

/** What can judge the queue: the fold, or (the background sender) nothing, which keeps every tap for the server to judge. */
function judgeOf(state: MatchState): Judge | null {
  if (state.judge === 'trust') return (queued) => queued.map((tap) => tap.key);
  const { pending } = state.sync.queue;
  const fold = foldOfState(state, undoneAway(pending));
  if (fold === null || fold.kind !== 'folded') return null;
  return () => [...fold.legalQueued, ...undoPairs(pending)];
}

/** The queue as the fold judges it: a tap an Undo is waiting on, and that Undo, are both left out (they cancel). */
function undoneAway(pending: readonly QueuedEvent[]): readonly QueuedEvent[] {
  const pairs = new Set(undoPairs(pending));
  return pending.filter((tap) => !pairs.has(tap.key));
}

/** The keys of the Undos that wait and of the taps they wait on: kept whole, never judged apart. */
const undoPairs = (pending: readonly QueuedEvent[]): readonly string[] =>
  pending.flatMap((tap) => (tap.voidsKey === undefined ? [] : [tap.key, tap.voidsKey]));

/**
 * The queue judged on the ledger and rules as they stand, when sync asks (hold `revalidate`). A match that cannot be
 * folded is never judged: an empty `legalQueued` would drop the whole queue. The hold then stands, and the pad says why.
 */
function revalidating(state: MatchState): Part {
  if (state.sync.hold !== 'revalidate') return part(state);
  const judge = judgeOf(state);
  if (judge === null) return part(state);
  return withSync(state, revalidate(state.sync, judge));
}

/**
 * The next send, if one is due. The payload is decided BEFORE the attempt is marked (`payloadForSend`: the match's
 * first rally drops its `serving` if a rally already stands), and written into the queued head in the same step that
 * marks the attempt, so the fold and sync see what the server is sent. The save before the send is the step's own.
 */
function sending(state: MatchState, now: number): Part {
  const { sync } = state;
  if (state.saving > 0 || deadOf(state) !== null || isOutdated(state)) return part(state);
  const body = nextSend(sync, now);
  const head = sync.queue.pending[0];
  if (body === null || head === undefined) return part(state);
  const payload = payloadForSend(head, sync.ledger);
  const decided: SyncState =
    payload === head.payload
      ? sync
      : {
          ...sync,
          queue: { ...sync.queue, pending: [{ ...head, payload }, ...sync.queue.pending.slice(1)] },
        };
  const marked = markSending(decided, now).state;
  const sentTap = marked.queue.pending[0];
  const next: MatchState = {
    ...state,
    sync: marked,
    sent: { key: head.key, expectedSeq: body.expected_seq },
  };
  return part(next, [{ kind: 'send', body: { ...body, payload }, sent: sentTap }]);
}
