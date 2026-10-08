import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * R-F5. The round line is the least important line in the status strip, so it is the one that yields: it shows only
 * when the strip has room for it beside what is really there, and it never makes the picture smaller (the picture is
 * sized from the label alone, `stripReserve`, and this line is not one of its inputs).
 *
 * The strip is the padding, the label, the ONE message line and a gap between them (owner, 2026-10-08, "one single line
 * all the time"). The round line is a line of `metricUnit` and a gap more: 22 dp over the strip's reserve. So it shows
 * only where the window leaves the strip more than the picture's reserve, that is where the half limits the picture
 * (640 × 360, and 804 × 360 for a short label gives only 82 of the 88 it needs, so no). On the height-limited phones,
 * where the picture is as tall as the window allows, it is hidden: the picture, not the round line, keeps the room.
 * The caption is not a term: it takes the message line, never more room.
 *
 * Unmeasured (a strip or a label of 0) it is hidden too, so a phone never paints a line it may have to take back.
 */
export function stageFits(stripHeight: number, labelHeight: number): boolean {
  // An unmeasured label would read as an empty one and let the line in; an unmeasured strip (0) is never enough, below.
  if (labelHeight <= 0) return false;
  const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
  const message = layout.messageLines * typeScale.body.lineHeight;
  // The items in the strip: the round line, the label, the message line, with a gap between each pair.
  const needed = 2 * layout.stripPadV + stage + labelHeight + message + 2 * layout.stripGap;
  return needed <= stripHeight;
}
