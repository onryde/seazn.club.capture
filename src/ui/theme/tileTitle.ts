import { layout, space } from '@/ui/theme/tokens';
import type { TypeRole } from '@/ui/theme/type';

/** The sizes a Home tile's title is set at: `title`, or `action`, one step down the scale in the same face. */
export type TileTitleRole = Extract<TypeRole, 'title' | 'action'>;

/**
 * N31, fix round 1 (the controller's ruling, 2026-10-12): a tile's title wraps at spaces and never inside a word. Where
 * the title's room beside the icon is narrower than `layout.tileTitleRoom` (the widest word of any title in the four
 * languages, at `title`), the title steps down one size, to `action`. `headWidth` is the title's row as laid out
 * (`onLayout`), so it is Home's real width behind ShellFrame's insets, not the phone's; the room is that less the icon
 * and the gap after it. All three tiles share a width, so the three titles step together. Not measured yet (null), the
 * title is at `title`. homeFit.test.ts measures every title at the size this picks.
 */
export function tileTitleRole(headWidth: number | null): TileTitleRole {
  if (headWidth === null) return 'title';
  return headWidth - layout.modeIcon - space.sm >= layout.tileTitleRoom ? 'title' : 'action';
}
