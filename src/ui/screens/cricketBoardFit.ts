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

/** The deliveries a strip shows when the over's chips do not fit one row: the last six, newest at the right (owner, 2026-11-10). */
export const LAST_BALLS = 6;

/**
 * How many of an over's `total` chips the strip draws (T19 fix 8; owner, 2026-11-10: "if doesn't fit, show only last 6
 * balls?"). A board with keys under it keeps the strip to ONE row, so an over whose chips do not fit one row shows its last
 * six; six always fit a row from 288 dp (6 x 40 + 5 x 4 = 260). A result's board has no keys and room, so it shows every chip
 * and they wrap.
 */
export function chipsShown(total: number, width: number | null, result: boolean): number {
  if (result || total <= chipsPerRow(width)) return total;
  return Math.min(total, LAST_BALLS);
}

/** The strip's height with that many rows: the label, a row of chips, and a row more under it for each wrap. */
export function stripHeight(rows: number): number {
  return layout.overStrip + (rows - 1) * (layout.overChip + space.xs);
}

/**
 * What the board draws, by the room it has (T19 fix 5, Part 3; the controller's ruling, device run 11; reordered by T19 fix 6).
 * The keys' block is fixed at the bottom and the board above it never overlaps it, so when the board's lines do not fit the
 * height left they give way in this order, and only so far as they must: (1) the gaps between the regions tighten to
 * `space.xs`; (2) the chase joins the innings line, on one line that shrinks to fit; (3) the over's chip strip hides;
 * (4) the score is drawn compact (`tally`, a smaller face, so the panel is shorter). The chase joins BEFORE the strip hides
 * because joining keeps the chase's words (they shrink, none is lost) and hiding the strip loses the over, the ball by ball
 * the scorer is there for (owner, 2026-11-10: "no ball by ball scoring?" on the NE2211 at 360 × 804, where the board had
 * 269 dp and the old order hid the strip at rung 2 while rung 2's join would have fitted it). Never the team line, the
 * score's digits or the crease: the scorer needs those for every ball.
 */
export type BoardFit = {
  readonly gap: number;
  readonly strip: boolean;
  readonly chaseJoined: boolean;
  /** The score in the smaller face, the panel `layout.scorePanelCompact` tall. */
  readonly compact: boolean;
};

/** The rungs in order, the first being the board as designed. */
export const BOARD_RUNGS: readonly BoardFit[] = [
  { gap: space.sm, strip: true, chaseJoined: false, compact: false },
  { gap: layout.boardGapTight, strip: true, chaseJoined: false, compact: false },
  { gap: layout.boardGapTight, strip: true, chaseJoined: true, compact: false },
  { gap: layout.boardGapTight, strip: false, chaseJoined: true, compact: false },
  { gap: layout.boardGapTight, strip: false, chaseJoined: true, compact: true },
];

/** The score panel's height: its token, shorter once the chase has joined the innings line, shortest with a compact score. */
export function panelHeight(fit: BoardFit): number {
  if (fit.compact) return layout.scorePanelCompact;
  return fit.chaseJoined ? layout.scorePanelJoined : layout.scorePanel;
}

/** What a rung asks of the board's height: the panel, the crease, the strip when it shows, and the gaps between them. */
export function boardNeeds(
  fit: BoardFit,
  rows: number,
  panel: number = panelHeight(fit),
  freeHit = false,
): number {
  const caption = freeHit ? typeScale.metricUnit.lineHeight : 0;
  const regions = panel + 3 * layout.creaseRow + caption + (fit.strip ? stripHeight(rows) : 0);
  const count = 1 + (freeHit ? 1 : 0) + (fit.strip ? 1 : 0);
  return regions + count * fit.gap;
}

/**
 * The first rung that fits `room` dp, else the last (the board is then clipped at its bottom by its own edge, never drawn
 * over the keys). The strip is counted as ONE row of chips: with keys under the board it never takes more (`chipsShown`).
 * An unmeasured board is drawn as designed, and so is a result's (no keys stand under it). A free hit due is a
 * line of the board's own (`FreeHit`), counted here and never dropped.
 */
export function fitBoard(room: number | null, result = false, freeHit = false): BoardFit {
  const first = BOARD_RUNGS[0] as BoardFit;
  // A result has no keys under it, so its board has room and is not given way (the strip stays).
  if (room === null || result) return first;
  const fits = (fit: BoardFit) => boardNeeds(fit, 1, undefined, freeHit) <= room;
  return BOARD_RUNGS.find(fits) ?? (BOARD_RUNGS[BOARD_RUNGS.length - 1] as BoardFit);
}

/**
 * The height the fitted board leaves unused, 0 while unmeasured, for a result (no keys stand under it) or when the board is
 * too short. It all goes below the strip (`spareBelow`).
 */
export function boardSpare(
  room: number | null,
  fit: BoardFit,
  result = false,
  freeHit = false,
): number {
  if (room === null || result) return 0;
  return Math.max(0, room - boardNeeds(fit, 1, undefined, freeHit));
}

/**
 * Whether the spare is drawn: all of it goes UNDER the over strip, against the keys (T20 fix 12; owner, 2026-11-10: "why are
 * we not using this space?"), so the score is the board's first row. Only when it covers the board's gap, since the gap sits
 * before a spacer even at no height.
 */
export function spareBelow(spare: number, gap: number): boolean {
  return spare >= gap;
}
