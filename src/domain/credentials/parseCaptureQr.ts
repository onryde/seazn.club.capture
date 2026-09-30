import { type Result, err, ok } from '@/domain/Result';
import type {
  RtmpsCredentials,
  SrtCredentials,
  StreamCredentials,
  Transport,
} from '@/domain/credentials/StreamCredentials';
import {
  isRecord,
  readEpochSeconds,
  readInteger,
  readOneOf,
  readPositiveNumber,
  readSchemeUrl,
  readString,
  type WireError,
} from '@/domain/credentials/wire';

/** A scanned capture-qr.v2 code, in the domain's words. `token` is a secret: never log it. */
export type CaptureCode = {
  readonly sid: string;
  readonly slot: number;
  readonly token: string;
  readonly primary: StreamCredentials;
  readonly fallback: StreamCredentials;
  readonly expiresAt: Date;
};

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

const VERSION = 2;
const TRANSPORTS: readonly Transport[] = ['srt', 'rtmps'];

/** Text off the scanner. Garbled JSON is an ordinary outcome, never a throw. */
export function parseCaptureQrText(text: string): Read<CaptureCode> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err({ kind: 'not-an-object' });
  }
  return parseCaptureQr(data);
}

/** capture-qr.v2 (spec Ask) → `CaptureCode`. Expiry is judged by the caller, against its clock. */
export function parseCaptureQr(input: unknown): Read<CaptureCode> {
  if (!isRecord(input)) return err({ kind: 'not-an-object' });
  if (input.v !== VERSION) return err({ kind: 'unsupported-version', found: versionOf(input.v) });
  const head = readHead(input);
  if (!head.ok) return head;
  const pair = readPair(input);
  if (!pair.ok) return pair;
  return ok({ ...head.value, ...pair.value });
}

/** Only a number is a version; anything else in `v` stays out of the error (ruling 3). */
const versionOf = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function readHead(input: Source): Read<Pick<CaptureCode, 'sid' | 'slot' | 'token' | 'expiresAt'>> {
  const sid = readString(input, 'sid');
  if (!sid.ok) return sid;
  const slot = readInteger(input, 'slot', 0);
  if (!slot.ok) return slot;
  const expiresAt = readEpochSeconds(input, 'exp');
  if (!expiresAt.ok) return expiresAt;
  const token = readString(input, 'tok');
  if (!token.ok) return token;
  return ok({ sid: sid.value, slot: slot.value, token: token.value, expiresAt: expiresAt.value });
}

/**
 * C1: both shapes in hand at scan time, or none — whichever single transport
 * arrived, the phone has no fallback when UDP is blocked at the ground.
 */
function readPair(input: Source): Read<Pick<CaptureCode, 'primary' | 'fallback'>> {
  const cred = input.cred;
  if (!isRecord(cred)) return err({ kind: 'missing-field', field: 'cred' });
  if (!isRecord(cred.srt) || !isRecord(cred.rtmps)) return err({ kind: 'missing-fallback' });
  const preferred = readOneOf(input, 'preferred', TRANSPORTS);
  if (!preferred.ok) return preferred;
  const srt = parseSrt(cred.srt);
  if (!srt.ok) return srt;
  const rtmps = parseRtmps(cred.rtmps);
  if (!rtmps.ok) return rtmps;
  const srtFirst = preferred.value === 'srt';
  return ok({
    primary: srtFirst ? srt.value : rtmps.value,
    fallback: srtFirst ? rtmps.value : srt.value,
  });
}

/**
 * The separate fields are canonical (lane D); native composes the query
 * string. A query already on the url is dropped, so the fixture's embedded
 * form and production's bare form read the same (D7).
 */
function parseSrt(srt: Source): Read<SrtCredentials> {
  const url = readSchemeUrl(srt, 'url', 'srt', 'cred.srt.url');
  if (!url.ok) return url;
  const streamId = readString(srt, 'streamId', 'cred.srt.streamId');
  if (!streamId.ok) return streamId;
  const passphrase = readString(srt, 'passphrase', 'cred.srt.passphrase');
  if (!passphrase.ok) return passphrase;
  const latencyMs = readPositiveNumber(srt, 'latencyMs', 'cred.srt.latencyMs');
  if (!latencyMs.ok) return latencyMs;
  return ok({
    transport: 'srt',
    url: url.value.split('?')[0] ?? url.value,
    streamId: streamId.value,
    passphrase: passphrase.value,
    latencyMs: latencyMs.value,
  });
}

function parseRtmps(rtmps: Source): Read<RtmpsCredentials> {
  const url = readSchemeUrl(rtmps, 'url', 'rtmps', 'cred.rtmps.url');
  if (!url.ok) return url;
  const streamKey = readString(rtmps, 'streamKey', 'cred.rtmps.streamKey');
  if (!streamKey.ok) return streamKey;
  return ok({ transport: 'rtmps', url: url.value, streamKey: streamKey.value });
}
