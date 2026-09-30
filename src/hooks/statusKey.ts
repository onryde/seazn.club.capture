import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import type { CodeCheck } from '@/hooks/preflight';
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

/**
 * The one true sentence (AGENTS §6), as a key (spec §4). Reads state and
 * pre-flight only. It never reads the heartbeat: a failing heartbeat never
 * blocks or degrades the stream (ruling 5), so it never changes what the
 * operator is told. Heat is the top strip's, never this line's (AGENTS §8).
 * Nor does it read the encoded rates or the delivered lag: native's state
 * already says what they mean, and a null there is no reading, not trouble.
 */
export function selectStatusKey(snapshot: EngineSnapshot): StatusKey {
  const { state, telemetry } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'stream.status.starting';
    case 'armed':
      return armedKey(telemetry);
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

/** The first pre-flight chip that is off, in the blocker's order after the code (Task 13). */
function armedKey(telemetry: Telemetry): StatusKey {
  if (!telemetry.cameraReady) return 'stream.status.noCamera';
  if (!telemetry.networkReachable) return 'stream.status.noNetwork';
  if (telemetry.audioLevel < AUDIO_FLOOR) return 'stream.status.noSound';
  return 'stream.status.ready';
}

/**
 * Arm-time facts the snapshot cannot know: whether the saved code is usable,
 * and whether the clock has passed the warming deadline (spec §5), read from
 * the same `codeCheck` as the code chip (R3). They never override an on-air
 * line.
 */
export function viewfinderStatusKey(
  engineKey: StatusKey,
  input: { kind: SessionState['kind']; code: CodeCheck },
): StatusKey {
  const arming = input.kind === 'idle' || input.kind === 'armed';
  if (arming && input.code === 'unusable') return 'stream.status.unusable';
  if (input.kind === 'armed' && input.code === 'timedOut') return 'stream.status.codeTimedOut';
  return engineKey;
}

/** The hold's countdown, for the `holding*` lines' `{remaining}` and `{window}`. */
export const selectHoldRemaining = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdRemainingSeconds : null;
export const selectHoldWindow = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdWindowSeconds : null;
