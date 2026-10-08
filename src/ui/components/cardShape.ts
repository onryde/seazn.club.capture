import { layout, space } from '@/ui/theme/tokens';

/**
 * How one of Home's cards is laid out: `stacked` is the portrait card, its parts one under another; `row` lays
 * the same parts in one row for landscape, where Home has no height to spare (spec §7, F15). Home picks it.
 */
export type CardShape = 'stacked' | 'row';

/**
 * The paddings of a card laid out as one row, from the board (After-you-stopped-landscape): 10 above and below,
 * 16 at the start and 12 at the end, where the button sits closer to the edge. Longhands, so no `padding`
 * shorthand has to be overridden.
 */
export const rowCardPadding = {
  paddingTop: layout.rowCardPadV,
  paddingBottom: layout.rowCardPadV,
  paddingLeft: space.md,
  paddingRight: layout.rowCardPadEnd,
} as const;
