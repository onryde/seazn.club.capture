import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * R-F5. The round line is the least important line in the status strip, so it is the one that yields: it shows
 * only when, with the status and the caption still reserved at their worst case, the label leaves room for it.
 * No reserve was added to the strip, which is 180 dp at every real geometry, so a label of three or four lines
 * (a long double) leaves it no room and the line is hidden. Unmeasured (a strip or a label of 0) it is hidden too,
 * so a phone never paints a line it may have to take back.
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
