import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type Chip = 'camera' | 'network' | 'sound';
export type Preflight = Readonly<Record<Chip, boolean>>;

/** Spec §1's order on screen: camera, sound, network. */
export const CHIP_ORDER: readonly Chip[] = ['camera', 'sound', 'network'];

/** The reason shown at the control: the same order the status line names them in (`pairedKey`). */
const BLOCKER_ORDER: readonly Chip[] = ['camera', 'network', 'sound'];

/**
 * M2: ready only when native says the camera is ready AND it is ours. Another
 * app's take, our own reopen, resume or switch, and no pairing all read not
 * ready, so the chip, the plate and Go live never sit READY beside a camera line.
 */
export const selectCameraReady = (snapshot: EngineSnapshot) =>
  snapshot.ready.camera && snapshot.camera === 'own';
export const selectNetworkReachable = (snapshot: EngineSnapshot) => snapshot.ready.network;
/** Native's verdict (A11): the JS audio floor is no longer the judge. */
export const selectSoundReady = (snapshot: EngineSnapshot) => snapshot.ready.sound;

export type BlockerKey = Extract<MessageKey, `stream.blocker.${string}`>;

const CHIP_REASON: Readonly<Record<Chip, BlockerKey>> = {
  camera: 'stream.blocker.camera',
  network: 'stream.blocker.network',
  sound: 'stream.blocker.sound',
};

/** Why Go live is off, at the control. */
export function blockerReason(blocker: Chip | null): BlockerKey | null {
  return blocker === null ? null : CHIP_REASON[blocker];
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
 * connecting is native saying frames are not yet advancing (F-P5-6). Arming
 * and Armed read as connecting until Task 28 gives them their own plates.
 */
export function tallyPlateFor(kind: SessionState['kind'], ready: boolean): TallyPlate {
  switch (kind) {
    case 'idle':
    case 'pairing':
      return 'starting';
    case 'paired':
      return ready ? 'ready' : 'notReady';
    case 'arming':
    case 'armed':
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
