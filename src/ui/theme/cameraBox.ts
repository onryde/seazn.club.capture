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
 * The strip's reserve for a label that has been measured (owner, 2026-10-08, option A, "one single line all the time"
 * and the round line always shown, option B): the padding, the round line's slot (one line of metricUnit), a gap, the
 * label at the height it really came out, a gap, and the one message line, a line of the body role. The message is the
 * caption when one is up and the status line otherwise, so there is no room reserved for a second line: the picture is
 * the same size for the whole match. The round line's slot is reserved whether or not this match has a stage label
 * (controller ruling R1), so a stage arriving or going mid-match moves nothing; the cost is 22 dp of empty strip for a
 * match with no stage. The reserve moves with the label's text and the half's size (what the label wraps in), and with
 * nothing else. A status line, a caption or the round line coming and going changes none of its inputs.
 *
 * `labelHeight` is what `MatchLabel` reported: 0 is not measured yet (or the label is going), and so is anything that
 * is not a positive height. Then it is the worst case the strip can need, C2's four lines at 22, so the strip is never
 * short before the first measurement. A measured label taller than that (large system text) is
 * taken as measured: the strip really is that tall. Only the label follows the system's text size, though: the
 * message line's 22 is a fixed reservation (the unscaled `body` height), so at a font scale over 1 that line can still
 * outgrow its room and overflow the strip.
 */
export function stripReserve(labelHeight: number): number {
  const label = labelHeight > 0 ? labelHeight : WORST_LABEL;
  const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
  const message = layout.messageLines * typeScale.body.lineHeight;
  // The padding, then the round line, a gap, the label, a gap, the message line.
  return 2 * layout.stripPadV + stage + layout.stripGap + label + layout.stripGap + message;
}

/**
 * The label at its worst, whatever the width (C2, D2 §4.4): two sides of at most `labelSideLines` (2) lines each, at
 * the one `label` size, 4 × 22 = 88. It derives from the per-side cap (ledger P10), so the cap and the reserve cannot
 * drift apart. A label that does not split into sides is one row of at most 2 lines, so never the worst.
 */
const WORST_LABEL = 2 * layout.labelSideLines * typeScale.label.lineHeight;

/**
 * The status strip's content at its worst, whatever the width and the label (D17, F9, F20, Q4 option A): the
 * reserve before the label is measured. The box is sized against this until it is, so the strip is never short of
 * it. Real text staying inside these lines is the phone's to prove (Task 9).
 */
export const STRIP_RESERVE = stripReserve(0);
