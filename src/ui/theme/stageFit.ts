import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * R-F5. The round line is the least important line in the status strip, so it is the one that yields: it shows
 * only when, with the status and the caption still reserved at their worst case, the label leaves room for it.
 * No reserve was added to the strip. It is 180 dp wherever the camera box yields to it, which is every real screen:
 * the controls half is a fixed 310 dp (owner, 2026-10-08), so the camera half is the window less that, 330 dp at
 * 640 × 360, and the strip leaves the box 180 dp, a box of 320 × 180, where the half would hold 186. (Before that
 * rule the camera half was 304 dp at 640 × 360, the box 171 dp tall and the strip 189 dp, which let three long lines
 * show the line there; no screen has a 189 dp strip now.) So a label of four lines (a long double) leaves the line no
 * room anywhere, and so do three lines of either size; a label of one or two lines shows it everywhere. Unmeasured
 * (a strip or a label of 0) it is hidden too, so a phone never paints a line it may have to take back.
 */
export function stageFits(stripHeight: number, labelHeight: number): boolean {
  if (stripHeight <= 0 || labelHeight <= 0) return false;
  const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
  const status = layout.statusLinesMax * typeScale.body.lineHeight;
  const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
  // 2 padding + stage + label + status + caption + the 3 gaps between the 4 items.
  const needed =
    2 * layout.stripPadV + stage + labelHeight + status + caption + 3 * layout.stripGap;
  return needed <= stripHeight;
}
