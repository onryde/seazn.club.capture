import { type PadRefusal, TAKEN, refusing } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import { samePicks, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFold, SportTypes } from '@/domain/scoring/scoringSport';
import { undoRunOut } from '@/domain/scoring/scoringMatchWindow';
import { discardQueued } from '@/domain/scoring/sync';
import { type UndoTarget, undoEventFor } from '@/domain/scoring/undoTarget';
import {
  foldOfState,
  foldQueue,
  handled,
  padTakes,
  part,
  refused,
  signatureOf,
  undoTargetOf,
  withPending,
  type Handled,
  type MatchEvent,
  type MatchState,
  type TapStamp,
} from '@/domain/scoring/scoringMatchState';

/**
 * The scorer's taps and Undo (plan S2-1 Task 9): what a tap queues, what Undo takes back (a queued tap leaves, an event is
 * voided, a tap whose fate is unknown gets a void that waits for its answer). Handlers of `scoringMatch.ts`'s `step`.
 * What a tap is, and what the display says, are the match's sport's (`state.sport`).
 */

type Folded<S extends SportTypes> = Extract<SportFold<S>, { kind: 'folded' }>;
type TapEvent<S extends SportTypes> = Extract<MatchEvent<S>, { kind: 'tap' }>;
type UndoEvent = Extract<MatchEvent, { kind: 'undo' }>;

/** A new tap in the queue, made now under the rules the phone holds, at the sender's stamp and on its clock. */
const queuedOf = (
  state: MatchState,
  make: { type: string; payload: unknown; base?: number },
  key: string,
  { at, stampedOn }: TapStamp,
): QueuedEvent => ({
  key,
  type: make.type,
  payload: make.payload,
  rulesVersion: state.sync.rulesVersion,
  createdAt: at,
  ...(stampedOn === undefined ? {} : { stampedOn }),
  attempts: 0,
  ...(make.base === undefined ? {} : { base: make.base }),
});

const withTap = <S extends SportTypes>(state: MatchState<S>, tap: QueuedEvent): MatchState<S> => ({
  ...state,
  sync: {
    ...state.sync,
    queue: { ...state.sync.queue, pending: [...state.sync.queue.pending, tap] },
  },
});

/** Whether the fold takes `tap` on top of the queue, as the server would take it: the one judge of a tap (`legalQueued`). */
function takes<S extends SportTypes>(state: MatchState<S>, tap: QueuedEvent): boolean {
  const fold = foldOfState(state, [...foldQueue(state), tap]);
  return fold !== null && fold.kind === 'folded' && fold.legalQueued.includes(tap.key);
}

export function onTap<S extends SportTypes>(state: MatchState<S>, event: TapEvent<S>): Handled<S> {
  const fold = padTakes(state) ? foldOfState(state) : null;
  if (fold === null || fold.kind !== 'folded' || state.bootstrap === null)
    return refused(state, 'notNow');
  const { tap } = event;
  const { sport } = state;
  const made = sport.eventFor(tap, { bootstrap: state.bootstrap, display: fold.display });
  if (made === null) return refused(state, 'notNow');
  const queued = queuedOf(state, made, event.key, event);
  if (!takes(state, queued)) return refused(state, sport.refusalFor(tap));
  const toss = sport.tossOf(tap) ?? state.toss;
  const next = { ...withTap(state, queued), toss, line: null, undone: null };
  return handled(part(next), { outcome: TAKEN, pump: false });
}

export function onPick<S extends SportTypes>(state: MatchState<S>, side: PadSide): Handled<S> {
  const fold = foldOfState(state);
  if (fold === null || fold.kind !== 'folded' || !state.sport.notStarted(fold.display)) {
    return handled(part(state));
  }
  return handled(part({ ...state, toss: side }));
}

/**
 * The scorer's pending picks, the whole map (S2-4 plan Task 3), taken whenever the match folds: there is nothing to
 * pick from before. A map equal to the one held is nothing, so the state, the fold's input and the boot cache stay as
 * they were (`samePicks` here; `saveOf` compares the map by identity).
 */
export function onSetPicks<S extends SportTypes>(
  state: MatchState<S>,
  picks: PendingPicks,
): Handled<S> {
  const fold = foldOfState(state);
  if (fold === null || fold.kind !== 'folded' || samePicks(state.picks, picks)) {
    return handled(part(state));
  }
  return handled(part({ ...state, picks }));
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

export function onUndo<S extends SportTypes>(
  state: MatchState<S>,
  event: UndoEvent,
  now: number,
): Handled<S> {
  const fold = padTakes(state) ? foldOfState(state) : null;
  if (fold === null || fold.kind !== 'folded' || state.bootstrap === null)
    return refused(state, 'notNow');
  // A decided match's Undo is open for 45 s from this phone's deciding tap (owner, 2026-11-03), whatever the pad shows.
  if (undoRunOut(state, now)) return refused(state, 'notNow');
  const target = undoTargetOf(state, fold);
  if (target.kind === 'blocked') return refused(state, blockedRefusal(target.reason));
  if (event.only === 'ending' && !state.sport.awaitingEnding(fold.display)) {
    return refused(state, 'notNow');
  }
  const next = isStart(state, target) ? { ...state, toss: null } : state;
  return undoing(next, target, event, fold);
}

/** Undo with nothing of this phone's to take back says so; another scorer's tap since is the line's standing note. */
const blockedRefusal = (reason: Extract<UndoTarget, { kind: 'blocked' }>['reason']): PadRefusal =>
  reason === 'nothing' ? 'nothingToUndo' : 'notNow';

function undoing<S extends SportTypes>(
  state: MatchState<S>,
  target: Exclude<UndoTarget, { kind: 'blocked' }>,
  event: UndoEvent,
  fold: Folded<S>,
): Handled<S> {
  if (target.kind === 'awaitAnswer') return waiting(state, target.key, event);
  if (target.kind === 'queued') return discarding(state, target.key, fold);
  return voiding(state, target.eventId, event.key, event);
}

/**
 * Undo of a tap that may be at the server already: a void that names it by key, queued behind it and saved at once, so
 * a kill or leaving the match keeps it. Its tap's answer gives the id (`resolveUndo`).
 */
function waiting<S extends SportTypes>(
  state: MatchState<S>,
  tapKey: string,
  event: UndoEvent,
): Handled<S> {
  const made = queuedOf(state, undoEventFor(''), event.key, event);
  const next = { ...withTap(state, { ...made, voidsKey: tapKey }), line: null, undone: null };
  return handled(part(next), { outcome: TAKEN, pump: false });
}

/** Undo of a tap still only queued: it leaves the queue, nothing is sent, and the line says it was undone. */
function discarding<S extends SportTypes>(
  state: MatchState<S>,
  key: string,
  fold: Folded<S>,
): Handled<S> {
  const stepped = discardQueued(state.sync, key);
  const tap = state.sport.undoneOf(fold.display);
  const moved: MatchState<S> = { ...state, sync: stepped.state, line: null };
  const next: MatchState<S> = {
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
function voiding<S extends SportTypes>(
  state: MatchState<S>,
  eventId: string,
  key: string,
  stamp: TapStamp,
): Handled<S> {
  const queued = queuedOf(state, undoEventFor(eventId), key, stamp);
  return handled(part({ ...withTap(state, queued), line: null, undone: null }), {
    outcome: TAKEN,
    pump: false,
  });
}

/** An Undo that waits for a tap that is no longer queued (refused, dropped) is nothing now: it goes with it. */
export function withoutOrphanVoids<S extends SportTypes>(state: MatchState<S>): MatchState<S> {
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
