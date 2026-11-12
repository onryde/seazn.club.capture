import type { NestedState } from '@seazn/engine/sports/nested';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * What the tennis fold keeps between events (S2-7 Task 18; ruling 238): the snapshot of the state after each event and the
 * two readings made from a pair of them, moved verbatim out of `tennisFold.ts` to keep it under its size.
 */

/** What the fold kept of the state just after an event: the numbers only, so a later event never reads a state that moved. */
export type Snap = {
  readonly sets: number;
  readonly home: number;
  readonly away: number;
  readonly kind: NestedState['points']['kind'];
  readonly phase: NestedState['phase'];
  /** The engine's serving side, null when it cannot name the order. */
  readonly server: PadSide | null;
};

export const START: Snap = {
  sets: 0,
  home: 0,
  away: 0,
  kind: 'standard',
  phase: 'pre',
  server: null,
};

/** The side that won the game (or set) an event closed, or none; a Set score closes a set with no game, and History reads it as its own group. */
export function closerOf(
  state: Readonly<NestedState>,
  before: Snap,
  after: Snap,
  closedSet: boolean,
): PadSide | null {
  const closed = state.sets[state.sets.length - 1];
  if (closedSet)
    return closed === undefined ? null : closed.home > closed.away ? 'first' : 'second';
  if (after.home + after.away <= before.home + before.away) return null;
  return after.home > before.home ? 'first' : 'second';
}

/** The set's game winners after an event: a closed set starts the next empty; a game won (awarded ones too) is added. */
export function gameWinsAfter(
  wins: readonly PadSide[],
  before: Snap,
  after: Snap,
  closed: PadSide | null,
): readonly PadSide[] {
  if (after.sets > before.sets) return [];
  return closed === null ? wins : [...wins, closed];
}
