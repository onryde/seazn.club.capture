import { tennisPadRules } from '@seazn/engine/pad';
import type { TennisDisplay } from '@/domain/scoring/tennisTypes';

/**
 * Set score's fields (S2-7 Task 9; ruling 221): the games of the set for each side, then the tie-break's points only when the
 * engine says the games are a tie-break set's (`setScoreTakesTiebreak`), and a match tie-break decider entered as its points
 * in the first pair of fields. Every number is the engine's, read through `guarded` since the rules throw on a config the
 * schema refuses and the pad must never throw out of a sheet.
 */

const R = tennisPadRules;

/** The engine's reading of the set about to be scored: only the sets won so far (a match tie-break decider is one set all). */
const stateOf = (display: TennisDisplay) => ({
  setsWon: { home: display.setsWon.first, away: display.setsWon.second },
});

/** What the fields can hold at most: games (a match tie-break's points too), and a tie-break's points. */
export type SetScoreBounds = { readonly games: number; readonly tiebreak: number };

/** The most each field takes, or zero for both when the config is one the engine refuses (nothing can be entered). */
export function setScoreBounds(display: TennisDisplay): SetScoreBounds {
  try {
    return { games: R.gamesFieldBound(display.cfg), tiebreak: R.tiebreakFieldBound(display.cfg) };
  } catch {
    return { games: 0, tiebreak: 0 };
  }
}

/** Whether `first`–`second` games is a tie-break set's score, which the match banks only with the tie-break's points. */
export function setScoreAsksTiebreak(
  display: TennisDisplay,
  first: number,
  second: number,
): boolean {
  try {
    return R.setScoreTakesTiebreak(stateOf(display), display.cfg, first, second);
  } catch {
    return false;
  }
}
