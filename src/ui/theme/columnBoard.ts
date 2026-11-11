import { layout, space } from '@/ui/theme/tokens';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * A board of a clock hero over team columns (S2-5 design §6.1, §6.2; owner rulings 130 and 132, "Clock hero" and "the
 * score in the Goal square"): its two tiers and the heights each needs. The board's own height picks the tier, so a
 * short phone never overflows: full where the board holds the hero over a column whose Goal square is at least
 * `goalHeight('full')` tall, else compact, with the time and the numeral a step down (`tallyCompact`), the name on one
 * line, and the Goal square a 48 dp row of the numeral and its word. footballFit.test.ts writes the sums out.
 */
export type BoardTier = 'full' | 'compact';

type TierFaces = {
  /** A team's name: its lines, then an ellipsis. */
  readonly nameLines: number;
  /** The numeral in the Goal square. */
  readonly numeral: TypeRole;
  readonly time: TypeRole;
  /** The gap between a column's rows, and the one between the clock's face and its plate. */
  readonly gap: number;
};

export const TIER_FACES: Readonly<Record<BoardTier, TierFaces>> = {
  full: {
    nameLines: layout.padNameLines,
    numeral: 'scoreCompact',
    time: 'clockHero',
    gap: space.sm,
  },
  compact: { nameLines: 1, numeral: 'tallyCompact', time: 'tallyCompact', gap: space.xs },
};

/** The marks' row: one line of the count's role, whatever it holds (fix-round ruling b). A card icon sits inside it. */
export const MARKS_HEIGHT = typeScale.periodScore.lineHeight;

/** The period's line, under the time. */
export const PERIOD_HEIGHT = typeScale.diagSection.lineHeight;

/** The clock's face: the time and the period's line under it (a touch target at least). */
export function faceHeight(tier: BoardTier): number {
  return Math.max(layout.touch, typeScale[TIER_FACES[tier].time].lineHeight + PERIOD_HEIGHT);
}

/** The clock hero and the gap under it: the face, the gap, the one plate (a touch target), then the board's gap. */
export function clockBarHeight(tier: BoardTier): number {
  return faceHeight(tier) + TIER_FACES[tier].gap + layout.touch + space.sm;
}

/** A column's head: the name's lines, a gap, and the marks' row. */
export function headHeight(tier: BoardTier): number {
  const { nameLines, gap } = TIER_FACES[tier];
  return nameLines * typeScale.matchName.lineHeight + gap + MARKS_HEIGHT;
}

/** The Goal square's least height: a touch target compact; full, the numeral over its word with a little air. */
export function goalHeight(tier: BoardTier): number {
  if (tier === 'compact') return layout.touch;
  return typeScale[TIER_FACES.full.numeral].lineHeight + PERIOD_HEIGHT + 2 * space.sm;
}

/**
 * The least height a column holds in: its padding, the head, the Goal square, and Yellow and Red's row and Sub, each a
 * touch target, a gap before each of the three.
 */
export const columnHeight = (tier: BoardTier): number =>
  2 * space.sm + headHeight(tier) + goalHeight(tier) + 3 * TIER_FACES[tier].gap + 2 * layout.touch;

/**
 * The compact threshold: the least board height the full tier holds in, the hero over a column of its least size. A
 * board under it is compact.
 */
export const BOARD_FULL_HEIGHT = clockBarHeight('full') + columnHeight('full');

/** The tier a board laid out `height` tall takes. */
export const boardTier = (height: number): BoardTier =>
  height < BOARD_FULL_HEIGHT ? 'compact' : 'full';

/**
 * The Goal square's numeral size in dp, from the square's measured height (controller ruling 138): the full tier is
 * always the full size (`scoreCompact`); compact scales it by `layout.goalNumeralRatio`, never under `tallyCompact`'s size
 * (what a 48 dp square holds beside its word) and never over the full size. Layout-time only: no tick reads it.
 */
export function goalNumeralSize(tier: BoardTier, height: number): number {
  const most = typeScale[TIER_FACES.full.numeral].fontSize;
  if (tier === 'full') return most;
  const least = typeScale[TIER_FACES.compact.numeral].fontSize;
  return Math.min(most, Math.max(least, Math.round(height * layout.goalNumeralRatio)));
}
