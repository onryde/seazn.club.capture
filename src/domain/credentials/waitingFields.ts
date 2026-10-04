import { httpsHost, isRecord } from '@/domain/credentials/wire';

/**
 * What a stream code says while it waits for a Go live (amendment, Contract
 * shapes): read by JS at the scan, saved with the code, and read again by
 * native on every beat. Publish credentials are never part of it (A1, A5).
 */
export type WaitingFields = {
  readonly code: string;
  readonly label: string;
  readonly venueTimezone: string;
  readonly scheduledStart: Date | null;
  readonly autoAllowed: boolean;
  readonly destinationName: string | null;
  readonly overlayUrl: string | null;
  readonly pollSeconds: number;
  readonly heartbeatUrl: string;
  readonly startUrl: string;
};

/**
 * Why a scanned code could not be checked (amendment §2; carries D5, D7, D18,
 * X1). `ended` is the server's `code_ended`, which a scan reads as not valid.
 */
export type CodeError =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'rate-limited'; readonly retryAfterS: number };

/** The states a 200 from `GET code` may carry (capture-descriptor.v1); each carries the waiting fields. */
export const CODE_STATES = ['waiting', 'warming', 'live', 'ending', 'completed', 'failed'] as const;

/** capture-descriptor.v1's bounds (web 5bb72e8a2), lengths in characters, as Bodies.waiting holds them. */
const CODE = /^[0-9a-hjkmnp-tv-z]{12}$/;
const LABEL = { min: 1, max: 200 };
const ZONE = { min: 1, max: 64 };
const DESTINATION = { min: 1, max: 80 };
const POLL = { min: 5, max: 300 };

type Bounds = { readonly min: number; readonly max: number };
/** A field the schema lets be absent or null: its value, `null`, or `BAD` (wrong type or out of bounds). */
const BAD = Symbol('bad');
type Optional<T> = T | null | typeof BAD;

const isText = (value: unknown): value is string => typeof value === 'string';
/** Code points, as JSON Schema counts a length: a 🏏 is one character, two UTF-16 units. */
const characters = (text: string) => [...text].length;
const textWithin = (value: unknown, { min, max }: Bounds): value is string =>
  isText(value) && characters(value) >= min && characters(value) <= max;
const wholeWithin = (value: unknown, { min, max }: Bounds): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
/** Ruling 6: exactly the build's host, https only; an empty host trusts nothing. */
const onHost = (url: unknown, host: string): url is string =>
  isText(url) && host !== '' && httpsHost(url) === host;

function optional<T>(value: unknown, read: (present: unknown) => T | null): Optional<T> {
  if (value === undefined || value === null) return null;
  return read(value) ?? BAD;
}

/** Epoch seconds from 1, as the schema bounds them, and only what a Date holds. */
function readStart(value: unknown): Date | null {
  if (!wholeWithin(value, { min: 1, max: Number.MAX_SAFE_INTEGER })) return null;
  const at = new Date(value * 1000);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The waiting fields, or null when the answer cannot be trusted whole: a
 * field missing, of the wrong type or outside the schema's bounds, or a beat
 * or start URL off the build's host (its Bearer would go there). A foreign
 * overlay is dropped and the rest kept, as Bodies.waiting does in Kotlin;
 * `wire/waiting-vectors.json` pins both readers. `cred` is never read.
 */
export function parseWaitingFields(input: unknown, host: string): WaitingFields | null {
  if (!isRecord(input)) return null;
  const { code, label, venueTimezone, autoAllowed, pollSeconds, heartbeatUrl, startUrl } = input;
  if (!isText(code) || !CODE.test(code)) return null;
  if (!textWithin(label, LABEL) || !textWithin(venueTimezone, ZONE)) return null;
  if (typeof autoAllowed !== 'boolean' || !wholeWithin(pollSeconds, POLL)) return null;
  if (!onHost(heartbeatUrl, host) || !onHost(startUrl, host)) return null;
  const scheduledStart = optional(input.scheduledStart, readStart);
  const destinationName = optional(input.destinationName, (value) =>
    textWithin(value, DESTINATION) ? value : null,
  );
  const overlayUrl = optional(input.overlayUrl, (value) => (isText(value) ? value : null));
  if (scheduledStart === BAD || destinationName === BAD || overlayUrl === BAD) return null;
  return {
    code,
    label,
    venueTimezone,
    scheduledStart,
    autoAllowed,
    destinationName,
    overlayUrl: onHost(overlayUrl, host) ? overlayUrl : null,
    pollSeconds,
    heartbeatUrl,
    startUrl,
  };
}

/** The server's own shape, epoch seconds included, so a saved code is read back by the one parser. */
export function waitingToWire(fields: WaitingFields): Record<string, unknown> {
  const { scheduledStart, ...rest } = fields;
  const seconds = scheduledStart === null ? null : Math.floor(scheduledStart.getTime() / 1000);
  return { ...rest, scheduledStart: seconds };
}
