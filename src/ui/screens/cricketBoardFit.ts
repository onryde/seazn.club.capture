import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * The over strip's chips in rows (T19 fix 5, Part 5): each chip is `layout.overChip` wide and `space.xs` from the next, and
 * a row holds as many as the board's width allows. A width not measured yet holds one row: the strip's first frame is the
 * usual over.
 */
export function chipsPerRow(width: number | null): number {
  if (width === null) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor((width + space.xs) / (layout.overChip + space.xs)));
}

/** The rows the over's chips take: one while there are none or they fit, then a row more for each full one. */
export function chipRows(count: number, width: number | null): number {
  return Math.max(1, Math.ceil(count / chipsPerRow(width)));
}

/** The strip's height with that many rows: the label, a row of chips, and a row more under it for each wrap. */
export function stripHeight(rows: number): number {
  return layout.overStrip + (rows - 1) * (layout.overChip + space.xs);
}

/**
 * What the board draws, by the room it has (T19 fix 5, Part 3; the controller's ruling, device run 11). The keys' block is
 * fixed at the bottom and the board above it never overlaps it, so when the board's lines do not fit the height left they
 * give way in this order, and only so far as they must: (1) the gaps between the regions tighten to `space.xs`; (2) the
 * over's chip strip hides; (3) the chase line joins the innings line, on one line that shrinks to fit. Never the score,
 * the team line or the crease: the scorer needs those for every ball.
 */
export type BoardFit = {
  readonly gap: number;
  readonly strip: boolean;
  readonly chaseJoined: boolean;
};

/** The rungs in order, the first being the board as designed. */
export const BOARD_RUNGS: readonly BoardFit[] = [
  { gap: space.sm, strip: true, chaseJoined: false },
  { gap: layout.boardGapTight, strip: true, chaseJoined: false },
  { gap: layout.boardGapTight, strip: false, chaseJoined: false },
  { gap: layout.boardGapTight, strip: false, chaseJoined: true },
];

/** The score panel's height: its token, less the chase line and its gap once the chase has joined the innings line. */
export function panelHeight(chaseJoined: boolean): number {
  return chaseJoined ? layout.scorePanelJoined : layout.scorePanel;
}

/** What a rung asks of the board's height: the panel, the crease, the strip when it shows, and the gaps between them. */
export function boardNeeds(
  fit: BoardFit,
  rows: number,
  panel: number = panelHeight(fit.chaseJoined),
  freeHit = false,
): number {
  const caption = freeHit ? typeScale.metricUnit.lineHeight : 0;
  const regions = panel + 3 * layout.creaseRow + caption + (fit.strip ? stripHeight(rows) : 0);
  const count = 1 + (freeHit ? 1 : 0) + (fit.strip ? 1 : 0);
  return regions + count * fit.gap;
}

/**
 * The first rung that fits `room` dp, else the last (the board is then clipped at its bottom by its own edge, never drawn
 * over the keys). An unmeasured board is drawn as designed, and so is a result's (no keys stand under it). A free hit due is a
 * line of the board's own (`FreeHit`), counted here and never dropped.
 */
export function fitBoard(
  room: number | null,
  chips: number,
  width: number | null,
  result = false,
  freeHit = false,
): BoardFit {
  const first = BOARD_RUNGS[0] as BoardFit;
  // A result has no keys under it, so its board has room and is not given way (the strip stays).
  if (room === null || result) return first;
  const rows = chipRows(chips, width);
  const fits = (fit: BoardFit) => boardNeeds(fit, rows, undefined, freeHit) <= room;
  return BOARD_RUNGS.find(fits) ?? (BOARD_RUNGS[BOARD_RUNGS.length - 1] as BoardFit);
}
