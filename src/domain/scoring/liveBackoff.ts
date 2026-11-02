/**
 * How long the live owner waits before it asks for a fresh grant and joins again, after the channel went down (plan
 * S2-1 Task 9, Review Focus 5). The library retries an expired token forever, so the owner closes the channel and asks
 * again; a grant that is refused every time must not become a loop, so each failed round waits longer, to a ceiling.
 * While the channel is down the owner polls, so a long wait costs a few seconds of staleness, never a missed tap.
 */
const WAITS_MS: readonly number[] = [15_000, 30_000, 60_000, 120_000, 300_000];

/** The wait after `failures` rounds in a row that did not bring the channel up (0 for the first drop). */
export function resubscribeWaitMs(failures: number): number {
  const whole = Number.isFinite(failures) ? Math.trunc(failures) : 0;
  return WAITS_MS[Math.min(Math.max(whole, 0), WAITS_MS.length - 1)];
}

/** Ledger reads while the channel is down: the same pace sync uses for a failed read, 15 s. */
export const POLL_MS = 15_000;
