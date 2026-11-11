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
 * (a touch target at least), with the tier's gap of padding above and below and the 2 dp lime hairline under it (rulings 147 and 152).
 */
export function faceHeight(tier: BoardTier): number {
  const { gap, time } = TIER_FACES[tier];
  return (
    Math.max(layout.touch, typeScale[time].lineHeight + PERIOD_HEIGHT) +
    2 * gap +
    layout.clockHairline
  );
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
 * The Goal square's side (ruling 144): the column's whole text width, capped by the height the column leaves it. A
 * square that does not fit the height shrinks to it and is centred.
 */
export const goalSide = (room: { readonly width: number; readonly height: number }): number =>
  Math.min(room.width, room.height);

/**
 * The least height a column holds in: its padding and the colour bar on its top edge, the head, the Goal square, the row of three squares (a touch target)
 * and its note line, a gap before each of the three under the head's.
 */
export const columnHeight = (tier: BoardTier): number =>
  2 * space.sm +
  layout.padSideBar +
  headHeight(tier) +
  goalHeight(tier) +
  3 * TIER_FACES[tier].gap +
  layout.touch +
  NOTE_HEIGHT;

/**
 * The compact threshold: the least board height the full tier holds in, the hero over a column of its least size. A
 * board under it is compact. It is built with the least row of squares (48 dp); a column wide enough for squares taller
 * than that (a tablet: 600 dp wide gives 84) would overflow by the difference just above this height. No phone does
 * (every phone this wide is taller than the threshold first), so the board's width is not asked for here.
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

/**
 * The full tier's clock digits in dp for a board `width` by `height` dp laid out (owner ruling 150): `clockHero`'s size
 * when the column has no height to spare, growing with the height that is left once the Goal square (which is width-capped,
 * ruling 144) and the rest of the column are in, up to `layout.clockHeroMax`, and never so big that "120+15:00" takes more
 * than the face at `layout.clockFloor`. Layout-time only: no tick reads it.
 */
export function clockHeroSize(board: { readonly width: number; readonly height: number }): number {
  const base = typeScale.clockHero;
  const text = (board.width - space.sm) / 2 - 2 * space.sm;
  const row = Math.max(layout.touch, (text - 2 * space.xs) / 3);
  const gap = TIER_FACES.full.gap;
  const fixed = 2 * space.sm + layout.padSideBar + headHeight('full') + 3 * gap + row + NOTE_HEIGHT;
  const spare = board.height - clockBarHeight('full') - fixed - Math.max(goalHeight('full'), text);
  const ratio = base.lineHeight / base.fontSize;
  const grown = Math.floor((base.lineHeight + Math.max(0, spare)) / ratio);
  const widest = Math.floor(board.width / (layout.clockWidestEm * layout.clockFloor));
  return Math.max(base.fontSize, Math.min(grown, layout.clockHeroMax, widest));
}

/** The line height for a clock hero of `size` dp: `clockHero`'s own ratio, rounded down so it never takes more than it was given. */
export const clockHeroLine = (size: number): number =>
  Math.floor((size * typeScale.clockHero.lineHeight) / typeScale.clockHero.fontSize + 1e-9);
