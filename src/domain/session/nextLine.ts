/**
 * The Next line's match label is counted at 24 characters (court stream spec 2026-11-14 §6.2, I4): "Next: " + 24 +
 * " · " + a 10-character time is at most 48, the status line's budget, in every language. So the time, which is the
 * part the operator reads for, is never the part an ellipsis eats.
 */
export const NEXT_LABEL_CAP = 24;

/**
 * The next streamed match's label as the status line shows it: past 24 characters, cut to 23 plus "…". Counted in
 * code points, as `cutDestination` does, so an emoji is one character and a surrogate pair is never split.
 */
export function cutNextLabel(label: string): string {
  const letters = [...label];
  return letters.length <= NEXT_LABEL_CAP
    ? label
    : `${letters.slice(0, NEXT_LABEL_CAP - 1).join('')}…`;
}
