import { undoWindowLeft } from '@/domain/scoring/undoWindow';
import { isDecided } from '@/domain/scoring/scoringMatchReads';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import type { MatchEvent, MatchState } from '@/domain/scoring/scoringMatchState';

/**
 * Where the Undo window of a decided match starts (owner, 2026-11-03): the moment of the DISPATCHED tap, this phone's
 * own, that takes the match from not decided to decided (`isDecided`, the one rule). Read off the state before and after
 * the step and kept on the state as `decidedAt`, the phone's clock in ms. Never read off a frame the pad happened to show:
 * a match that comes up decided (a ledger read, a rescan, a restart) has no tap of this launch to date it from, and a
 * window that was already running must not start again because a screen was opened or the ledger landed late.
 *
 * The rule is pure, like the reducer it is part of: `now` is the caller's. The window's length and its seconds are
 * `undoWindow.ts`; the hub keeps `decidedAt` between screens (`scoringHub.ts`), in memory only.
 */

/**
 * `decidedAt` after `event`, which took `before` to `after`. A tap that makes a decided match where there was none is the
 * decision; a decided match goes on with the start it has; a match no longer decided (Undo, a void, a discarded tap) has
 * none. A window already closed is left alone without a fold: its start is harmless until the next decision replaces it,
 * since nothing is open after 45 s and the next dispatched tap that decides starts again.
 */
export function decidedAtAfter<S extends SportTypes>(
  before: MatchState<S>,
  after: MatchState<S>,
  event: MatchEvent<S>,
  now: number,
): number | null {
  if (event.kind === 'tap') {
    if (!isDecided(after)) return null;
    return isDecided(before) ? after.decidedAt : now;
  }
  const held = after.decidedAt;
  if (held === null || undoWindowLeft(held, now) === null) return held;
  return isDecided(after) ? held : null;
}

/**
 * Whether Undo of the decision has run out: the match is decided and this phone's window is not open at `now`. A match
 * decided with no start (a restart, a rescan, the other scorer's tap) has no window to be open. The end of a game, and a
 * disqualification still waiting for its ending, are not decided: Undo has no limit there.
 */
export function undoRunOut<S extends SportTypes>(state: MatchState<S>, now: number): boolean {
  return undoWindowLeft(state.decidedAt, now) === null && isDecided(state);
}
