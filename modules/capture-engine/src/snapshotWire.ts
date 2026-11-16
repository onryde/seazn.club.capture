import type {
  BroadcastInfo,
  Cause,
  LastEnd,
  NextMatch,
  NotReady,
  PairingInfo,
  Readiness,
  Refusal,
  ScoreUpdates,
  Transport,
  Unpaired,
  UnpairReason,
} from '@/domain/session/Pairing';
import type { EndReason, SessionState } from '@/domain/session/SessionState';
import type { CameraState, EngineSnapshot, Telemetry } from './CaptureEnginePort';
import { IDLE_TELEMETRY } from './unreported';

/** Every wire word native writes (`wire/snapshot-vectors.json`'s vocabulary), checked against that file. */
export const WIRE_VOCABULARY = {
  state: new Set([
    'idle',
    'pairing',
    'paired',
    'arming',
    'armed',
    'connecting',
    'publishing',
    'degraded',
    'reconnecting',
    'ended',
  ]),
  transport: new Set(['srt', 'rtmps']),
  reconnectCause: new Set(['uplink-lost', 'video-stalled', 'not-delivered', 'hold-expired']),
  degradeReason: new Set([
    'not-delivered',
    'camera-taken',
    'mic-silenced',
    'poor-uplink',
    'fell-back-to-rtmps',
  ]),
  endReason: new Set(['operator-stopped', 'fatal-error']),
  cause: new Set(['organiser', 'automatic', 'operator', 'rejoin']),
  notReady: new Set(['camera', 'sound', 'network', 'held']),
  refusal: new Set(['no_destination', 'no_credit', 'not_entitled', 'unknown', 'start-failed']),
  lastEnd: new Set([
    'stopped-by-organiser',
    'stopped-automatically',
    'no-signal',
    'destination-refused',
    'max-duration',
    'phone-lost',
    'ended-by-seazn',
    'hold-window-expired',
    'stopped',
  ]),
  unpairReason: new Set(['code-ended', 'replaced', 'taken', 'permissions', 'forgotten']),
  delivery: new Set(['ok', 'stalled', 'unknown']),
  shed: new Set(['viewer-feed', 'preview-framerate', 'encode']),
  heartbeatResult: new Set(['ok', 'failed', 'session-over']),
  connectFailure: new Set(['unresolved', 'refused', 'timeout', 'other', 'unheld', 'camera']),
  camera: new Set(['own', 'taken', 'reopening', 'resuming', 'switching']),
  thermal: new Set(['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown']),
  scoreUpdates: new Set(['realtime', 'polled']),
} as const;

type Vocabulary = keyof typeof WIRE_VOCABULARY;
type Wire = Record<string, unknown>;

/** Holds the last pairing and broadcast, by their JSON, so selectors over them stay referentially stable. */
export type WireCache = {
  pairing: { json: string; value: PairingInfo } | null;
  broadcast: { json: string; value: BroadcastInfo } | null;
};

export const createWireCache = (): WireCache => ({ pairing: null, broadcast: null });

const isObject = (value: unknown): value is Wire =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
const textOrNull = (value: unknown): value is string | null => value === null || isText(value);

/** A word from `key`'s set, or undefined: undefined is malformed, never a guess. */
function word<T extends string>(key: Vocabulary, value: unknown): T | undefined {
  return isText(value) && (WIRE_VOCABULARY[key] as ReadonlySet<string>).has(value)
    ? (value as T)
    : undefined;
}

/** A word or null; undefined is malformed. */
function wordOrNull<T extends string>(key: Vocabulary, value: unknown): T | null | undefined {
  return value === null ? null : word<T>(key, value);
}

/** Every key native's telemetry carries: IDLE_TELEMETRY's, which `unreported.test.ts` holds to native's. */
const TELEMETRY_KEYS = Object.keys(IDLE_TELEMETRY);

/**
 * Review C4c M-9: the selectors read telemetry unguarded, so every key is
 * there and the heartbeat's fields read. The other values are relayed as sent.
 */
function isTelemetry(value: unknown): value is Telemetry {
  if (!isObject(value) || !TELEMETRY_KEYS.every((key) => key in value)) return false;
  const beat = value.heartbeat;
  return (
    isObject(beat) &&
    isNumber(beat.consecutiveFailures) &&
    isNumber(beat.failures) &&
    (beat.lastSentAtEpochMs === null || isNumber(beat.lastSentAtEpochMs)) &&
    wordOrNull('heartbeatResult', beat.lastResult) !== undefined
  );
}

/**
 * Native's `onSnapshot` body → `EngineSnapshot`. A projection, no state
 * machine (AGENTS §2). Null for anything malformed, telemetry's shape
 * included: the native engine keeps the last good snapshot, counts the miss
 * and records the count at most once a minute (review C4c I-4), never invents
 * a state.
 */
