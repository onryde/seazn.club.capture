import type { SessionSecrets } from '@/domain/credentials/StreamSession';

/**
 * The allow-list scrub (spec §3 SessionRecord, AGENTS §11). A field survives
 * only when its key is on the list and its value is a short plain word, a
 * number or a boolean — or when it is `url` holding a public https URL with
 * no query, fragment or userinfo. Everything else becomes `[scrubbed]`: a
 * secret under a key nobody expected is exactly what a deny-list misses.
 *
 * M3 (final review), parity with plan B's SessionRecord: the held session's
 * secrets are masked by value too, under any key and in the event name. A
 * public URL may carry the stream id (Cloudflare's playback path does), never
 * the token, a passphrase or a stream key. Native masks a secret where it
 * stands; here the whole value goes, as every other scrubbed value does.
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

const NOTHING_HELD: SessionSecrets = { secrets: [], streamIds: [] };

export function scrubFields(fields: LogFields, held: SessionSecrets = NOTHING_HELD): LogFields {
  const mask = maskOf(held);
  const clean: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) clean[key] = scrubValue(key, value, mask);
  return clean;
}

export function scrubEvent(event: string, held: SessionSecrets = NOTHING_HELD): string {
  return PLAIN_WORD.test(event) && !reveals(event, maskOf(held).anywhere) ? event : SCRUBBED;
}

/** Which values no line may show (`anywhere`), and which not even a public URL (`inUrls`). */
type Mask = { readonly anywhere: readonly string[]; readonly inUrls: readonly string[] };

/** A blank value is no secret: as a mask it would hide every line. */
function maskOf({ secrets, streamIds }: SessionSecrets): Mask {
  const real = (values: readonly string[]) => values.filter((value) => value.trim() !== '');
  const inUrls = real(secrets);
  return { inUrls, anywhere: [...inUrls, ...real(streamIds)] };
}

/**
 * Whether `text` shows any of `values`, raw or encoded. Native masks the raw,
 * form-encoded and component-encoded forms, then the whole value if decoding
 * what is left still reveals one; a hit here takes the whole value at once.
 */
function reveals(text: string, values: readonly string[]): boolean {
  const readings = readingsOf(text);
  return values.some((value) => readings.some((reading) => reading.includes(value)));
}

/**
 * Every way an encoder could have written a secret into `text`, each read on
 * its own (final fix round 2, M-a): as it stands; percent-decoded; decoded,
 * then `+` read as a space; and `+` read as a space, then decoded, which is
 * URLEncoder's form, where a `+` in the secret is `%2B`.
 */
function readingsOf(text: string): readonly string[] {
  const decoded = percentDecoded(text);
  return [text, decoded, decoded.replace(/\+/g, ' '), percentDecoded(text.replace(/\+/g, ' '))];
}

/** Runs of `%XX` decoded as UTF-8, leniently (M-b). */
function percentDecoded(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, decodeRun);
}

/**
 * One run of escapes, a character at a time: a byte that starts no valid
 * UTF-8 sequence reads as U+FFFD, as native's decoder does, and decoding goes
 * on after it. Decoding the run whole would let one bad byte hide the rest.
 */
function decodeRun(run: string): string {
  const bytes = run.match(/%[0-9a-f]{2}/gi) ?? [];
  let text = '';
  for (let at = 0; at < bytes.length;) {
    const [size, chars] = nextCharacter(bytes, at);
    text += chars;
    at += size;
  }
  return text;
}

/** The longest valid UTF-8 sequence at `at` (at most 4 bytes), or U+FFFD for one byte. */
function nextCharacter(bytes: readonly string[], at: number): readonly [number, string] {
  for (let size = 4; size > 0; size -= 1) {
    try {
      return [size, decodeURIComponent(bytes.slice(at, at + size).join(''))];
    } catch {
      // Not UTF-8 at this length; try a shorter one.
    }
  }
  return [1, '\uFFFD'];
}

/**
 * `unknown`, not `LogValue`: the types can be laundered past (a parsed native
 * payload, an `as`), and this is the boundary. It ends closed — only a plain
 * word, a finite number, a boolean or null passes; an object, array or bigint
 * never reaches the record whole.
 */
function scrubValue(key: string, value: unknown, mask: Mask): LogValue {
  if (key === 'url') return isPublicUrl(value, mask) ? value : SCRUBBED;
  if (!PLAIN_KEYS.has(key)) return SCRUBBED;
  if (typeof value === 'string') {
    return PLAIN_WORD.test(value) && !reveals(value, mask.anywhere) ? value : SCRUBBED;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : SCRUBBED;
  return typeof value === 'boolean' || value === null ? value : SCRUBBED;
}

function isPublicUrl(value: unknown, mask: Mask): value is string {
  return typeof value === 'string' && PUBLIC_URL.test(value) && !reveals(value, mask.inUrls);
}
