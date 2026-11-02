import { badmintonEventFor } from '@/domain/scoring/badmintonEvents';
import { type BadmintonFold, undoneTap } from '@/domain/scoring/badmintonFold';
import { type PadRefusal, TAKEN, refusing } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
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
} from '@/domain/scoring/scoringMatchState';

/**
 * The scorer's taps and Undo (plan S2-1 Task 9): what a tap queues, what Undo takes back (a queued tap leaves, an event is
 * voided, a tap whose fate is unknown gets a void that waits for its answer). Handlers of `scoringMatch.ts`'s `step`.
 */

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

export function onTap(state: MatchState, event: Extract<MatchEvent, { kind: 'tap' }>): Handled {
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

export function onPick(state: MatchState, side: PadSide): Handled {
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

export function onUndo(state: MatchState, event: Extract<MatchEvent, { kind: 'undo' }>): Handled {
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

/** An Undo that waits for a tap that is no longer queued (refused, dropped) is nothing now: it goes with it. */
export function withoutOrphanVoids(state: MatchState): MatchState {
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
