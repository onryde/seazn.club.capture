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
  // I1: where a refused overlay navigation aimed; a bare host, never a path or query.
  'host',
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

/**
 * `unknown`, not `LogValue`: the types can be laundered past (a parsed native
 * payload, an `as`), and this is the boundary. It ends closed — only a plain
 * word, a finite number, a boolean or null passes; an object, array or bigint
 * never reaches the record whole.
 */
function scrubValue(key: string, value: unknown): LogValue {
  if (key === 'url') return typeof value === 'string' && PUBLIC_URL.test(value) ? value : SCRUBBED;
  if (!PLAIN_KEYS.has(key)) return SCRUBBED;
  if (typeof value === 'string') return PLAIN_WORD.test(value) ? value : SCRUBBED;
  if (typeof value === 'number') return Number.isFinite(value) ? value : SCRUBBED;
  return typeof value === 'boolean' || value === null ? value : SCRUBBED;
}
