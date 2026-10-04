import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';

/**
 * Pure readers over the engine snapshot. They live here rather than in
 * `domain/` because `EngineSnapshot` belongs to the engine module, and the
 * layering forbids domain depending on it.
 *
 * Every one returns a primitive, because `useEngineSelector` compares by
 * identity and a fresh object would re-render on every 1 Hz tick.
 */

/**
 * Where the session stands relative to going out: nothing yet, paired, on air,
 * or on air and fighting. A phase, NOT a colour: `connecting` is phase `live`
 * here, yet its plate is inert, never red, because LIVE waits for frames to
 * advance (F-P5-6). A plate's colour comes only from `tallyPlateFor` and
 * `tallyTone` in preflight.ts; lint bars src/ui from importing this. Arming
 * and Armed hold a broadcast, so they are `live` (amendment, Identity rules).
 */
export type OnAirPhase = 'idle' | 'ready' | 'live' | 'trouble';

export function selectOnAirPhase(snapshot: EngineSnapshot): OnAirPhase {
  switch (snapshot.state.kind) {
    case 'idle':
    case 'pairing':
    case 'ended':
      return 'idle';
    case 'paired':
      return 'ready';
    case 'arming':
    case 'armed':
    case 'connecting':
    case 'publishing':
      return 'live';
    case 'degraded':
    case 'reconnecting':
      return 'trouble';
  }
}

/**
 * On air in the only sense the operator cares about: something is going out, or
 * the app is fighting to keep it going out. One definition, because three
 * screens now ask the question — the viewfinder to choose its action, Settings
 * and Diagnostics to show that the broadcast is still running behind them.
 *
 * Broader than `selectIsPublishing`, which excludes connecting and
 * reconnecting. Those are exactly the moments when stopping costs the match.
 */
export function selectIsOnAir(snapshot: EngineSnapshot): boolean {
  const phase = selectOnAirPhase(snapshot);
  return phase === 'live' || phase === 'trouble';
}

/**
 * The engine as the shell's reopen and leave rules see it. Module scope and
 * primitive-returning, like every selector here, so a 1 Hz tick re-renders
 * nothing unless the status itself changes. The `default` is safe because
 * `ended` and the resting kinds are named: a new broadcast kind is `live` by
 * construction, which is the amendment's rule.
 */
export function selectEngineStatus(snapshot: EngineSnapshot): EngineStatus {
  const { state } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'idle';
    case 'pairing':
    case 'paired':
      return 'paired';
    case 'ended':
      return state.reason === 'operator-stopped' ? 'stopped' : 'failed';
    default:
      return 'live';
  }
}

/**
 * Whether the orientation gate must hold its lock (ruling R24): paired or
 * live. The camera is open while paired (CD37), so the lock holds from Paired
 * on, as it did from Armed; this asks "is the camera committed", not "is
 * something going out".
 */
export function selectHoldsOrientation(snapshot: EngineSnapshot): boolean {
  const status = selectEngineStatus(snapshot);
  return status === 'paired' || status === 'live';
}

/**
 * Declared at module scope so their identity is stable across renders.
 * An inline `(s) => s.telemetry.bitrateKbps` is a new function every render,
 * which defeats the memoisation this hook exists for.
 */
export const selectStateKind = (snapshot: EngineSnapshot) => snapshot.state.kind;
export const selectBitrateKbps = (snapshot: EngineSnapshot) => snapshot.telemetry.bitrateKbps;
export const selectAudioLevel = (snapshot: EngineSnapshot) => snapshot.telemetry.audioLevel;
export const selectShed = (snapshot: EngineSnapshot) => snapshot.telemetry.shed;
export const selectSurvivesBackground = (snapshot: EngineSnapshot) => snapshot.survivesBackground;
/** The broadcast's overlay, else the pairing's; null when the server sent no usable one. */
export const selectOverlayUrl = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.overlayUrl ?? snapshot.pairing?.overlayUrl ?? null;
export const selectPlaybackUrl = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.playbackUrl ?? null;
export const selectScoreUpdates = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.scoreUpdates ?? null;
/** Pairing's label is empty until the claim is answered: read as none. */
export const selectLabel = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.label || snapshot.pairing?.label || null;
/** The venue's zone from the pairing: every time the operator reads is in it (spec §2). */
export const selectVenueZone = (snapshot: EngineSnapshot) =>
  snapshot.pairing?.venueTimezone || null;
/** Time on air when it ended (plan B's `durationMs`); null for a session that never went live. */
export const selectEndedDurationMs = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'ended' ? snapshot.state.durationMs : null;
/** Whether native holds a pairing; before that there is no overlay to try. */
export const selectHasPairing = (snapshot: EngineSnapshot) => snapshot.pairing !== null;
/** What names native's pairing (amendment, Identity rules): read apart, so each is a stable scalar. */
export const selectHeldCode = (snapshot: EngineSnapshot) => snapshot.pairing?.code ?? null;
export const selectHeldSlot = (snapshot: EngineSnapshot) => snapshot.pairing?.slot ?? null;
export const selectHeldTokenTag = (snapshot: EngineSnapshot) => snapshot.pairing?.tokenTag ?? null;

/** For one-off reads (usePairing), never for useEngineSelector: a new object each call. */
export function selectHeldName(snapshot: EngineSnapshot): CodeName {
  const { pairing } = snapshot;
  return pairing === null
    ? NO_NAME
    : { code: pairing.code, slot: pairing.slot, tokenTag: pairing.tokenTag };
}

/** The pairing native left without being asked, by name; null when none (one-off reads only). */
export function selectUnpairedName(snapshot: EngineSnapshot): CodeName | null {
  const { unpaired } = snapshot;
  return unpaired === null
    ? null
    : { code: unpaired.code, slot: unpaired.slot, tokenTag: unpaired.tokenTag };
}

/** The transport in use, or null when nothing is connected. */
export function selectTransport(snapshot: EngineSnapshot): 'srt' | 'rtmps' | null {
  const { state } = snapshot;
  return 'transport' in state ? state.transport : null;
}

/** True whenever bytes are reaching the front door. */
export function selectIsPublishing(snapshot: EngineSnapshot): boolean {
  const { kind } = snapshot.state;
  return kind === 'publishing' || kind === 'degraded';
}

/**
 * When the current broadcast began, or null when nothing is running.
 *
 * Deliberately returns the start instant rather than an elapsed duration: a
 * selector taking `now` could not be declared at module scope, and an inline
 * one is a fresh function on every render — the exact thing `useEngineSelector`
 * warns against. Subtract in render instead.
 *
 * Survives a drop by design — the front door holds the input, so the broadcast
 * is continuous even while the uplink is not.
 */
export function selectSinceEpochMs(snapshot: EngineSnapshot): number | null {
  const { state } = snapshot;
  return 'sinceEpochMs' in state ? state.sinceEpochMs : null;
}

export const METER_SEGMENTS = 6;

/**
 * Whole segments lit, not the level: a primitive that changes only when a
 * segment does. A segment lights once the level reaches into its sixth, so any
 * sound shows — a faint mic below AUDIO_FLOOR is one orange segment, never an
 * empty meter (spec §4). A level off the wire outside 0..1, or not a number,
 * is clamped rather than drawn.
 */
export function selectMeterSegments(snapshot: EngineSnapshot): number {
  const lit = Math.ceil(snapshot.telemetry.audioLevel * METER_SEGMENTS);
  return Number.isFinite(lit) ? Math.min(METER_SEGMENTS, Math.max(0, lit)) : 0;
}
