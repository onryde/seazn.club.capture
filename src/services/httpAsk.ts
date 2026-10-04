/** The slice of `fetch` the ports use, so tests stub it without a DOM. */
export type FetchResponse = {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Readonly<Record<string, string>>; signal?: AbortSignal },
) => Promise<FetchResponse>;

const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const DEFAULT_RETRY_S = 5;

/** Seconds or an HTTP-date, clamped to 1–120; anything else is 5 (D5). */
export function parseRetryAfter(value: string | null, nowMs: number): number {
  const text = value?.trim() ?? '';
  if (/^\d+$/.test(text)) return clamp(Number(text));
  if (HTTP_DATE.test(text)) return clamp(Math.ceil((Date.parse(text) - nowMs) / 1000));
  return DEFAULT_RETRY_S;
}

/** A date-shaped string that is no date parses to NaN: that is the default, never a retry at once. */
const clamp = (seconds: number) =>
  Number.isNaN(seconds) ? DEFAULT_RETRY_S : Math.min(120, Math.max(1, seconds));

/**
 * Races the whole exchange, headers and body, against the clock, so a portal
 * that answers 200 and then trickles nothing is still bounded. The loser is
 * dropped unlogged: a fetch rejecting on the abort is not a second error.
 * Anything the exchange throws is `onThrow()`, so this never rejects.
 */
export function withDeadline<T>(
  work: (signal?: AbortSignal) => Promise<T>,
  ms: number,
  onLate: () => T,
  onThrow: () => T,
): Promise<T> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(onLate());
    }, ms);
  });
  const answered = work(controller?.signal).catch(onThrow);
  return Promise.race([answered, late]).finally(() => clearTimeout(timer));
}
