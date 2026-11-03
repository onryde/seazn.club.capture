/**
 * One physical tap read twice: a bouncing courtside tap, or a handler fired twice. The same action within this window
 * of its last recorded one is counted once. The web pad's `DOUBLE_SUBMIT_WINDOW_MS` and its reasoning
 * (`apps/web/src/components/v2/scorepad/use-pad-pipeline.ts`, R7-42): a scorer cannot deliberately repeat a tap in
 * under ~250 ms, and two real rallies are seconds apart.
 */
export const BOUNCE_MS = 250;

/** Whether a repeat `gapMs` after the last one is a bounce. A negative gap (the clock stepped back) never is. */
export function isBounce(gapMs: number): boolean {
  return gapMs >= 0 && gapMs < BOUNCE_MS;
}
