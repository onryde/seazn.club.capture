/** `{destination}` is counted at 24 characters in every status line budget (amendment §2). */
export const DESTINATION_CAP = 24;

/**
 * The destination's name as the status line shows it: past 24 characters, cut
 * to 23 plus "…". Counted in code points, so an emoji is one character and a
 * surrogate pair is never split.
 */
export function cutDestination(name: string): string {
  const letters = [...name];
  return letters.length <= DESTINATION_CAP
    ? name
    : `${letters.slice(0, DESTINATION_CAP - 1).join('')}…`;
}
