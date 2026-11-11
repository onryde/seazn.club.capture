import { layout, space } from '@/ui/theme/tokens';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * A board of a clock hero over team columns (S2-5 design §6.1, §6.2; owner rulings 130 and 132, "Clock hero" and "the
 * score in the Goal square"): its two tiers and the heights each needs. The board's own height picks the tier, so a
 * short phone never overflows: full where the board holds the hero over a column whose Goal square is at least
 * `goalHeight('full')` tall, else compact, with the time and the numeral a step down (`tallyCompact`), the name on one
 * line, and the Goal square as small as a 48 dp touch target (ruling 144: every button in a column is a square, the Goal
 * one as wide as the column and three small ones under it). footballFit.test.ts writes the sums out.
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

/**
 * The clock's face, a rounded panel on `surface` (owner ruling 146, the mockup): the time and the period's line under it
 * (a touch target at least), with the tier's gap of padding above and below.
 */
export function faceHeight(tier: BoardTier): number {
  const { gap, time } = TIER_FACES[tier];
  return Math.max(layout.touch, typeScale[time].lineHeight + PERIOD_HEIGHT) + 2 * gap;
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
 * The one line under the three small squares, reserved whether a note shows or not (a disabled Sub's "No subs left", too
 * long for a square), so a team without a team sheet never moves its squares off the other team's.
 */
export const NOTE_HEIGHT = typeScale.metricUnit.lineHeight;

/**
 * The side of a small square (owner ruling 144, "Big Goal, three small"): a third of the column's text width less the two
 * gaps between them (`space.xs`). The row is that tall, but never under a touch target: a column narrower than three
 * touch targets (about 160 dp, a phone under 360 wide) keeps `layout.touch` and the three squares are near-square
 * (controller ruling 145).
 */
export const smallSide = (textWidth: number): number => (textWidth - 2 * space.xs) / 3;
export const smallRowHeight = (textWidth: number): number =>
  Math.max(layout.touch, smallSide(textWidth));

/**
 * The Goal square's side (ruling 144): the column's whole text width, capped by the height the column leaves it. A
 * square that does not fit the height shrinks to it and is centred.
 */
export const goalSide = (room: { readonly width: number; readonly height: number }): number =>
  Math.min(room.width, room.height);

/**
 * The least height a column holds in: its padding, the head, the Goal square, the row of three squares (a touch target)
 * and its note line, a gap before each of the three under the head's.
 */
export const columnHeight = (tier: BoardTier): number =>
  2 * space.sm +
  headHeight(tier) +
  goalHeight(tier) +
  3 * TIER_FACES[tier].gap +
  layout.touch +
  NOTE_HEIGHT;

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
 * (what a 48 dp square holds over its word) and never over the full size. Layout-time only: no tick reads it.
 */
export function goalNumeralSize(tier: BoardTier, height: number): number {
  const most = typeScale[TIER_FACES.full.numeral].fontSize;
  if (tier === 'full') return most;
  const least = typeScale[TIER_FACES.compact.numeral].fontSize;
  return Math.min(most, Math.max(least, Math.round(height * layout.goalNumeralRatio)));
}
