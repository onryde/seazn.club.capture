import { layout, space } from '@/ui/theme/tokens';

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
