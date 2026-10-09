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
 * A text key masks `textOnly` too (the code, M3); a plain word, the kind and
 * a URL never check it, so a short code never masks a closed word holding it.
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
  'field',
  'from',
  // A bare host, never a path or query (plan A I1). Its producer, the overlay guard's refused navigation, went with
  // the score preview (D2 §4.1); native's PLAIN_KEYS still lists it (SessionRecord.kt:260), so both scrubs keep it.
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
  // F-S4-1: class names of a failed start's throw, never a message.
  'rootError',
  'route',
  'scene',
  'shed',
  'side',
  'sid',
  'site',
  // A camera position on the match, not a secret; scrubbing it hides context.
  'slot',
  'source',
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

/**
 * A word, not a sentence: no spaces, slashes, `?`, `=` or `@`, so no URL or
 * message fits. The file's `plainWord`, character for character, ASCII spelled
 * out as native spells it (Android's ICU engine is not promised a JS `\w`).
 */
export const PLAIN_WORD = /^[A-Za-z0-9_.:-]{1,64}$/;
/**
 * Whitespace is ASCII's six, spelled out as native spells them: JS's `\s` holds
 * Unicode spaces and Java's does not. Here `\v` is the one character U+000B.
 * The scheme's case is spelled out with no flag, as native's is (review M1).
 */
const PUBLIC_URL =
  /^[Hh][Tt][Tt][Pp][Ss]:\/\/[^/?#@ \t\n\v\f\r:]+(:[0-9]+)?(\/[^?# \t\n\v\f\r]*)?$/;

/**
 * The secrets one held code carries (CD6): the token, from the scan to the
 * unpair. `streamIds` stays for what native still masks by that rule (M3):
 * a value that is a secret yet also sits in a public URL.
 */
export type SessionSecrets = {
  readonly secrets: readonly string[];
  readonly streamIds: readonly string[];
};

/**
 * What a session holds (`SessionSecrets`), and `textOnly`: values masked in
 * free text alone, native's `inTextOnly` (M3). The code is one: no line names
 * it, but a library's error can quote it in a URL.
 */
export type HeldSecrets = SessionSecrets & { readonly textOnly?: readonly string[] };

const NOTHING_HELD: HeldSecrets = { secrets: [], streamIds: [] };

/**
 * `inHand` defaults to "something is held", so every caller that passes no
 * flag, and the shared vectors, keep the answer they had. The logger passes it.
 */
export function scrubFields(
  fields: LogFields,
  held: HeldSecrets = NOTHING_HELD,
  inHand: boolean = held.secrets.length + held.streamIds.length > 0,
): LogFields {
  const mask = maskOf(held, inHand);
  const clean: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) clean[key] = scrubValue(key, value, mask);
  return clean;
}

export function scrubEvent(event: string, held: HeldSecrets = NOTHING_HELD): string {
  return PLAIN_WORD.test(event) && !reveals(event, maskOf(held, true).anywhere) ? event : SCRUBBED;
}

/**
 * Which values no line may show (`anywhere`), which not even a public URL
 * (`inUrls`), which free text may not (`inText`: those and the text-only
 * ones), and whether a session is in hand (N7).
 */
type Mask = {
  readonly anywhere: readonly string[];
  readonly inUrls: readonly string[];
  readonly inText: readonly string[];
  readonly inHand: boolean;
};

/**
 * Each held value in every form `formsOf` gives, as native's `withEncodings`
 * keeps them, so a value encoded once more than its form is still read. A
 * blank value is no secret: as a mask it would hide every line.
 */
function maskOf({ secrets, streamIds, textOnly = [] }: HeldSecrets, inHand: boolean): Mask {
  const real = (values: readonly string[]) => values.filter((value) => value.trim() !== '');
  return {
    inUrls: withForms(real(secrets)),
    anywhere: withForms([...real(secrets), ...real(streamIds)]),
    inText: withForms([...real(secrets), ...real(streamIds), ...real(textOnly)]),
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

/**
 * Runs of `%XX` decoded as UTF-8, leniently (M-b), native's `percentDecoded`
 * step for step: one UTF-16 unit at a time, and anything that starts no
 * escape kept as it is.
 */
function percentDecoded(text: string): string {
  let out = '';
  let run: string[] = [];
  for (let at = 0; at < text.length;) {
    const escape = escapeAt(text, at);
    if (escape === undefined) {
      out += decodeRun(run) + text.charAt(at);
      run = [];
      at += 1;
    } else {
      run.push(escape);
      at += 3;
    }
  }
  return out + decodeRun(run);
}

/** The escape at `at`, spelled in ASCII hex for `decodeURIComponent`, or undefined. */
function escapeAt(text: string, at: number): string | undefined {
  if (text.charAt(at) !== '%' || at + 2 >= text.length) return undefined;
  const high = hexValue(text.charCodeAt(at + 1));
  const low = hexValue(text.charCodeAt(at + 2));
  return high === undefined || low === undefined
    ? undefined
    : `%${high.toString(16)}${low.toString(16)}`;
}

const ASCII_HEX = '0123456789abcdef';
const DECIMAL = /^\p{Nd}$/u;

/**
 * A hex digit's value as native's `digitToIntOrNull(16)` (Java's
 * `Character.digit`) reads one, so both sides decode the same escapes and the
 * stricter reading wins (review M2): ASCII, the fullwidth letters A to F, and
 * any decimal digit. A surrogate is half a character and no digit on either side.
 */
function hexValue(unit: number): number | undefined {
  if (unit < 0x80) {
    const value = ASCII_HEX.indexOf(String.fromCharCode(unit).toLowerCase());
    return value < 0 ? undefined : value;
  }
  if (unit >= 0xff21 && unit <= 0xff26) return unit - 0xff21 + 10;
  if (unit >= 0xff41 && unit <= 0xff46) return unit - 0xff41 + 10;
  return decimalValue(unit);
}

/**
 * A decimal digit's value. Unicode assigns decimal digits only in runs of ten,
 * zero to nine, so the value is the distance back to the run's start, mod 10
 * for runs that abut. Undefined for anything that is not one.
 */
function decimalValue(unit: number): number | undefined {
  const isDecimal = (code: number) => DECIMAL.test(String.fromCharCode(code));
  if (!isDecimal(unit)) return undefined;
  let start = unit;
  while (isDecimal(start - 1)) start -= 1;
  return (unit - start) % 10;
}

/**
 * One run of escapes, a character at a time: a byte that starts no valid
 * UTF-8 sequence reads as U+FFFD, as native's decoder does, and decoding goes
 * on after it. Decoding the run whole would let one bad byte hide the rest.
 */
function decodeRun(bytes: readonly string[]): string {
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
  if (TEXT_KEYS.has(key)) return mask.inHand ? maskedText(value, mask.inText) : SCRUBBED;
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