export function toEngineSnapshot(
  wire: unknown,
  cache: WireCache = createWireCache(),
): EngineSnapshot | null {
  if (!isObject(wire) || !isTelemetry(wire.telemetry) || !isNumber(wire.reportedAtMs)) return null;
  const state = toState(wire.state);
  const ready = toReady(wire.ready);
  const camera = wordOrNull<CameraState>('camera', wire.camera);
  const refusal = wordOrNull<Refusal>('refusal', wire.refusal);
  const lastEnd = wordOrNull<LastEnd>('lastEnd', wire.lastEnd);
  const unpaired = toUnpaired(wire.unpaired);
  const pairing = cached(cache, 'pairing', wire.pairing, toPairing);
  const broadcast = cached(cache, 'broadcast', wire.broadcast, toBroadcast);
  if (state === null || ready === null || camera === undefined || refusal === undefined)
    return null;
  if (lastEnd === undefined || unpaired === undefined) return null;
  if (pairing === undefined || broadcast === undefined || !isFlag(wire.codeEndedPending))
    return null;
  return {
    state,
    telemetry: wire.telemetry,
    pairing,
    broadcast,
    ready,
    refusal,
    lastEnd,
    unpaired,
    codeEndedPending: wire.codeEndedPending,
    camera,
    reportedAtMs: wire.reportedAtMs,
    survivesBackground: wire.survivesBackground === true,
  };
}

function toState(value: unknown): SessionState | null {
  if (!isObject(value)) return null;
  const kind = word<SessionState['kind']>('state', value.kind);
  switch (kind) {
    case 'idle':
    case 'pairing':
    case 'paired':
      return { kind };
    case 'arming':
      return arming(value);
    case 'armed':
      return armed(value);
    case 'ended':
      return ended(value);
    case undefined:
      return null;
    default:
      return onAir(kind, value);
  }
}

function arming(value: Wire): SessionState | null {
  const cause = word<Cause>('cause', value.cause);
  return cause !== undefined && isFlag(value.retrying)
    ? { kind: 'arming', cause, retrying: value.retrying }
    : null;
}

function armed(value: Wire): SessionState | null {
  const cause = word<Cause>('cause', value.cause);
  const notReady = wordOrNull<NotReady>('notReady', value.notReady);
  return cause !== undefined && notReady !== undefined ? { kind: 'armed', cause, notReady } : null;
}

function ended(value: Wire): SessionState | null {
  const reason = word<EndReason>('endReason', value.reason);
  const { durationMs } = value;
  if (reason === undefined || (durationMs !== null && !isNumber(durationMs))) return null;
  return { kind: 'ended', reason, durationMs };
}

/** connecting, publishing, degraded and reconnecting: plan A's shapes, unchanged. */
function onAir(
  kind: 'connecting' | 'publishing' | 'degraded' | 'reconnecting',
  value: Wire,
): SessionState | null {
  const transport = word<Transport>('transport', value.transport);
  const since = value.sinceEpochMs;
  if (kind === 'connecting') return transport === undefined ? null : { kind, transport };
  if (kind === 'reconnecting') return reconnecting(value);
  if (transport === undefined || !isNumber(since)) return null;
  if (kind === 'publishing') return { kind, transport, sinceEpochMs: since };
  const reason = word<Extract<SessionState, { kind: 'degraded' }>['reason']>(
    'degradeReason',
    value.reason,
  );
  return reason === undefined ? null : { kind, transport, reason, sinceEpochMs: since };
}

function reconnecting(value: Wire): SessionState | null {
  const cause = word<Extract<SessionState, { kind: 'reconnecting' }>['cause']>(
    'reconnectCause',
    value.cause,
  );
  const { holdRemainingSeconds: left, holdWindowSeconds: window, sinceEpochMs: since } = value;
  if (cause === undefined || !isNumber(left) || !isNumber(window) || !isNumber(since)) return null;
  return {
    kind: 'reconnecting',
    cause,
    holdRemainingSeconds: left,
    holdWindowSeconds: window,
    sinceEpochMs: since,
  };
}

function toReady(value: unknown): Readiness | null {
  if (!isObject(value)) return null;
  const { camera, sound, network, held } = value;
  return isFlag(camera) && isFlag(sound) && isFlag(network) && isFlag(held)
    ? { camera, sound, network, held }
    : null;
}

function toUnpaired(value: unknown): Unpaired | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const reason = word<UnpairReason>('unpairReason', value.reason);
  const { code, slot, tokenTag } = value;
  if (reason === undefined || !isText(code) || !isNumber(slot) || !isText(tokenTag))
    return undefined;
  return { reason, code, slot, tokenTag };
}

