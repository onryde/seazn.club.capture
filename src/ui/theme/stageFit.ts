import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * R-F5. The round line is the least important line in the status strip, so it is the one that yields: it shows
 * only when, with the status and the caption still reserved at their worst case, the label leaves room for it.
 * No reserve was added to the strip. It is 180 dp where the camera box yields to it (screens 800 wide and up) and
 * 189 dp at 640 × 360, where the controls half's padding leaves the camera half 304 dp wide and the box is the
 * half's whole width. So a label of four lines (a long double) leaves the line no room anywhere, and so does
 * one of three regular lines; three long lines leave it room only at 640 × 360. Unmeasured (a strip or a label of
 * 0) it is hidden too, so a phone never paints a line it may have to take back.
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
