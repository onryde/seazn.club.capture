import { layout, space } from '@/ui/theme/tokens';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * A board of a clock bar over team columns (S2-5 design §6.1, §6.2): its two tiers and the heights each needs (the
 * controller's fix-round 2 ruling R1). The board's own height picks the tier, so a short phone never overflows: full
 * where the board holds the clock bar over a column of three at full size, else compact, with the time and the score a
 * step down (`tallyCompact`), each name on one line, and the clock bar one row, the period under the time.
 * footballFit.test.ts writes the sums out and holds them at 320 and 360 dp, 560 and 640 tall.
 */
export type BoardTier = 'full' | 'compact';

type TierFaces = {
  /** A team's name: its lines, then an ellipsis. */
  readonly nameLines: number;
  readonly score: TypeRole;
  readonly time: TypeRole;
};

export const TIER_FACES: Readonly<Record<BoardTier, TierFaces>> = {
  full: { nameLines: layout.padNameLines, score: 'scoreCompact', time: 'tally' },
  compact: { nameLines: 1, score: 'tallyCompact', time: 'tallyCompact' },
};

/** The marks' row: one line of the count's role, whatever it holds (fix-round ruling b). A card icon sits inside it. */
export const MARKS_HEIGHT = typeScale.periodScore.lineHeight;

/** The period's line: under the time and the button when full, under the time inside the face when compact. */
const PERIOD_HEIGHT = typeScale.diagSection.lineHeight;

/** The clock bar and the gap under it: a touch target's row (the button), and the period's line, full or in the row. */
export function clockBarHeight(tier: BoardTier): number {
  if (tier === 'full') return layout.touch + PERIOD_HEIGHT + space.sm;
  const face = typeScale[TIER_FACES.compact.time].lineHeight + PERIOD_HEIGHT;
  return Math.max(layout.touch, face) + space.sm;
}

/** A column's head: the name's lines, the score's line and the marks' row, a gap between each. */
export function headHeight(tier: BoardTier): number {
  const { nameLines, score } = TIER_FACES[tier];
  const name = nameLines * typeScale.matchName.lineHeight;
  return name + space.xs + typeScale[score].lineHeight + space.xs + MARKS_HEIGHT;
}

/** The least height a column holds its head in with a touch target per button: padding, the head, a gap and a target each. */
export const columnHeight = (tier: BoardTier, buttons: number): number =>
  2 * space.sm + headHeight(tier) + buttons * (space.sm + layout.touch);

/** The most buttons a team's column has (football's Goal, Card and Sub). */
const MOST_BUTTONS = 3;

/**
 * The compact threshold: the least board height the full tier holds in, the clock bar over a column of three. A board
 * under it is compact.
 */
export const BOARD_FULL_HEIGHT = clockBarHeight('full') + columnHeight('full', MOST_BUTTONS);

/** The tier a board laid out `height` tall takes. */
export const boardTier = (height: number): BoardTier =>
  height < BOARD_FULL_HEIGHT ? 'compact' : 'full';