/** Code points, as native counts the bounds it wrote (a 🏸 is one character, two UTF-16 units). */
const characters = (text: string) => [...text].length;
const textWithin = (value: unknown, max: number): value is string =>
  isText(value) && characters(value) >= 1 && characters(value) <= max;

/**
 * The court (court stream spec 2026-11-14 §6.1): null, or the name native held to 1 to 80 characters. Anything else is
 * undefined, which makes the pairing, and so the snapshot, malformed: a malformed court is never read as no court.
 */
function toCourt(value: unknown): string | null | undefined {
  if (value === null) return null;
  return textWithin(value, 80) ? value : undefined;
}

const isEpochSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * The court's next streamed match (§5.3), display only: anything but a label of 1 to 200 and a start is none. The start
 * is null, or whole epoch seconds from 1 as native writes it (Bodies) and a Date holds (P1 review M5).
 */
function toNext(value: unknown): NextMatch | null {
  if (!isObject(value) || !textWithin(value.label, 200)) return null;
  const { scheduledStart } = value;
  if (scheduledStart === null) return { label: value.label, scheduledStart: null };
  if (!isEpochSeconds(scheduledStart)) return null;
  const at = new Date(scheduledStart * 1000);
  return Number.isNaN(at.getTime()) ? null : { label: value.label, scheduledStart: at };
}

/** Epoch seconds across the bridge (amendment, The engine port), a Date here. */
function toPairing(value: Wire): PairingInfo | undefined {
  const { code, slot, tokenTag, automatic, label, venueTimezone, scheduledStart, autoAllowed } =
    value;
  const { destinationName, pollSeconds, stageLabel } = value;
  if (!isText(code) || !isNumber(slot) || !isText(tokenTag) || !isFlag(automatic)) return undefined;
  if (!isText(label) || !isText(venueTimezone) || !isFlag(autoAllowed) || !isNumber(pollSeconds))
    return undefined;
  if (scheduledStart !== null && !isNumber(scheduledStart)) return undefined;
  if (!textOrNull(destinationName)) return undefined;
  if (!textOrNull(stageLabel)) return undefined;
  const court = toCourt(value.court);
  if (court === undefined) return undefined;
  return {
    code,
    slot,
    tokenTag,
    automatic,
    label,
    venueTimezone,
    scheduledStart: scheduledStart === null ? null : new Date(scheduledStart * 1000),
    autoAllowed,
    destinationName,
    pollSeconds,
    stageLabel,
    court,
    next: toNext(value.next),
  };
}

/**
 * The broadcast's non-secret fields. `scoreUpdates` is the descriptor schema's closed enum, and a
 * word outside it is null for that field alone (ledger, ruling I2 on Task 12, carry T25): native
 * reads it the same way, and never drops a snapshot for it.
 */
function toBroadcast(value: Wire): BroadcastInfo | undefined {
  const { sid, playbackUrl, label, maxDurationMinutes, srtOffered } = value;
  const cause = word<Cause>('cause', value.cause);
  const holdWindowSeconds = toHoldWindows(value.holdWindowSeconds);
  if (!isText(sid) || cause === undefined || !isText(playbackUrl) || !isText(label))
    return undefined;
  if (!isNumber(maxDurationMinutes) || !isFlag(srtOffered)) return undefined;
  if (holdWindowSeconds === undefined) return undefined;
  return {
    sid,
    cause,
    playbackUrl,
    label,
    holdWindowSeconds,
    maxDurationMinutes,
    scoreUpdates: word<ScoreUpdates>('scoreUpdates', value.scoreUpdates) ?? null,
    srtOffered,
  };
}

/** Per transport offered; SRT absent when the server offered none (A18). A window in text is malformed. */
function toHoldWindows(value: unknown): Partial<Record<Transport, number>> | undefined {
  if (!isObject(value)) return undefined;
  const windows: Partial<Record<Transport, number>> = {};
  for (const transport of ['srt', 'rtmps'] as const) {
    const seconds = value[transport];
    if (seconds === undefined) continue;
    if (!isNumber(seconds)) return undefined;
    windows[transport] = seconds;
  }
  return windows;
}

/** Null stays null; an object is read once per distinct JSON; anything else is malformed (undefined). */
function cached<K extends keyof WireCache>(
  cache: WireCache,
  key: K,
  value: unknown,
  read: (wire: Wire) => NonNullable<WireCache[K]>['value'] | undefined,
): NonNullable<WireCache[K]>['value'] | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const json = JSON.stringify(value);
  const held = cache[key];
  if (held !== null && held.json === json) return held.value;
  const parsed = read(value);
  if (parsed !== undefined) cache[key] = { json, value: parsed } as WireCache[K];
  return parsed;
}
