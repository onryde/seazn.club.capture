import {
  type PadLineWords,
  type PadOutcome,
  type PadRefusal,
  refusing,
} from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';
import {
  resultStands,
  type BootCache,
  type MatchQueue,
  type QueueDead,
  type QueuedEvent,
} from '@/domain/scoring/queue';
import type { ScoringSport, SportFold, SportLine, SportTypes } from '@/domain/scoring/scoringSport';
import { type SyncState, canDiscardQueued } from '@/domain/scoring/sync';
import { type UndoTarget, undoEventFor, undoTarget } from '@/domain/scoring/undoTarget';
import type {
  AppendAnswer,
  AppendBody,
  Bootstrap,
  LedgerEvent,
  ReadFailure,
  Rules,
} from '@/domain/scoring/wire';

/**
 * The state of one scoring match and what can be read off it (plan S2-1 Task 9): the types of the reducer in
 * `scoringMatch.ts`, its constants, and the accessors every handler shares (is the queue dead, what does the fold count,
 * what would Undo take back). Pure, and the same for every sport: `S` is the sport's types (`SportTypes`), and what the
 * sport decides is asked of the match's own sport (`MatchState.sport`). `S` defaults to any sport: what a runner holds.
 */

/** The wait before a save that did not land is tried again. */
export const SAVE_RETRY_MS = 5000;

/**
 * The bootstrap is read at most this often once it is held: while a card shows (a poll, since the web sends no
 * per-fixture ping for a big schedule write), and when a ledger read finds the match decided (to learn it was finalized).
 */
export const BOOTSTRAP_PACE_MS = 15_000;

/**
 * A `now` no wait is over at: sync's `accepted` answer sends the next tap itself when `nextSend(now)` says it may, and a
 * send made inside it would skip the payload decision (`payloadForSend`) the pump makes before it marks an attempt.
 * Handing it a time before every wait means the pump is the only sender.
 */
export const NOT_YET = Number.NEGATIVE_INFINITY;

/** The tap on its way to the server, with the seq it was sent at: the copy of it a fetch may bring in before the answer. */
export type InFlight = { readonly key: string; readonly expectedSeq: number };

/** A discarded queued tap's "undone" line, which the ledger cannot say (no void exists): valid while the match is as it was left. */
export type UndoneLine<S extends SportTypes = SportTypes> = {
  readonly tap: S['undone'];
  readonly over: string;
};

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

export type MatchState<S extends SportTypes = SportTypes> = {
  /**
   * The sport the match opened as (the one its link was kept with), kept for its life: it folds the match, makes each
   * tap's event and draws the pad. A bootstrap that names another sport is never folded by it (`unsupportedSport`).
   */
  readonly sport: ScoringSport<S>;
  readonly sync: SyncState;
  /** The bootstrap last read, its `cfg` and `rulesVersion` the rules adopted since; null until one is held. */
  readonly bootstrap: Bootstrap | null;
  /** The side picked to serve first (the Start screen), kept while the match's first rally may still carry it. */
  readonly toss: PadSide | null;
  /**
   * The scorer's pending picks (S2-4 plan Task 3), kept with the boot cache and handed to every fold. Only `setPicks`
   * changes them, never a tap or Undo; a map equal to the one held is the same object, so nothing folds again.
   */
  readonly picks: PendingPicks;
  /** `fold`: the pad folds the match. `trust`: the background sender sends its queue and lets the server judge each tap. */
  readonly judge: 'fold' | 'trust';
  readonly foreground: boolean;
  /** What a read or the bootstrap's status said closes the match, with or without taps queued (the queue's own is `sync.queue.dead`). */
  readonly closed: QueueDead | null;
  /** The bootstrap could not be read for want of a signal, and none is held. */
  readonly bootOffline: boolean;
  readonly sent: InFlight | null;
  readonly undone: UndoneLine<S> | null;
  readonly line: PadLineWords;
  readonly saveOwed: SaveOwed | null;
  /**
   * The boot cache (the bootstrap, the pick and the pending picks) could not be written (S2-4 Batch 2 fix round 1):
   * `retry`, it was saved again once; `said`, that save failed too, and the line says so when it held a choice of the
   * scorer's. A boot save a later step makes anew clears it.
   */
  readonly bootOwed: 'retry' | 'said' | null;
  /**
   * The boot cache the last boot save that landed carried, or null before one has (S2-4 Batch 3 fix round 1, M4). The
   * saver is serial, so it is what the disk holds: while it is the one the state holds, the scorer's choice is saved,
   * whatever an older save's failure says.
   */
  readonly bootLanded: BootCache | null;
  /** Queue saves asked for and not yet answered by `saved` or `saveFailed`: while any is out, nothing new is sent. */
  readonly saving: number;
  /** The number of the last save asked for (`MatchEffect` `save`): each is numbered, one after another from 1. */
  readonly saveSeq: number;
  /** When the bootstrap was last asked for (the caller's clock), or null: the bootstrap is read at most every 15 s. */
  readonly bootstrapAskedAt: number | null;
  /** A ledger read of a decided match wanted the bootstrap inside that window: it is read when the window is over. */
  readonly bootstrapOwed: boolean;
  /**
   * The phone's clock (ms) when this phone's own dispatched tap decided the match, which opens Undo for 45 s (owner,
   * 2026-11-03; `scoringMatchWindow.ts`); null when none did: not decided, decided by another scorer, or decided before
   * this launch's screen held it. The runner hands it to the hub, which keeps it between screens.
   */
  readonly decidedAt: number | null;
};

