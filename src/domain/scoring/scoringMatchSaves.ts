import { matchLabelOf } from '@/domain/scoring/matchLabel';
import { refusalLine } from '@/domain/scoring/padLine';
import type { MatchQueue } from '@/domain/scoring/queue';
import type { Bootstrap } from '@/domain/scoring/wire';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import {
  SAVE_RETRY_MS,
  part,
  type MatchState,
  type Part,
  type Planned,
  type SaveEffect,
  type SaveOwed,
} from '@/domain/scoring/scoringMatchState';

/**
 * The queue file (plan S2-1 Task 9): which step makes a save, and what a save that did not land means. Saves are
 * numbered by `step`; a debt is paid only by a save issued after the failure.
 */

/**
 * The save this step owes: the queue if it moved (or a failed save leaves it owed), the boot cache if the bootstrap or
 * the pick did, the ledger if it grew. The key of a tap this step added is named: if the save fails it never happened.
 */
export function saveOf(prev: MatchState, next: MatchState): Omit<SaveEffect, 'n'> | null {
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

/**
 * The queue as it goes to its file (plan S2-1 Task 10): it names its match as Home calls it ("Match 4"), so the
 * Continue card can say "4 taps from Match 4 not sent yet" for a match nobody is looking at. Only a held bootstrap can
 * name it; a sender without one, or an organiser who typed nothing, keeps the name the file had.
 */
export function namedQueue(queue: MatchQueue, bootstrap: Bootstrap | null): MatchQueue {
  const label = bootstrap === null ? '' : matchLabelOf(bootstrap);
  return label === '' || label === queue.label ? queue : { ...queue, label };
}

/** One queue save has been answered, whichever way. */
export const landedSave = <S extends SportTypes>(state: MatchState<S>): MatchState<S> => ({
  ...state,
  saving: Math.max(0, state.saving - 1),
});

/**
 * A queue save landed: whatever the file held that the queue does not is overwritten, if it was issued after the failure.
 * A tap's "not recorded" is now true.
 */
export function savedOf<S extends SportTypes>(state: MatchState<S>, n: number): MatchState<S> {
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
export function onSaveFailed<S extends SportTypes>(
  state: MatchState<S>,
  key: string | null,
  now: number,
): Part<S> {
  const pending = state.sync.queue.pending.filter((tap) => tap.key !== key || tap.attempts > 0);
  const moved = pending.length !== state.sync.queue.pending.length;
  const sync = moved ? { ...state.sync, queue: { ...state.sync.queue, pending } } : state.sync;
  const tap = key !== null || state.saveOwed?.tap === true;
  const owed: SaveOwed = { tap, retryAt: now + SAVE_RETRY_MS, after: state.saveSeq };
  const line = key === null ? state.line : refusalLine('scoring.refusal.savePending');
  const next: MatchState<S> = { ...state, sync, line, saveOwed: owed };
  const first = state.saveOwed === null || key !== null;
  return part(next, first && !moved ? [resave(sync.queue)] : []);
}

export const resave = (queue: MatchQueue): Planned => ({
  kind: 'save',
  queue,
  boot: null,
  ledger: null,
  tap: null,
});
