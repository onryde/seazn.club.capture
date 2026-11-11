/**
 * The server's time, as the scoring answers tell it (S2-5 design §7.2, ruling 107): how far the server's clock is ahead
 * of this phone's, so the football clock reads one shared match time on every screen, whatever the phone's own clock
 * says. It is the web's rule exactly (`apps/web/src/components/v2/scorepad/server-offset.ts`, the controller's ruling
 * X-5): the console and the phone measure the same way, so they cannot disagree about it.
 *
 * A sample comes from an answer's HTTP `Date` header, which names the server's whole second: the server's time is taken
 * as that second plus half a second, against the request's midpoint on the phone's clock. The offset is the median of
 * the newest {@link OFFSET_WINDOW} samples, so one slow answer cannot move it and a real jump of the phone's clock is
 * followed once three of five samples agree. Pure: the samples' state is the server clock's (`serverClock.ts`).
 */

/** How many of the newest samples the offset is the median of. */
export const OFFSET_WINDOW = 5;
/** A round trip longer than this says too little about when the server wrote its header: no sample. */
export const OFFSET_MAX_RTT_MS = 5000;

/**
 * One answer's sample: the header's second + 500 ms, less the request's midpoint (`sentAt` and `answeredAt` on the
 * phone's clock). Nothing for a missing or unparseable header, or a round trip that is negative or over the cap.
 */
export function offsetSampleOf(
  dateHeader: string | null,
  sentAt: number,
  answeredAt: number,
): number | undefined {
  // No header parses as the empty string does: NaN, no sample.
  const serverSecond = Date.parse(dateHeader ?? '');
  if (Number.isNaN(serverSecond)) return undefined;
  const roundTrip = answeredAt - sentAt;
  if (roundTrip < 0 || roundTrip > OFFSET_MAX_RTT_MS) return undefined;
  return serverSecond + 500 - (sentAt + answeredAt) / 2;
}

/**
 * The offset: the median of the newest {@link OFFSET_WINDOW} samples, an even count's the rounded mean of the middle
 * two; null before any sample.
 */
export function medianOffset(samples: readonly number[]): number | null {
  const sorted = samples.slice(-OFFSET_WINDOW).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
