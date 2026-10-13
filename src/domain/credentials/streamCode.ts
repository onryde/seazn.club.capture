import { type Result, err, ok } from '@/domain/Result';
import { isRecord, readInteger, readString, type WireError } from '@/domain/credentials/wire';

/**
 * capture-qr v2 after the stable code (amendment A1): a code and its camera
 * position, with no credentials and no session. The phone pairs once per code,
 * and the server starts and stops each broadcast.
 */
export type StreamCode = {
  readonly code: string;
  readonly slot: number;
  /** The code's Bearer for `GET code`, beats and `POST start`. A secret: never log it. */
  readonly token: string;
  /** The QR's optional `exp`; null when the printed code carries none. */
  readonly expiresAt: Date | null;
};

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

const VERSION = 2;

/**
 * capture-qr.v2's patterns (web 5bb72e8a2, carry G1): the code is 12 characters
 * of lowercase Crockford base32, the token 16 bytes as base64url. ASCII classes,
 * matched whole, as `PairRequest.problems()` matches them in Kotlin; the cases
 * both are held to are `wire/code-vectors.json`.
 */
const CODE = /^[0-9a-hjkmnp-tv-z]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** Whether [text] is a code: capture-qr.v2's pattern, as `PairRequest` holds it in Kotlin. */
export const isStreamCodeText = (text: string): boolean => CODE.test(text);

/** Native holds the slot in an Int (T11 M3): a larger one would be refused there after JS accepted it. */
const MAX_SLOT = 2_147_483_647;

const invalid = (field: string, reason: string): Read<never> =>
  err({ kind: 'invalid-field', field, reason });

export function parseStreamCodeText(text: string): Read<StreamCode> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err({ kind: 'not-an-object' });
  }
  return parseStreamCode(data);
}

/** The anti-corruption layer for the QR (AGENTS §4): the wire shape stops here. */
export function parseStreamCode(input: unknown): Read<StreamCode> {
  if (!isRecord(input)) return err({ kind: 'not-an-object' });
  if (input.v !== VERSION) {
    return err({
      kind: 'unsupported-version',
      found: typeof input.v === 'number' ? input.v : null,
    });
  }
  const code = matching(input, 'code', CODE, 'expected 12 characters of the code alphabet');
  if (!code.ok) return code;
  const slot = readSlot(input);
  if (!slot.ok) return slot;
  const token = matching(input, 'tok', TOKEN, 'expected 22 characters of base64url');
  if (!token.ok) return token;
  const expiresAt = readExp(input);
  if (!expiresAt.ok) return expiresAt;
  return ok({ code: code.value, slot: slot.value, token: token.value, expiresAt: expiresAt.value });
}

/** A string field held to its schema pattern. The error names the field, never the value. */
function matching(input: Source, key: string, pattern: RegExp, reason: string): Read<string> {
  const text = readString(input, key);
  if (!text.ok) return text;
  return pattern.test(text.value) ? text : invalid(key, reason);
}

function readSlot(input: Source): Read<number> {
  const slot = readInteger(input, 'slot', 0);
  if (!slot.ok || slot.value <= MAX_SLOT) return slot;
  return invalid('slot', `expected an integer of at most ${MAX_SLOT}`);
}

/**
 * `exp` is optional, epoch seconds of at least 0 (carry D8). Absent is no
 * expiry; null is refused, as the schema admits none (D9). An integer a Date
 * cannot hold is never handed on as an Invalid Date.
 */
function readExp(input: Source): Read<Date | null> {
  if (input.exp === undefined) return ok(null);
  const seconds = readInteger(input, 'exp', 0);
  if (!seconds.ok) return seconds;
  const at = new Date(seconds.value * 1000);
  return Number.isNaN(at.getTime()) ? invalid('exp', 'out of range') : ok(at);
}
