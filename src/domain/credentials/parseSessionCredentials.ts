import { type Result, err, ok } from '@/domain/Result';
import type {
  RtmpsCredentials,
  ScoreUpdates,
  SessionCredentials,
  SrtCredentials,
} from '@/domain/credentials/StreamCredentials';

/**
 * The anti-corruption layer (AGENTS.md §4). The wire shape stops here and never
 * reaches the rest of the domain, so a v2 contract touches this one file.
 *
 * NOTE: `contracts/capture-qr.v1.json` is still mid-revision — C1, C2, M3 and
 * N2 are all open against it. This encodes the shape those findings imply. When
 * the contract lands, reconcile here first and let the compiler find the rest.
 */

export type ParseError =
  | { readonly kind: 'not-an-object' }
  | { readonly kind: 'unsupported-version'; readonly found: unknown }
  | { readonly kind: 'missing-field'; readonly field: string }
  | { readonly kind: 'invalid-field'; readonly field: string; readonly reason: string }
  /** C1: one transport alone leaves no fallback the phone can reach without re-scanning. */
  | { readonly kind: 'missing-fallback' };

const SUPPORTED_VERSION = 1;

export function parseSessionCredentials(input: unknown): Result<SessionCredentials, ParseError> {
  if (!isRecord(input)) return err({ kind: 'not-an-object' });
  if (input.v !== SUPPORTED_VERSION) {
    return err({ kind: 'unsupported-version', found: input.v });
  }

  const slotId = readString(input, 'slotId');
  if (!slotId.ok) return slotId;

  const holdWindowSeconds = readPositiveNumber(input, 'holdWindowSeconds');
  if (!holdWindowSeconds.ok) return holdWindowSeconds;

  const overlayUrl = readString(input, 'overlayUrl');
  if (!overlayUrl.ok) return overlayUrl;

  const playbackUrl = readString(input, 'playbackUrl');
  if (!playbackUrl.ok) return playbackUrl;

  const scoreUpdates = readScoreUpdates(input);
  if (!scoreUpdates.ok) return scoreUpdates;

  // Presence is checked here rather than inside each parser: whichever single
  // transport arrived, the pair is incomplete and the phone has no fallback to
  // reach for when UDP turns out to be blocked at the ground (C1).
  if (!isRecord(input.srt) || !isRecord(input.rtmps)) {
    return err({ kind: 'missing-fallback' });
  }

  const srt = parseSrt(input.srt);
  if (!srt.ok) return srt;

  const rtmps = parseRtmps(input.rtmps);
  if (!rtmps.ok) return rtmps;

  const preferSrt = input.preferred !== 'rtmps';
  return ok({
    slotId: slotId.value,
    holdWindowSeconds: holdWindowSeconds.value,
    overlayUrl: overlayUrl.value,
    playbackUrl: playbackUrl.value,
    scoreUpdates: scoreUpdates.value,
    primary: preferSrt ? srt.value : rtmps.value,
    fallback: preferSrt ? rtmps.value : srt.value,
  });
}

/**
 * Closed set, not a free string: the app changes what it tells the operator
 * based on this, so an unrecognised value must fail loudly rather than default
 * to the reassuring answer.
 */
function readScoreUpdates(
  source: Record<string, unknown>,
): Result<ScoreUpdates, ParseError> {
  const value = source.scoreUpdates;
  if (value === undefined) return err({ kind: 'missing-field', field: 'scoreUpdates' });
  if (value !== 'realtime' && value !== 'polled') {
    return err({
      kind: 'invalid-field',
      field: 'scoreUpdates',
      reason: "expected 'realtime' or 'polled'",
    });
  }
  return ok(value);
}

function parseSrt(input: Record<string, unknown>): Result<SrtCredentials, ParseError> {
  const url = readString(input, 'url', 'srt.url');
  if (!url.ok) return url;

  const streamId = readString(input, 'streamId', 'srt.streamId');
  if (!streamId.ok) return streamId;

  const latencyMs = readPositiveNumber(input, 'latencyMs', 'srt.latencyMs');
  if (!latencyMs.ok) return latencyMs;

  const passphrase = typeof input.passphrase === 'string' ? input.passphrase : undefined;
  return ok({
    transport: 'srt',
    url: url.value,
    streamId: streamId.value,
    latencyMs: latencyMs.value,
    ...(passphrase === undefined ? {} : { passphrase }),
  });
}

function parseRtmps(input: Record<string, unknown>): Result<RtmpsCredentials, ParseError> {
  const url = readString(input, 'url', 'rtmps.url');
  if (!url.ok) return url;

  const streamKey = readString(input, 'streamKey', 'rtmps.streamKey');
  if (!streamKey.ok) return streamKey;

  return ok({ transport: 'rtmps', url: url.value, streamKey: streamKey.value });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `key` is the property actually read; `label` is what the operator is told.
 * Keeping them separate means an error can never name a path the code did not
 * walk.
 */
function readString(
  source: Record<string, unknown>,
  key: string,
  label: string = key,
): Result<string, ParseError> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'string' || value.length === 0) {
    return err({ kind: 'invalid-field', field: label, reason: 'expected a non-empty string' });
  }
  return ok(value);
}

function readPositiveNumber(
  source: Record<string, unknown>,
  key: string,
  label: string = key,
): Result<number, ParseError> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return err({ kind: 'invalid-field', field: label, reason: 'expected a positive number' });
  }
  return ok(value);
}
