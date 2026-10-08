import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * R-F5. The round line is the least important line in the status strip, so it is the one that yields: it shows only
 * when the strip has room for it beside what is really there, and it never makes the picture smaller (the picture is
 * sized from the label alone, `stripReserve`, and this line is not one of its inputs).
 *
 * The strip reserves room for a caption, two lines of `metricUnit`, whether or not one is up (owner, 2026-10-08,
 * option A). So with no caption that room is room: the round line fits the strip's reserve with 16 dp to spare, and
 * it shows wherever the strip is at least that tall, which is every real screen. With a caption up, the strip holds
 * the caption at its worst, two lines, and the round line needs 22 dp more than the reserve: it shows only where the
 * half, not the strip's reserve, limits the picture and the window leaves more (640 × 360 with a label of up to two
 * lines of 22: a 174.375 strip against the 170 it needs). The caption counts at its two lines whatever it really takes,
 * so a one-line caption does not bring the line back and take it away again as the text wraps.
 *
 * Unmeasured (a strip or a label of 0) it is hidden too, so a phone never paints a line it may have to take back.
 */
export function stageFits(stripHeight: number, labelHeight: number, captionUp: boolean): boolean {
  if (stripHeight <= 0 || labelHeight <= 0) return false;
  const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
  const status = layout.statusLinesMax * typeScale.body.lineHeight;
  const caption = captionUp ? layout.captionLinesMax * typeScale.metricUnit.lineHeight : 0;
  // The items in the strip: the round line, the label, the status line, and the caption when one is up.
  const gaps = captionUp ? 3 : 2;
  const needed =
    2 * layout.stripPadV + stage + labelHeight + status + caption + gaps * layout.stripGap;
  return needed <= stripHeight;
}
