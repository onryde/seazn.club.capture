import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

export type BoxSize = { readonly width: number; readonly height: number };

/**
 * The camera box's size (spec §1). The strip under it keeps its content height and the box gives
 * way: height = min(half width / aspect, screen height - the strip's content), and width = height x
 * aspect, so the box is always 16:9 and never wider than its half. Where the half is wide enough
 * and the screen tall enough the box is the whole half; on a wider, shorter screen (800 x 360) it is
 * narrower, centred in the half, and the strip is not clipped. Never negative: a strip taller than
 * the screen leaves a box of nothing.
 *
 * Plain numbers in and out: no token, no layout, so its tests are arithmetic.
 */
export function cameraBoxSize(input: {
  readonly halfWidth: number;
  readonly height: number;
  readonly stripContent: number;
  readonly aspect: number;
}): BoxSize {
  const { halfWidth, height, stripContent, aspect } = input;
  const boxHeight = Math.max(0, Math.min(halfWidth / aspect, height - stripContent));
  return { width: Math.min(halfWidth, boxHeight * aspect), height: boxHeight };
}

/**
 * The status strip's content at its worst, whatever the width (D17, F9, F20, Q4 option A): the
 * larger of the two label size rules, the status line's two lines of `body`, the caption's two lines,
 * the padding and the gaps between the three. The box is sized against this, so the strip is never
 * short of it. Real text staying inside these lines is the phone's to prove (Task 9).
 */
export const STRIP_RESERVE =
  2 * layout.stripPadV +
  Math.max(
    layout.labelLinesRegular * typeScale.label.lineHeight,
    layout.labelLinesMax * typeScale.labelLong.lineHeight,
  ) +
  layout.statusLinesMax * typeScale.body.lineHeight +
  layout.captionLinesMax * typeScale.metricUnit.lineHeight +
  2 * layout.stripGap;
