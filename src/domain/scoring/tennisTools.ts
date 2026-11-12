import type { PadText, PadTool } from '@/domain/scoring/padView';
import type { TennisDisplay, TennisPadKey } from '@/domain/scoring/tennisTypes';

/**
 * Tennis's tool row (S2-7 Task 6; rulings 219, 221, 228, 231, 232): four cells that always fill the row, in this order,
 * Violation, Break, Award game, Set score. A cell is never removed or moved: Set score is disabled once the set has a point
 * and Award game in a breaker (the engine refuses it there), so nothing changes width under the scorer's thumb (volleyball
 * F3). There is no More. The words a cell of four cannot hold at 320 dp are drawn short and said in full (`tennisFit.test.ts`
 * decides which).
 */

type Text = PadText<TennisPadKey>;
type Tool = PadTool<TennisPadKey>;

const VIOLATION = 'violation';
const BREAK = 'break';
const AWARD = 'award';
const SET_SCORE = 'setScore';

/** The four cells' slots: fixed, whatever the state. */
export const TENNIS_TOOL_SLOTS = 4;

/** The pad takes a tap: the match is on, and no default of the organiser's waits for its forfeit (G1). */
export const takesTaps = (display: TennisDisplay): boolean =>
  display.phase === 'live' && !display.endingPending;

/** Whether the set under way has a point: a game won, or a call off love. A set score is refused once it has (TN-SS-1). */
const setHasAPoint = (display: TennisDisplay): boolean =>
  display.games.first + display.games.second > 0 ||
  display.call.first !== '0' ||
  display.call.second !== '0';

/** Set score is on offer before a set's first point, as volleyball's: the cell stays, disabled, after it. */
export const tennisSetScoreOffered = (display: TennisDisplay): boolean =>
  takesTaps(display) && !setHasAPoint(display);

/** The cells, in order: none before the start, once decided or ended, or while a default waits. */
export function tennisTools(display: TennisDisplay): readonly Tool[] {
  if (!takesTaps(display)) return [];
  return [
    cell(VIOLATION, 'scoring.tennis.tool.violationShort', 'scoring.tennis.tool.violation', true),
    cell(BREAK, 'scoring.tennis.tool.break', null, true),
    cell(
      AWARD,
      'scoring.tennis.tool.awardShort',
      'scoring.tennis.tool.award',
      display.breaker === null,
    ),
    cell(SET_SCORE, 'scoring.tennis.tool.setScore', null, tennisSetScoreOffered(display)),
  ];
}

/** A plain outline with no second line; `said` is the full word where the drawn one is short. */
function cell(
  id: string,
  drawn: TennisPadKey,
  spoken: TennisPadKey | null,
  enabled: boolean,
): Tool {
  const label: Text = { key: drawn };
  return {
    id,
    label,
    ...(spoken === null ? {} : { said: { key: spoken } }),
    detail: null,
    kind: 'standard',
    enabled,
  };
}

/** The tool ids `tennisTools` gives, read back; anything else is null. */
export function parseTennisTool(
  id: string,
):
  | { readonly violation: true }
  | { readonly break: true }
  | { readonly award: true }
  | { readonly setScore: true }
  | null {
  if (id === VIOLATION) return { violation: true };
  if (id === BREAK) return { break: true };
  if (id === AWARD) return { award: true };
  return id === SET_SCORE ? { setScore: true } : null;
}
