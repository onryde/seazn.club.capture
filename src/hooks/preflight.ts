import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';

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

export const selectCameraReady = (snapshot: EngineSnapshot) => snapshot.telemetry.cameraReady;
export const selectNetworkReachable = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.networkReachable;
/** The one floor, shared with the meter's notch (S0's audioFloor rule). */
export const selectSoundReady = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.audioLevel >= AUDIO_FLOOR;

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
