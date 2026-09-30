import { type Result, err, ok } from '@/domain/Result';

/**
 * Why untrusted JSON was refused, shared by every parser at the wire
 * (AGENTS §4). The wire shape stops in this folder.
 *
 * An error names a field and a fixed reason, never the value it refused:
 * the values include the token, the SRT passphrase and the RTMPS key.
 */
export type WireError =
  | { readonly kind: 'not-an-object' }
  /** `found` is the version only when it is a number, so nothing else read off a code rides along. */
  | { readonly kind: 'unsupported-version'; readonly found: number | null }
  | { readonly kind: 'missing-field'; readonly field: string }
  | { readonly kind: 'invalid-field'; readonly field: string; readonly reason: string }
  /** C1: one transport alone leaves no fallback the phone can reach without re-scanning. */
  | { readonly kind: 'missing-fallback' };

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

export function isRecord(value: unknown): value is Source {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const invalid = (field: string, reason: string): Read<never> =>
  err({ kind: 'invalid-field', field, reason });

/**
 * A nested object. Absent is `missing-field`; present but not an object
 * (null, an array, a string) is `invalid-field`, so both parsers say the same.
 */
export function readRecord(source: Source, key: string, label: string = key): Read<Source> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  return isRecord(value) ? ok(value) : invalid(label, 'expected an object');
}

/**
 * `key` is the property actually read; `label` is what an error names.
 * Keeping them apart means an error can never name a path the code did not walk.
 */
export function readString(source: Source, key: string, label: string = key): Read<string> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'string' || value.length === 0) {
    return invalid(label, 'expected a non-empty string');
  }
  return ok(value);
}

export function readPositiveNumber(source: Source, key: string, label: string = key): Read<number> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return invalid(label, 'expected a positive number');
  }
  return ok(value);
}

export function readInteger(
  source: Source,
  key: string,
  min: number,
  label: string = key,
): Read<number> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    return invalid(label, `expected an integer of at least ${min}`);
  }
  return ok(value);
}

/** Integer Unix seconds (D1). An integer can still overflow Date; never hand on an Invalid Date. */
export function readEpochSeconds(source: Source, key: string, label: string = key): Read<Date> {
  const seconds = readInteger(source, key, 1, label);
  if (!seconds.ok) return seconds;
  const at = new Date(seconds.value * 1000);
  return Number.isNaN(at.getTime()) ? invalid(label, 'out of range') : ok(at);
}

/**
 * A URL with the given scheme, a host with no userinfo, and no whitespace.
 * The authority refuses `@` (userinfo) and `\`, which WHATWG `URL` — and so
 * the WebView — reads as `/` in an https URL: `https://evil.example\.seazn.club`
 * is a request to `evil.example`. Regex rather than `URL`: Hermes' URL
 * polyfill has lacked `hostname`.
 */
export function readSchemeUrl(
  source: Source,
  key: string,
  scheme: 'https' | 'srt' | 'rtmps',
  label: string = key,
): Read<string> {
  const text = readString(source, key, label);
  if (!text.ok) return text;
  const shape = new RegExp(`^${scheme}://[^\\s/?#@\\\\]+([/?#]\\S*)?$`, 'i');
  return shape.test(text.value) ? text : invalid(label, `expected a ${scheme}:// URL`);
}

const HTTPS_HOST = /^https:\/\/([^/?#@:\\\s]+)(?::\d+)?(?:[/?#]|$)/i;

/**
 * The host of an https URL, lower-cased, with any port dropped; `null` when
 * there is none. The host stops at `/`, `?`, `#` or a numeric port and admits
 * no `@`, `:` or `\`, so a URL a browser would send elsewhere (userinfo, a
 * backslash) has no host here. Compare it exactly: a suffix is a trust
 * decision nobody made.
 */
export function httpsHost(url: string): string | null {
  return HTTPS_HOST.exec(url)?.[1]?.toLowerCase() ?? null;
}

/** A closed set: an unrecognised value fails loudly rather than defaulting to the reassuring answer. */
export function readOneOf<T extends string>(
  source: Source,
  key: string,
  allowed: readonly T[],
  label: string = key,
): Read<T> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  const match = allowed.find((option) => option === value);
  return match === undefined ? invalid(label, `expected one of ${allowed.join(', ')}`) : ok(match);
}
