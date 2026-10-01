import type { SessionSecrets } from '@/domain/credentials/StreamSession';

/**
 * The allow-list scrub (spec §3 SessionRecord, AGENTS §11), one rule set with
 * native's `SessionRecord` (CD6, carry 11). The source of record is
 * `modules/capture-engine/src/scrub/allow-list.json`: both sides test their
 * sets against it and run `scrub/vectors.json`. The four rules:
 *
 * - a `NEVER_KEYS` key is always masked, whatever it holds;
 * - a finite number, a boolean or null passes under any other key: no secret
 *   is a number. A non-finite number is masked;
 * - a string passes only under a listed key, by its class. A plain key passes
 *   a short plain word that shows no held secret; a public-URL key passes a
 *   public https URL with no query, fragment or userinfo and no held secret
 *   but a stream id (Cloudflare's playback path carries it); otherwise the
 *   whole value goes. A text key masks each held secret where it stands, then
 *   the whole value if a decode still reveals one;
 * - anything else is masked: a secret under a key nobody expected is exactly
 *   what a deny-list misses.
 *
 * One JS-only rule (I12, N7): a text key is masked whole unless a session is
 * in hand (`scrubFields`' `inHand`), since JS holds a code's `tok` before the
 * viewfinder protects it.
 */
export type LogValue = string | number | boolean | null;
export type LogFields = Readonly<Record<string, LogValue>>;

export const SCRUBBED = '***';

/** Closed words: each side's vocabulary, measurements' labels and tags that name no secret. */
export const PLAIN_KEYS: ReadonlySet<string> = new Set([
  'action',
  'answer',
  'appVersion',
  'attempt',
  'cause',
  'claim',
  'count',
  'delivery',
  'endReason',
  'error',
  'exit',
  'failure',
  'from',
  // I1: where a refused overlay navigation aimed; a bare host, never a path or query.
  'host',
  'intent',
  'key',
  'kind',
  'lastEnd',
  'lock',
  'mode',
  'ms',
  'notReady',
  'op',
  'phase',
  'problem',
  'reason',
  'refusal',
  'result',
  'retryAfterS',
  'route',
  'scene',
  'shed',
  'side',
  'sid',
  // A camera position on the match, not a secret; scrubbing it hides context.
  'slot',
  'startFailed',
  'state',
  'status',
  'tag',
  'to',
  'tokenTag',
  'transport',
  'word',
]);

/** Public by construction: every viewer's player and every overlay browser source holds them. */
export const PUBLIC_URL_KEYS: ReadonlySet<string> = new Set(['url', 'playbackUrl', 'overlayUrl']);

/** Free text from a library or the platform, which can quote a URL or a key. */
export const TEXT_KEYS: ReadonlySet<string> = new Set(['message', 'problems']);

/** Never written, whatever the value. A line never carries a code. */
export const NEVER_KEYS: ReadonlySet<string> = new Set([
  'tok',
  'token',
  'code',
  'passphrase',
  'streamKey',
  'streamId',
  'bearer',
  'authorization',
]);

/** A word, not a sentence: no spaces, slashes, `?`, `=` or `@`, so no URL or message fits. */
const PLAIN_WORD = /^[\w.:-]{1,64}$/;
const PUBLIC_URL = /^https:\/\/[^/?#@\s:]+(:\d+)?(\/[^?#\s]*)?$/i;

const NOTHING_HELD: SessionSecrets = { secrets: [], streamIds: [] };

/**
 * `inHand` defaults to "something is held", so every caller that passes no
 * flag, and the shared vectors, keep the answer they had. The logger passes it.
 */
export function scrubFields(
  fields: LogFields,
  held: SessionSecrets = NOTHING_HELD,
  inHand: boolean = held.secrets.length + held.streamIds.length > 0,
): LogFields {
  const mask = maskOf(held, inHand);
  const clean: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) clean[key] = scrubValue(key, value, mask);
  return clean;
}

export function scrubEvent(event: string, held: SessionSecrets = NOTHING_HELD): string {
  return PLAIN_WORD.test(event) && !reveals(event, maskOf(held, true).anywhere) ? event : SCRUBBED;
}

/**
 * Which values no line may show (`anywhere`), which not even a public URL
 * (`inUrls`), and whether a session is in hand (N7).
 */
type Mask = {
  readonly anywhere: readonly string[];
  readonly inUrls: readonly string[];
  readonly inHand: boolean;
};

/**
 * Each held value in every form `formsOf` gives, as native's `withEncodings`
 * keeps them, so a value encoded once more than its form is still read. A
 * blank value is no secret: as a mask it would hide every line.
 */
function maskOf({ secrets, streamIds }: SessionSecrets, inHand: boolean): Mask {
  const real = (values: readonly string[]) => values.filter((value) => value.trim() !== '');
  return {
    inUrls: withForms(real(secrets)),
    anywhere: withForms([...real(secrets), ...real(streamIds)]),
    inHand,
  };
}

/** Longest first, so a secret that holds another is masked whole. */
function withForms(values: readonly string[]): readonly string[] {
  return [...new Set(values.flatMap(formsOf))].sort((a, b) => b.length - a.length);
}

/** Whether `text` shows any of `values`, in any reading `readingsOf` gives. */
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
 * payload, an `as`), and this is the boundary. It ends closed — an object,
 * array or bigint never reaches the record whole.
 */
function scrubValue(key: string, value: unknown, mask: Mask): LogValue {
  if (NEVER_KEYS.has(key)) return SCRUBBED;
  if (typeof value === 'number') return Number.isFinite(value) ? value : SCRUBBED;
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value !== 'string') return SCRUBBED;
  if (PUBLIC_URL_KEYS.has(key)) return isPublicUrl(value, mask) ? value : SCRUBBED;
  if (PLAIN_KEYS.has(key)) {
    return PLAIN_WORD.test(value) && !reveals(value, mask.anywhere) ? value : SCRUBBED;
  }
  if (TEXT_KEYS.has(key)) return mask.inHand ? maskedText(value, mask.anywhere) : SCRUBBED;
  return SCRUBBED;
}

function isPublicUrl(value: string, mask: Mask): boolean {
  return PUBLIC_URL.test(value) && !reveals(value, mask.inUrls);
}

/**
 * Text from a library or the platform (CD6): each form of a secret (`forms`,
 * longest first) is masked where it stands, then the whole value if a decode
 * still reveals one — native's `masked`, rule for rule. The `***` put in
 * reveals nothing.
 */
function maskedText(text: string, forms: readonly string[]): string {
  const replaced = forms.reduce((acc, form) => acc.split(form).join(SCRUBBED), text);
  return reveals(replaced, forms) ? SCRUBBED : replaced;
}

/**
 * Raw; URLEncoder's form (space as `+`); the component form `Uri.encode`
 * writes. `encodeURIComponent` and `Uri.encode` both leave `- _ . ! ~ * ' ( )`
 * raw; URLEncoder leaves only `- _ . *`, so `form` escapes `! ' ( ) ~` too.
 * Worked by hand for `pass+phrase/6d1e8b0c`: `+` is `%2B` and `/` is `%2F` in
 * both, so form and component are both `pass%2Bphrase%2F6d1e8b0c`.
 */
function formsOf(secret: string): readonly string[] {
  let component: string;
  try {
    component = encodeURIComponent(secret);
  } catch {
    // A lone surrogate has no UTF-8 form, so no encoder wrote one: the raw value is all there is.
    // The scrub is the boundary and never throws, or one odd secret would end every later line.
    return [secret];
  }
  const form = component
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return [secret, form, component];
}
