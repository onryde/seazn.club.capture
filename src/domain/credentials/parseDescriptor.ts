import { type Result, err, ok } from '@/domain/Result';
import type {
  DescriptorState,
  OrganiserEndReason,
  SessionDescriptor,
} from '@/domain/credentials/SessionDescriptor';
import type { ScoreUpdates, Transport } from '@/domain/credentials/StreamCredentials';
import {
  isRecord,
  readEpochSeconds,
  readOneOf,
  readPositiveNumber,
  readRecord,
  readSchemeUrl,
  readString,
  type WireError,
} from '@/domain/credentials/wire';

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

const STATES: readonly DescriptorState[] = ['warming', 'live', 'ending', 'completed', 'failed'];
const SCORE_UPDATES: readonly ScoreUpdates[] = ['realtime', 'polled'];

/** Wire → domain (D4). A Map, so `constructor` and friends are not reasons. */
const END_REASONS = new Map<string, OrganiserEndReason>([
  ['stopped', 'stopped'],
  ['no_inbound_timeout', 'no-inbound-timeout'],
  ['target_rejected', 'target-rejected'],
  ['max_duration', 'max-duration'],
]);
const WIRE_END_REASON: Readonly<Record<OrganiserEndReason, string>> = {
  stopped: 'stopped',
  'no-inbound-timeout': 'no_inbound_timeout',
  'target-rejected': 'target_rejected',
  'max-duration': 'max_duration',
  unknown: 'unknown',
};

export function parseEndReason(value: unknown): OrganiserEndReason {
  return typeof value === 'string' ? (END_REASONS.get(value) ?? 'unknown') : 'unknown';
}

/** The descriptor response → `SessionDescriptor` (spec §2). The wire shape stops here. */
export function parseDescriptor(input: unknown): Read<SessionDescriptor> {
  if (!isRecord(input)) return err({ kind: 'not-an-object' });
  const facts = readFacts(input);
  if (!facts.ok) return facts;
  const urls = readUrls(input);
  if (!urls.ok) return urls;
  const times = readTimes(input);
  if (!times.ok) return times;
  return ok({ ...facts.value, ...urls.value, ...times.value });
}

type Urls = Pick<SessionDescriptor, 'playbackUrl' | 'overlayUrl' | 'heartbeatUrl'>;
type Times = Pick<SessionDescriptor, 'maxDurationMinutes' | 'warmingDeadline' | 'expiresAt'>;
type Facts = Omit<SessionDescriptor, keyof Urls | keyof Times>;

/** Field order is the error order: `{}` names `sid` first. */
function readFacts(input: Source): Read<Facts> {
  const sid = readString(input, 'sid');
  if (!sid.ok) return sid;
  const state = readOneOf(input, 'state', STATES);
  if (!state.ok) return state;
  const hold = readHoldWindows(input);
  if (!hold.ok) return hold;
  const venueTimezone = readString(input, 'venueTimezone');
  if (!venueTimezone.ok) return venueTimezone;
  const label = readString(input, 'label');
  if (!label.ok) return label;
  const scoreUpdates = readOneOf(input, 'scoreUpdates', SCORE_UPDATES);
  if (!scoreUpdates.ok) return scoreUpdates;
  const absent = input.endReason === undefined || input.endReason === null;
  const endReason = absent ? null : parseEndReason(input.endReason);
  return ok({
    sid: sid.value,
    state: state.value,
    endReason,
    holdWindowSeconds: hold.value,
    venueTimezone: venueTimezone.value,
    label: label.value,
    scoreUpdates: scoreUpdates.value,
  });
}

function readUrls(input: Source): Read<Urls> {
  const playbackUrl = readSchemeUrl(input, 'playbackUrl', 'https');
  if (!playbackUrl.ok) return playbackUrl;
  const overlayUrl = readSchemeUrl(input, 'overlayUrl', 'https');
  if (!overlayUrl.ok) return overlayUrl;
  const heartbeatUrl = readSchemeUrl(input, 'heartbeatUrl', 'https');
  if (!heartbeatUrl.ok) return heartbeatUrl;
  return ok({
    playbackUrl: playbackUrl.value,
    overlayUrl: overlayUrl.value,
    heartbeatUrl: heartbeatUrl.value,
  });
}

function readTimes(input: Source): Read<Times> {
  const maxDurationMinutes = readPositiveNumber(input, 'maxDurationMinutes');
  if (!maxDurationMinutes.ok) return maxDurationMinutes;
  const warmingDeadline = readEpochSeconds(input, 'warmingDeadline');
  if (!warmingDeadline.ok) return warmingDeadline;
  const expiresAt = readEpochSeconds(input, 'exp');
  if (!expiresAt.ok) return expiresAt;
  return ok({
    maxDurationMinutes: maxDurationMinutes.value,
    warmingDeadline: warmingDeadline.value,
    expiresAt: expiresAt.value,
  });
}

function readHoldWindows(input: Source): Read<Readonly<Record<Transport, number>>> {
  const hold = readRecord(input, 'holdWindowSeconds');
  if (!hold.ok) return hold;
  const srt = readPositiveNumber(hold.value, 'srt', 'holdWindowSeconds.srt');
  if (!srt.ok) return srt;
  const rtmps = readPositiveNumber(hold.value, 'rtmps', 'holdWindowSeconds.rtmps');
  if (!rtmps.ok) return rtmps;
  return ok({ srt: srt.value, rtmps: rtmps.value });
}

/** The stored form: the wire shape again, so a saved record is read by the same parser (D28). */
export function descriptorToWire(d: SessionDescriptor): Record<string, unknown> {
  return {
    sid: d.sid,
    state: d.state,
    endReason: d.endReason === null ? null : WIRE_END_REASON[d.endReason],
    playbackUrl: d.playbackUrl,
    overlayUrl: d.overlayUrl,
    holdWindowSeconds: { ...d.holdWindowSeconds },
    venueTimezone: d.venueTimezone,
    label: d.label,
    scoreUpdates: d.scoreUpdates,
    maxDurationMinutes: d.maxDurationMinutes,
    warmingDeadline: Math.floor(d.warmingDeadline.getTime() / 1000),
    exp: Math.floor(d.expiresAt.getTime() / 1000),
    heartbeatUrl: d.heartbeatUrl,
  };
}
