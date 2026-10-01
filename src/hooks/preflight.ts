import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { StatusKey } from '@/hooks/statusKey';
import type { MessageKey } from '@/i18n/messages';

export type Chip = 'code' | 'camera' | 'network' | 'sound';
export type Preflight = Readonly<Record<Chip, boolean>>;

/** Spec §1's order on screen: camera, sound, network, code. */
export const CHIP_ORDER: readonly Chip[] = ['camera', 'sound', 'network', 'code'];

/**
 * The reason shown at the control: a dead code first, since no fix on the
 * phone helps. After it, the same order the status line names them in
 * (`armedKey` in statusKey.ts).
 */
const BLOCKER_ORDER: readonly Chip[] = ['code', 'camera', 'network', 'sound'];

/**
 * M2: ready only when the camera is ours and producing frames. Another app's
 * take, our own reopen, resume or switch, and no session all read not ready,
 * whatever the frames say, so the chip, the plate and Go live never sit READY
 * beside a camera line.
 */
export const selectCameraReady = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.cameraReady && snapshot.camera === 'own';
export const selectNetworkReachable = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.networkReachable;
/** The one floor, shared with the meter's notch (S0's audioFloor rule). */
export const selectSoundReady = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.audioLevel >= AUDIO_FLOOR;

/**
 * The saved code as the viewfinder judges it. `noDeadline` is an engine with no
 * descriptor yet (still arming, or a session native reopened with none).
 */
export type CodeCheck = 'usable' | 'unusable' | 'timedOut' | 'noDeadline';

/**
 * R3: the code chip is green only when the saved code is usable AND the
 * warming gate is open. The one reading behind the chip, Go live's blocker and
 * the status line (`viewfinderStatusKey`), so the three never disagree. An
 * unusable code is named first: no wait on the phone fixes it.
 */
export function codeCheck(input: {
  unusable: boolean;
  deadlineKnown: boolean;
  passed: boolean;
}): CodeCheck {
  if (input.unusable) return 'unusable';
  if (!input.deadlineKnown) return 'noDeadline';
  return input.passed ? 'timedOut' : 'usable';
}

export type BlockerKey = Extract<MessageKey, `stream.blocker.${string}`>;

/** What a code check reads as. `line: null` leaves the engine's line. */
export type CodeRead = {
  readonly chip: boolean;
  readonly reason: BlockerKey | null;
  readonly line: StatusKey | null;
};

/**
 * R3 and ruling I3: the one table behind the code chip, Go live's reason and
 * the status line (`viewfinderStatusKey`), so the three never disagree. No
 * descriptor reads not ready everywhere, and never "timed out": nothing has.
 */
export const CODE_READS: Readonly<Record<CodeCheck, CodeRead>> = {
  usable: { chip: true, reason: null, line: null },
  unusable: { chip: false, reason: 'stream.blocker.unusable', line: 'stream.status.unusable' },
  timedOut: { chip: false, reason: 'stream.blocker.code', line: 'stream.status.codeTimedOut' },
  noDeadline: { chip: false, reason: 'stream.blocker.noDetails', line: 'stream.status.noDetails' },
};

const CHIP_REASON: Readonly<Record<Exclude<Chip, 'code'>, BlockerKey>> = {
  camera: 'stream.blocker.camera',
  network: 'stream.blocker.network',
  sound: 'stream.blocker.sound',
};

/** Why Go live is off, at the control: the code's from `CODE_READS`, any other chip's own. */
export function blockerReason(blocker: Chip | null, code: CodeCheck): BlockerKey | null {
  if (blocker === null) return null;
  return blocker === 'code' ? CODE_READS[code].reason : CHIP_REASON[blocker];
}

/** Go live enables only when every chip is green (spec §1; AGENTS §6: the pre-flight is the safety). */
export function goLiveBlocker(preflight: Preflight): Chip | null {
  return BLOCKER_ORDER.find((chip) => !preflight[chip]) ?? null;
}

export type TallyPlate =
  'starting' | 'notReady' | 'ready' | 'connecting' | 'live' | 'trouble' | 'ended';

export type TallyTone = 'live' | 'healthy' | 'degraded' | 'inert';

/**
 * Spec §4's state plate (D14). The LIVE gate: LIVE only while publishing —
 * connecting is native saying frames are not yet advancing (F-P5-6).
 */
export function tallyPlateFor(kind: SessionState['kind'], ready: boolean): TallyPlate {
  switch (kind) {
    case 'idle':
      return 'starting';
    case 'armed':
      return ready ? 'ready' : 'notReady';
    case 'connecting':
      return 'connecting';
    case 'publishing':
      return 'live';
    case 'degraded':
    case 'reconnecting':
      return 'trouble';
    case 'ended':
      return 'ended';
  }
}

/** The only place a plate becomes a colour. Red is LIVE and nothing else (AGENTS §5). */
export function tallyTone(plate: TallyPlate): TallyTone {
  switch (plate) {
    case 'live':
      return 'live';
    case 'ready':
      return 'healthy';
    case 'trouble':
      return 'degraded';
    default:
      return 'inert';
  }
}
