/**
 * The allow-list scrub (spec §3 SessionRecord, AGENTS §11). A field survives
 * only when its key is on the list and its value is a short plain word, a
 * number or a boolean — or when it is `url` holding a public https URL with
 * no query, fragment or userinfo. Everything else becomes `[scrubbed]`: a
 * secret under a key nobody expected is exactly what a deny-list misses.
 */
export type LogValue = string | number | boolean | null;
export type LogFields = Readonly<Record<string, LogValue>>;

export const SCRUBBED = '[scrubbed]';

const PLAIN_KEYS: ReadonlySet<string> = new Set([
  'action',
  'attempt',
  'count',
  'endReason',
  'key',
  'kind',
  'lock',
  'mode',
  'ms',
  'op',
  'problem',
  'reason',
  'retryAfterS',
  'route',
  'scene',
  // A camera position on the match, not a secret; scrubbing it hides context.
  'slot',
  'state',
  'status',
  'transport',
]);

/** A word, not a sentence: no spaces, slashes, `?`, `=` or `@`, so no URL or message fits. */
const PLAIN_WORD = /^[\w.:-]{1,64}$/;
const PUBLIC_URL = /^https:\/\/[^/?#@\s:]+(:\d+)?(\/[^?#\s]*)?$/i;

export function scrubFields(fields: LogFields): LogFields {
  const clean: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) clean[key] = scrubValue(key, value);
  return clean;
}

export function scrubEvent(event: string): string {
  return PLAIN_WORD.test(event) ? event : SCRUBBED;
}

function scrubValue(key: string, value: LogValue): LogValue {
  if (key === 'url') return typeof value === 'string' && PUBLIC_URL.test(value) ? value : SCRUBBED;
  if (!PLAIN_KEYS.has(key)) return SCRUBBED;
  if (typeof value === 'string') return PLAIN_WORD.test(value) ? value : SCRUBBED;
  return typeof value === 'number' && !Number.isFinite(value) ? SCRUBBED : value;
}
