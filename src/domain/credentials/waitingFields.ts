import { httpsHost, isRecord } from '@/domain/credentials/wire';

/**
 * The descriptor's stage (W28), as far as the phone uses it: the label the line shows and the role kind that
 * allowed it. Both or neither, so a saved copy reads back through the same parser, kind rule included.
 */
export type StageRead = { readonly label: string; readonly kind: string };

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
  readonly stage: StageRead | null;
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
const STAGE = { min: 1, max: 40 };

/** capture-descriptor.v1 `stage.role.kind`'s values (R-F20): an open string, of which only these show a line. */
export const STAGE_KINDS: ReadonlySet<string> = new Set([
  'round_of',
  'quarter_final',
  'semi_final',
  'final',
  'winners_final',
  'losers_round',
  'losers_final',
  'grand_final',
  'grand_final_reset',
  'third_place',
  'qualifier1',
  'eliminator',
  'qualifier2',
  'rung',
  'plain_round',
]);

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
 * W28: display only, so anything wrong is no stage and never makes the answer unreadable (Bodies.stageLabel). The label
 * counts only for a role kind the contract names, and is kept with its kind so a saved copy reads back the same way.
 */
function readStage(value: unknown): StageRead | null {
  if (!isRecord(value) || !isRecord(value.role)) return null;
  const { kind } = value.role;
  if (!isText(kind) || !STAGE_KINDS.has(kind)) return null;
  return textWithin(value.label, STAGE) ? { label: value.label, kind } : null;
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
    stage: readStage(input.stage),
  };
}

/** The server's own shape, epoch seconds included, so a saved code is read back by the one parser. */
export function waitingToWire(fields: WaitingFields): Record<string, unknown> {
  const { scheduledStart, stage, ...rest } = fields;
  const seconds = scheduledStart === null ? null : Math.floor(scheduledStart.getTime() / 1000);
  // A saved stage is `{ role: { kind }, label }`: what the one parser reads back, kind rule included. `code` and `pool` are not read.
  const saved = stage === null ? {} : { stage: { role: { kind: stage.kind }, label: stage.label } };
  return { ...rest, scheduledStart: seconds, ...saved };
}
