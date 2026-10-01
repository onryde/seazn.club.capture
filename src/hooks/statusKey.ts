import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type { CameraState, EngineSnapshot } from '@/engine/CaptureEnginePort';
import {
  CODE_READS,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  type CodeCheck,
} from '@/hooks/preflight';
import type { MessageKey } from '@/i18n/messages';

export type StatusKey = Extract<MessageKey, `stream.status.${string}`>;

/**
 * Copy budget: 48 characters (S0). The column is ~17 characters a line and
 * three lines before `StatusLine` ellipsises, silently. Enforced for every
 * language in src/i18n/budgets.test.ts.
 */
export const STATUS_LINE_BUDGET = 48;

const DEGRADED: Readonly<Record<DegradeReason, StatusKey>> = {
  'fell-back-to-rtmps': 'stream.status.fellBack',
  'poor-uplink': 'stream.status.weakSignal',
  'audio-below-floor': 'stream.status.liveNoSound',
  'not-delivered': 'stream.status.notDelivered',
  'camera-taken': 'stream.status.cameraTaken',
  'mic-silenced': 'stream.status.micSilenced',
};

/** D38: the line says which trigger is being ridden out, with the hold's countdown. */
const RECONNECTING: Readonly<Record<ReconnectCause, StatusKey>> = {
  'uplink-lost': 'stream.status.holding',
  'video-stalled': 'stream.status.holdingStalled',
  'not-delivered': 'stream.status.holdingNotDelivered',
};

const ENDED: Readonly<Record<EndReason, StatusKey>> = {
  'operator-stopped': 'stream.status.endedOperator',
  'stopped-by-organiser': 'stream.status.endedOrganiser',
  'hold-window-expired': 'stream.status.endedHoldExpired',
  'fatal-error': 'stream.status.endedFatal',
};

type Kind = SessionState['kind'];
type CameraLines = Readonly<Record<CameraState, StatusKey | null>>;

/** Before air: another app's take is named, with no slate claim; our own reopen is the chip's. */
const BEFORE_AIR: CameraLines = {
  own: null,
  taken: 'stream.status.cameraInUse',
  reopening: null,
  resuming: null,
  switching: null,
};

/** On air: another app's take is the slate line; our own reopen, resume or switch says so. */
const ON_AIR: CameraLines = {
  own: null,
  taken: 'stream.status.cameraTaken',
  reopening: 'stream.status.cameraReopening',
  resuming: 'stream.status.cameraReopening',
  switching: 'stream.status.cameraReopening',
};

/**
 * The camera ruling (fix round 1, owner-visible; replaces carry 11's "whatever
 * the state"): whose camera it is says itself before the state's own line,
 * but only before and on air. A hold's countdown outranks the camera, an
 * ending says how it ended, and with no session there is no camera to name.
 */
const CAMERA_LINES: Readonly<Record<Kind, CameraLines | null>> = {
  idle: null,
  armed: BEFORE_AIR,
  connecting: BEFORE_AIR,
  publishing: ON_AIR,
  degraded: ON_AIR,
  reconnecting: null,
  ended: null,
};

/**
 * The one true sentence (AGENTS §6), as a key (spec §4). Reads the camera,
 * state and pre-flight only. It never reads the heartbeat: a failing heartbeat never
 * blocks or degrades the stream (ruling 5), so it never changes what the
 * operator is told. Heat is the top strip's, never this line's (AGENTS §8).
 * Nor does it read the encoded rates or the delivered lag: native's state
 * already says what they mean, and a null there is no reading, not trouble.
 */
export function selectStatusKey(snapshot: EngineSnapshot): StatusKey {
  const lines = CAMERA_LINES[snapshot.state.kind];
  const camera = lines === null || snapshot.camera === null ? null : lines[snapshot.camera];
  return camera ?? stateKey(snapshot);
}

/** Each state's own line. A table, exempt from the line count (AGENTS §12). */
function stateKey(snapshot: EngineSnapshot): StatusKey {
  const { state, telemetry } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'stream.status.starting';
    case 'armed':
      return armedKey(snapshot);
    case 'connecting':
      return 'stream.status.connecting';
    case 'publishing':
      // D39: the level floor is a display rule, never a native reason.
      return telemetry.audioLevel < AUDIO_FLOOR
        ? 'stream.status.liveNoSound'
        : 'stream.status.live';
    case 'degraded':
      return DEGRADED[state.reason];
    case 'reconnecting':
      return RECONNECTING[state.cause];
    case 'ended':
      return ENDED[state.reason];
  }
}

/**
 * The first pre-flight chip that is off, in the blocker's order after the
 * code (Task 13), read through the chips' own selectors so the two agree.
 */
function armedKey(snapshot: EngineSnapshot): StatusKey {
  if (!selectCameraReady(snapshot)) return 'stream.status.noCamera';
  if (!selectNetworkReachable(snapshot)) return 'stream.status.noNetwork';
  if (!selectSoundReady(snapshot)) return 'stream.status.noSound';
  return 'stream.status.ready';
}

/**
 * Arm-time facts the snapshot cannot know: whether the saved code is usable,
 * whether the clock has passed the warming deadline (spec §5), and whether
 * the session's details are there at all, read from `CODE_READS` as the code
 * chip and Go live's reason are (R3, ruling I3). An unusable code says so from
 * the start, since no wait arms it; the others are facts of an armed session.
 * None overrides an on-air line.
 */
export function viewfinderStatusKey(
  engineKey: StatusKey,
  input: { kind: Kind; code: CodeCheck },
): StatusKey {
  const { line } = CODE_READS[input.code];
  if (line === null) return engineKey;
  const says = input.kind === 'armed' || (input.kind === 'idle' && input.code === 'unusable');
  return says ? line : engineKey;
}

/**
 * Ruling I2: the on-air lines that Back's "stop the broadcast first" may stand
 * in for. Every other line is an outage or a fault, and outranks it.
 */
const CALM_ON_AIR: ReadonlySet<StatusKey> = new Set<StatusKey>([
  'stream.status.connecting',
  'stream.status.live',
]);

/** The column's sentence: the status line, or Back's refusal over a calm one. */
export function columnLineKey(statusKey: StatusKey, leaveRefused: boolean): MessageKey {
  return leaveRefused && CALM_ON_AIR.has(statusKey) ? 'stream.leaveOnAir' : statusKey;
}

/** The hold's countdown, for the `holding*` lines' `{remaining}` and `{window}`. */
export const selectHoldRemaining = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdRemainingSeconds : null;
export const selectHoldWindow = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdWindowSeconds : null;
