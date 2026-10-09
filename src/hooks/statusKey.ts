import type { Cause, LastEnd, NotReady, Refusal } from '@/domain/session/Pairing';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type { CameraState, EngineSnapshot } from '@/engine/CaptureEnginePort';
import { selectDestination } from '@/hooks/engineSelectors';
import type { MessageKey } from '@/i18n/messages';

export type StatusKey = Extract<MessageKey, `stream.status.${string}`>;

/**
 * Copy budget: 48 characters (S0). `StatusLine` ellipsises, silently, past
 * the status strip's ONE line (`layout.messageLines`, owner 2026-10-08) or Home's three.
 * Enforced for every language in src/i18n/budgets.test.ts.
 */
export const STATUS_LINE_BUDGET = 48;

const DEGRADED: Readonly<Record<DegradeReason, StatusKey>> = {
  'fell-back-to-rtmps': 'stream.status.fellBack',
  'poor-uplink': 'stream.status.weakSignal',
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

/** Native's two end reasons; how a broadcast ended without the operator is `lastEnd`'s. */
const ENDED: Readonly<Record<EndReason, StatusKey>> = {
  'operator-stopped': 'stream.status.endedOperator',
  'fatal-error': 'stream.status.endedFatal',
};

/** Amendment §2, Start refused: the line is chosen by the refusal, never the status alone. */
const REFUSED: Readonly<Record<Refusal, StatusKey>> = {
  no_destination: 'stream.status.refusedDestination',
  no_credit: 'stream.status.refusedCredit',
  not_entitled: 'stream.status.refusedEntitlement',
  unknown: 'stream.status.refusedUnknown',
  'start-failed': 'stream.status.startFailed',
};

/** Amendment §2, After a broadcast ends without the operator: back in Paired, saying how. */
const LAST_END: Readonly<Record<LastEnd, StatusKey>> = {
  'stopped-by-organiser': 'stream.status.stoppedOrganiser',
  'stopped-automatically': 'stream.status.stoppedMatch',
  'no-signal': 'stream.status.stoppedNoSignal',
  'destination-refused': 'stream.status.stoppedRefused',
  'max-duration': 'stream.status.stoppedMaxDuration',
  'phone-lost': 'stream.status.stoppedPhoneLost',
  'ended-by-seazn': 'stream.status.stoppedBySeazn',
  'hold-window-expired': 'stream.status.stoppedHoldWindow',
  stopped: 'stream.status.stopped',
};

/** Amendment §2, Starting: who started it; the operator's own hold is plan A's "Opening the link." */
const GOING_LIVE: Readonly<Record<Cause, StatusKey>> = {
  organiser: 'stream.status.goingLiveOrganiser',
  automatic: 'stream.status.goingLiveMatch',
  rejoin: 'stream.status.rejoining',
  operator: 'stream.status.connecting',
};

/** Amendment §2, Starting, not ready: native's first failing check (A11). */
const NOT_READY_LINE: Readonly<Record<NotReady, StatusKey>> = {
  camera: 'stream.status.notReadyCamera',
  sound: 'stream.status.notReadySound',
  network: 'stream.status.notReadyNetwork',
  held: 'stream.status.notReadyHeld',
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
 * Starting (Arming, Armed) names who started it: a camera taken there blocks
 * as native's `notReady: camera`, whose line says so (Task 28).
 */
const CAMERA_LINES: Readonly<Record<Kind, CameraLines | null>> = {
  idle: null,
  pairing: null,
  paired: BEFORE_AIR,
  arming: null,
  armed: null,
  connecting: BEFORE_AIR,
  publishing: ON_AIR,
  degraded: ON_AIR,
  reconnecting: null,
  ended: null,
};

/**
 * The one true sentence (AGENTS §6), as a key (spec §4). Reads the camera,
 * the state, and while paired the refusal, the last end and the destination
 * (amendment §2); never readiness, which the chips and the blocker say. It
 * never reads the heartbeat: a failing heartbeat never
 * blocks or degrades the stream (ruling 5), so it never changes what the
 * operator is told. Heat is the status strip's caption, never this line's (AGENTS §8).
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
  const { state } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'stream.status.starting';
    case 'pairing':
      return 'stream.status.pairing';
    case 'paired':
      return pairedKey(snapshot);
    case 'arming':
    case 'armed':
      return startingKey(state);
    case 'connecting':
      return 'stream.status.connecting';
    case 'publishing':
      return 'stream.status.live';
    case 'degraded':
      return DEGRADED[state.reason];
    case 'reconnecting':
      return RECONNECTING[state.cause];
    case 'ended':
      return ENDED[state.reason];
  }
}

/**
 * Amendment §2, the paired status line: a refusal, the last end, then what it
 * waits for. A refusal outranks a last end: a refused restart is the newer
 * fact (native clears both at the next start). Readiness is never named here:
 * the chips and the blocker at Go live say it.
 */
function pairedKey(snapshot: EngineSnapshot): StatusKey {
  if (snapshot.refusal !== null) return REFUSED[snapshot.refusal];
  if (snapshot.lastEnd !== null) return LAST_END[snapshot.lastEnd];
  return selectDestination(snapshot) === null
    ? 'stream.status.waitingDestination'
    : 'stream.status.waitingGoLive';
}

/** Amendment §2, Starting: retrying, then what the phone still needs, then who started it. */
function startingKey(state: Extract<SessionState, { kind: 'arming' | 'armed' }>): StatusKey {
  if (state.kind === 'arming' && state.retrying) return 'stream.status.startRetrying';
  if (state.kind === 'armed' && state.notReady !== null) return NOT_READY_LINE[state.notReady];
  return GOING_LIVE[state.cause];
}

/**
 * Ruling I2: the on-air lines that Back's "stop the broadcast first" may stand
 * in for. Every other line is an outage or a fault, and outranks it. The
 * Starting lines that name who started it are calm as "Opening the link." is.
 */
const CALM_ON_AIR: ReadonlySet<StatusKey> = new Set<StatusKey>([
  'stream.status.connecting',
  'stream.status.goingLiveOrganiser',
  'stream.status.goingLiveMatch',
  'stream.status.rejoining',
  'stream.status.live',
]);

/** Every sentence the strip's one message line can say as its status: a status key, or Back's refusal. */
export type LineKey = StatusKey | 'stream.leaveOnAir';

/**
 * Which line wins the strip's ONE message line (owner ruling, 2026-10-08, two tiers). `urgent` always wins: any status
 * that needs action or reports a failure (a refusal, a start that cannot go ahead, trouble and degraded reasons, a
 * silent engine, a stopped or ended stream, Back's "hold Stop"). `routine` is plain progress, and gives way to an
 * advisory caption (Not charging, heat, Keep the app open).
 *
 * A table over every key, so a new status key does not compile until somebody chooses (and
 * `statusTier.test.ts` lists every key by hand from the rule). The routine lines are the calm ones: the camera and the
 * pairing coming up, waiting for Go live, going live and the live line itself. "Waiting for Go live" is routine on
 * purpose (owner ruling, 2026-10-09, option B): a phone warning before air (Not charging, Keep the app open, heat)
 * beats the destination line, which shows when no caption is up. The lines that stay up until the next start (the
 * stopped* family, waiting for a destination) keep the line over a keep-the-app-open caption until then: the caption
 * is not lost, it is the lesser message.
 */
export type LineTier = 'urgent' | 'routine';
export const LINE_TIER: Readonly<Record<LineKey, LineTier>> = {
  'stream.status.starting': 'routine',
  'stream.status.pairing': 'routine',
  'stream.status.waitingGoLive': 'routine',
  'stream.status.waitingDestination': 'urgent',
  'stream.status.refusedDestination': 'urgent',
  'stream.status.refusedCredit': 'urgent',
  'stream.status.refusedEntitlement': 'urgent',
  'stream.status.refusedUnknown': 'urgent',
  'stream.status.startFailed': 'urgent',
  'stream.status.startRetrying': 'urgent',
  'stream.status.goingLiveOrganiser': 'routine',
  'stream.status.goingLiveMatch': 'routine',
  'stream.status.rejoining': 'routine',
  'stream.status.notReadyCamera': 'urgent',
  'stream.status.notReadySound': 'urgent',
  'stream.status.notReadyNetwork': 'urgent',
  'stream.status.notReadyHeld': 'urgent',
  'stream.status.connecting': 'routine',
  'stream.status.live': 'routine',
  'stream.status.fellBack': 'urgent',
  'stream.status.weakSignal': 'urgent',
  'stream.status.notDelivered': 'urgent',
  'stream.status.cameraTaken': 'urgent',
  'stream.status.cameraInUse': 'urgent',
  'stream.status.cameraReopening': 'urgent',
  'stream.status.micSilenced': 'urgent',
  'stream.status.holding': 'urgent',
  'stream.status.holdingStalled': 'urgent',
  'stream.status.holdingNotDelivered': 'urgent',
  'stream.status.stoppedOrganiser': 'urgent',
  'stream.status.stoppedMatch': 'urgent',
  'stream.status.stoppedHoldWindow': 'urgent',
  'stream.status.stoppedNoSignal': 'urgent',
  'stream.status.stoppedMaxDuration': 'urgent',
  'stream.status.stoppedRefused': 'urgent',
  'stream.status.stoppedPhoneLost': 'urgent',
  'stream.status.stoppedBySeazn': 'urgent',
  'stream.status.stopped': 'urgent',
  'stream.status.endedOperator': 'urgent',
  'stream.status.endedFatal': 'urgent',
  'stream.status.engineSilent': 'urgent',
  'stream.leaveOnAir': 'urgent',
};

/** The column's sentence: the status line, or Back's refusal over a calm one. */
export function columnLineKey(statusKey: StatusKey, leaveRefused: boolean): LineKey {
  return leaveRefused && CALM_ON_AIR.has(statusKey) ? 'stream.leaveOnAir' : statusKey;
}

/** The hold's countdown, for the `holding*` lines' `{remaining}` and `{window}`. */
export const selectHoldRemaining = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdRemainingSeconds : null;
export const selectHoldWindow = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdWindowSeconds : null;
