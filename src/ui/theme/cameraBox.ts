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
 * The strip's reserve for a label that has been measured (owner, 2026-10-08, option A): the padding, the label at the
 * height it really came out, the status line's two lines of `body`, the caption's two lines and the gaps between the
 * three. Every term but the label is a fixed reservation, so the picture is the same size for the whole match: it
 * moves with the label's text and the half's width (what the label wraps in), and with nothing else. A status line,
 * a caption or the round line coming and going changes none of its inputs. The caption's room is reserved whether or
 * not a caption is up, and the round line borrows it while there is none (stageFit.ts).
 *
 * `labelHeight` is what `MatchLabel` reported: 0 is not measured yet (or the label is going), and so is anything that
 * is not a positive height. Then it is the worst case the strip can need, the larger of the label's two size rules, so
 * the strip is never short before the first measurement. A measured label taller than that (large system text) is
 * taken as measured: the strip really is that tall.
 */
export function stripReserve(labelHeight: number): number {
  const label = labelHeight > 0 ? labelHeight : WORST_LABEL;
  return (
    2 * layout.stripPadV +
    label +
    layout.statusLinesMax * typeScale.body.lineHeight +
    layout.captionLinesMax * typeScale.metricUnit.lineHeight +
    2 * layout.stripGap
  );
}

/**
 * The label at its worst, whatever the width (D17, F9, Q4 option A): the larger of its two size rules, 2 lines of 22
 * (a regular label, a line a side) and 4 lines of 19 (a long one, a doubles label).
 */
const WORST_LABEL = Math.max(
  layout.labelLinesRegular * typeScale.label.lineHeight,
  layout.labelLinesMax * typeScale.labelLong.lineHeight,
);

/**
 * The status strip's content at its worst, whatever the width and the label (D17, F9, F20, Q4 option A): the
 * reserve before the label is measured. The box is sized against this until it is, so the strip is never short of
 * it. Real text staying inside these lines is the phone's to prove (Task 9).
 */
export const STRIP_RESERVE = stripReserve(0);