/** What the hook did last, and what is left of it: the queue and the match as they stand. */
export type MatchStep<S extends SportTypes = SportTypes> = {
  readonly state: MatchState<S>;
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
  | { readonly kind: 'loadBootstrap' }
  /**
   * `count` taps left the queue without counting, all for `code` (`CODE_WORD`: the server's own word, or ours,
   * `NO_LONGER_LEGAL`; anything else is `OTHER`). The runner says it in the record, one line for the taps one judgement
   * dropped: the pad's line is one sentence however many went, and the record is where the number is kept.
   */
  | { readonly kind: 'dropped'; readonly code: string; readonly count: number }
  /** The sport withdrew the head at its send (`SendWithdrawal`): the runner says the sport's line in the record. */
  | { readonly kind: 'withdrawn'; readonly line: SportLine }
  /** The head is sent with less than the scorer gave it (`ScoringSport.sendNote`): the runner warns the sport's line. */
  | { readonly kind: 'noted'; readonly line: SportLine };

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
export type Planned = Exclude<MatchEffect, SaveEffect> | Omit<SaveEffect, 'n'>;

/** When a tap or an Undo was made (`at`, ISO), and on which clock (`QueuedEvent.stampedOn`, ruling 149): the sender's. */
export type TapStamp = { readonly at: string; readonly stampedOn?: 'server' };

export type MatchEvent<S extends SportTypes = SportTypes> =
  | ({ readonly kind: 'tap'; readonly tap: S['tap']; readonly key: string } & TapStamp)
  | ({
      readonly kind: 'undo';
      readonly key: string;
      /** The sport's ending prompt's Undo (badminton's Void sanction): taken only while an ending waits. */
      readonly only?: 'ending';
    } & TapStamp)
  | { readonly kind: 'pickServer'; readonly side: PadSide }
  /** The scorer's pending picks, the whole map (S2-4 plan Task 3): taken whenever the match folds. */
  | { readonly kind: 'setPicks'; readonly picks: PendingPicks }
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
  /** A sheet that lists the match's people opened: the bootstrap again, paced (S2-6 ruling 181). */
  | { readonly kind: 'peopleSheet' }
  | { readonly kind: 'background' }
  | { readonly kind: 'tick' }
  /** The queue save numbered `n` landed. */
  | { readonly kind: 'saved'; readonly n: number }
  /** A save failed: `key` is the tap it was to make durable, if any. */
  | { readonly kind: 'saveFailed'; readonly key: string | null }
  /** A save's boot cache could not be written (the queue's own outcome is `saved` or `saveFailed`). */
  | { readonly kind: 'bootSaveFailed' }
  /** A save's boot cache was written: the scorer's pick and pending picks as that save held them (`boot`) are on disk. */
  | { readonly kind: 'bootSaved'; readonly boot: BootCache }
  | { readonly kind: 'say'; readonly words: PadLineWords }
  /** The scorer's answer to the reconnect question (`scoringMatchAsk.ts`): send the queued taps, or discard them. */
  | { readonly kind: 'answerAsk'; readonly answer: 'send' | 'discard' }
  /** A held tap's payload, amended by the scorer before it is sent (S2-7 ruling 234; `amendQueued`). */
  | { readonly kind: 'amend'; readonly key: string; readonly payload: unknown }
  /** Every held tap let go, to be sent now (the sport's details turned off; `releaseHeld`). */
  | { readonly kind: 'release' };

/** What is held when a match opens: the queue and ledger from disk, and what the boot cache kept. */
export type MatchHeld<S extends SportTypes = SportTypes> = {
  /** The sport the match opens as: the one its link was kept with (`scoringLinkStore`). */
  readonly sport: ScoringSport<S>;
  readonly queue: MatchQueue;
  readonly ledger: readonly LedgerEvent[];
  readonly bootstrap: Bootstrap | null;
  readonly toss: PadSide | null;
  /** The pending picks the boot cache kept; absent is none. */
  readonly picks?: PendingPicks;
  readonly judge: 'fold' | 'trust';
  readonly foreground: boolean;
  /** The rules version to send under when no bootstrap is held: the newest a queued tap was made under. */
  readonly rulesVersion: number;
  /** The start of the Undo window of this launch's decision of the match, if the hub kept one (`MatchState.decidedAt`). */
  readonly decidedAt: number | null;
};

export const LOAD_BOOTSTRAP: MatchEffect = { kind: 'loadBootstrap' };

/** Why the match takes no more taps from this phone, whichever of the queue and a read said it. */
export const deadOf = (state: MatchState): QueueDead | null =>
  state.sync.queue.dead ?? state.closed;

/** The server needs a newer engine than this build's: its answer (426) or its bootstrap said so. */
export const isOutdated = (state: MatchState): boolean =>
  state.sync.status === 'outdated' ||
  (state.bootstrap !== null && state.bootstrap.epochRequired > state.sync.engineEpoch);

export const closedByStatus = (status: string): QueueDead | null =>
  status === 'finalized' || status === 'cancelled' ? status : null;

/** The screens whose card means the pad takes no tap (the others are the pad itself, or the Start screen). */
export const CARD_SCREENS: ReadonlySet<string> = new Set([
  'viewOnly',
  'divisionNotStarted',
  'waiting',
]);

/** Whether the match is scored as `sport`: it opened with that very sport, so its sport-typed parts are `S`'s. */
export function scoredAs<S extends SportTypes>(
  state: MatchState,
  sport: ScoringSport<S>,
): state is MatchState<S> {
  return state.sport === sport;
}

/** The bootstrap names the sport the match is scored as: the one its fold, its taps and its pad are. */
const ownSport = (state: MatchState): boolean =>
  state.bootstrap !== null && state.bootstrap.sportKey === state.sport.key;

/** Whether the pad takes a tap now. */
export function padTakes(state: MatchState): boolean {
  const { bootstrap, sync } = state;
  if (bootstrap === null || !ownSport(state)) return false;
  if (deadOf(state) !== null || isOutdated(state) || sync.status === 'tooLarge') return false;
  return !CARD_SCREENS.has(bootstrap.screen);
}

/** Order-free equality of two JSON values: the server's copy of a payload may come back with its keys in another order. */
export function sameJson(a: unknown, b: unknown): boolean {
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
export function resolved(waiting: QueuedEvent, eventId: string): QueuedEvent {
  const { key, rulesVersion, createdAt, stampedOn, attempts } = waiting;
  return {
    key,
    ...undoEventFor(eventId),
    rulesVersion,
    createdAt,
    ...(stampedOn === undefined ? {} : { stampedOn }),
    attempts,
  };
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
export function foldOfState<S extends SportTypes>(
  state: MatchState<S>,
  queued: readonly QueuedEvent[] = foldQueue(state),
): SportFold<S> | null {
  const { bootstrap } = state;
  if (bootstrap === null || !ownSport(state)) return null;
  return state.sport.fold({
    bootstrap,
    ledger: state.sync.ledger,
    queued,
    ownEventIds: ownIds(state),
    toss: state.toss,
    picks: state.picks,
  });
}

/**
 * The match as the screen and Home read it (controller, 2026-11-04; AGENTS §2): `foldOfState`, except under a result
 * that stands (`resultStands`: finalized, or carried forward), where it is the server's ledger alone. The taps the
 * queue still holds there were refused or will never be taken, and a fold that counted them would show a score the
 * server does not have: a refused Undo would take a point off a recorded result. Judging a tap (send, drop, Undo's
 * target) keeps the fold of the queue: that is not what the operator reads.
 */
export function foldRead<S extends SportTypes>(state: MatchState<S>): SportFold<S> | null {
  return foldOfState(state, resultStands(deadOf(state)) ? [] : foldQueue(state));
}

/** What Undo would take back now: the fold's legal queued taps and the ledger, the one rule (`undoTarget`). */
export function undoTargetOf<S extends SportTypes>(
  state: MatchState<S>,
  fold: SportFold<S>,
): UndoTarget {
  const legal = fold.kind === 'folded' ? new Set(fold.legalQueued) : new Set<string>();
  const taps = foldQueue(state).filter((tap) => legal.has(tap.key));
  return undoTarget(state.sync.ledger, taps, ownIds(state), (key) =>
    canDiscardQueued(state.sync, key),
  );
}

export type Part<S extends SportTypes = SportTypes> = {
  readonly state: MatchState<S>;
  readonly effects: readonly Planned[];
};

/** What a handler decided. `pump: false`: a tap was added to the queue, which is saved before anything is sent. */
export type Handled<S extends SportTypes = SportTypes> = Part<S> & {
  readonly outcome: PadOutcome | null;
  readonly pump: boolean;
};

export const part = <S extends SportTypes>(
  state: MatchState<S>,
  effects: readonly Planned[] = [],
): Part<S> => ({
  state,
  effects,
});

export const handled = <S extends SportTypes>(
  p: Part<S>,
  extra: { outcome?: PadOutcome; pump?: boolean } = {},
): Handled<S> => ({
  ...p,
  outcome: extra.outcome ?? null,
  pump: extra.pump ?? true,
});

export const refused = <S extends SportTypes>(
  state: MatchState<S>,
  refusal: PadRefusal,
): Handled<S> => handled(part(state), { outcome: refusing(refusal), pump: false });

/** The match as an "undone" line was said over it: the ledger's length and the queue's keys. Any change ends the line. */
export const signatureOf = (state: MatchState): string =>
  `${state.sync.ledger.length}:${state.sync.queue.pending.map((tap) => tap.key).join(',')}`;

export const withPending = <S extends SportTypes>(
  state: MatchState<S>,
  pending: readonly QueuedEvent[],
): MatchState<S> => ({
  ...state,
  sync: { ...state.sync, queue: { ...state.sync.queue, pending } },
});
