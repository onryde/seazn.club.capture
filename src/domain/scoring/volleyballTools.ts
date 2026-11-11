import type { PadSide, PadText, PadTool } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import type { VolleyballDisplay, VolleyballPadKey } from '@/domain/scoring/volleyballTypes';

/**
 * Volleyball's tool row and More sheet (S2-6 Task 6; ruling 178, layout A), split from `volleyballPad` before it grew past
 * 500 lines: the cells, in order, are Set score (before a set's first rally only), Who serves? (only where a lost pick
 * must be asked for mid-set), Timeout, Sub (indoor only) and More (the sanctions), at most four.
 */

type Text = PadText<VolleyballPadKey>;
type Tool = PadTool<VolleyballPadKey>;

const SET_SCORE = 'setScore';
const TIMEOUT = 'timeout';
const SUB = 'sub';
const SERVING = 'serving';
const MORE = 'more';

/** The cells with no second line: a plain outline, usable. */
const PLAIN = { detail: null, kind: 'standard', enabled: true } as const;

/** The pad takes a tap: the match has started and is not decided. */
export const takesTaps = (display: VolleyballDisplay): boolean =>
  display.phase !== 'notStarted' && display.phase !== 'decided';

/** Set score is on offer before a set's first rally: before the match's, and between sets (as table tennis's). */
export const volleyballSetScoreOffered = (display: VolleyballDisplay): boolean =>
  takesTaps(display) && (display.phase === 'pre' || display.phase === 'betweenGames');

/**
 * A row of this many cells leaves each cell's text 48 dp at 320 (`volleyballFit.test.ts`); three or fewer leave 72.67 or
 * more. Only here do the full words of Timeout not fit.
 */
const CROWDED_ROW = 4;

/**
 * The cells, in order. Who serves? stands only mid-set (`anchorNeeded` with a rally standing is a lost pick, `phase`
 * live): at a set's 0-0 the first tap asks (ruling 180), so no cell stands for it and no row ever holds five. A row of four
 * draws Timeout in its short word (`crowded`).
 */
export function volleyballTools(display: VolleyballDisplay): readonly Tool[] {
  if (display.phase === 'notStarted') return [];
  const cells = [
    ...setScoreTool(display),
    ...servingTool(display),
    ...timeoutTool(display),
    ...subTool(display),
    ...moreTool(display),
  ];
  return cells.length < CROWDED_ROW ? cells : cells.map(crowded);
}

/** A cell in a row of four: Timeout's short word drawn, and the full word spoken, so a screen reader hears one name. */
function crowded(tool: Tool): Tool {
  if (tool.id !== TIMEOUT) return tool;
  return {
    ...tool,
    label: { key: 'scoring.volleyball.tool.timeoutShort' },
    said: tool.said ?? tool.label,
  };
}

function setScoreTool(display: VolleyballDisplay): readonly Tool[] {
  if (!volleyballSetScoreOffered(display)) return [];
  return [{ id: SET_SCORE, label: { key: 'scoring.volleyball.tool.setScore' }, ...PLAIN }];
}

function servingTool(display: VolleyballDisplay): readonly Tool[] {
  if (!takesTaps(display) || display.phase !== 'live' || !display.anchorNeeded) return [];
  return [{ id: SERVING, label: { key: 'scoring.volleyball.tool.serving' }, ...PLAIN }];
}

function timeoutTool(display: VolleyballDisplay): readonly Tool[] {
  if (!takesTaps(display) || !display.records.timeouts) return [];
  return [{ id: TIMEOUT, label: { key: 'scoring.volleyball.tool.timeout' }, ...PLAIN }];
}

/** Sub, indoor only: beach records none, and the engine would refuse it (ruling 175). Said in full, drawn short. */
function subTool(display: VolleyballDisplay): readonly Tool[] {
  if (!takesTaps(display) || !display.records.substitutions) return [];
  return [
    {
      id: SUB,
      label: { key: 'scoring.volleyball.tool.sub' },
      said: { key: 'scoring.volleyball.sheet.sub' },
      ...PLAIN,
    },
  ];
}

function moreTool(display: VolleyballDisplay): readonly Tool[] {
  if (volleyballMoreItems(display).length === 0) return [];
  return [{ id: MORE, label: { key: 'scoring.volleyball.tool.more' }, ...PLAIN }];
}

/** The tool ids `volleyballPad` gives, read back; anything else is null. */
export function parseVolleyballTool(
  id: string,
):
  | { readonly setScore: true }
  | { readonly timeout: true }
  | { readonly sub: true }
  | { readonly more: true }
  | { readonly serving: true }
  | null {
  if (id === SET_SCORE) return { setScore: true };
  if (id === TIMEOUT) return { timeout: true };
  if (id === SUB) return { sub: true };
  if (id === SERVING) return { serving: true };
  return id === MORE ? { more: true } : null;
}

/** What the More sheet can list: a Sanction for each side (Timeout, Sub and Set score are cells). */
export type VolleyballMoreItem = 'sanction.first' | 'sanction.second';

/** The More sheet's items: a Sanction for each side while the match records them. Nothing before the start or once decided. */
export function volleyballMoreItems(display: VolleyballDisplay): readonly VolleyballMoreItem[] {
  if (!takesTaps(display) || !display.records.sanctions) return [];
  return ['sanction.first', 'sanction.second'];
}

/** One choice in the More sheet: the item and its words. */
export type VolleyballMoreOption = { readonly id: VolleyballMoreItem; readonly label: Text };

/** The More sheet's choices in words, in the items' order ("Sanction · Falcons"). */
export function volleyballMoreOptions(display: VolleyballDisplay): readonly VolleyballMoreOption[] {
  const side = (of: PadSide) => sideNames(display.sides[of]);
  return volleyballMoreItems(display).map((id) => ({
    id,
    label: {
      key: 'scoring.volleyball.more.sanction',
      vars: { side: side(id === 'sanction.first' ? 'first' : 'second') },
    },
  }));
}
