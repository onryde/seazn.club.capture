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

/** The three states the tally colour distinguishes. Everything else is detail. */
export type TallyState = 'idle' | 'ready' | 'live' | 'trouble';

export function selectTally(snapshot: EngineSnapshot): TallyState {
  switch (snapshot.state.kind) {
    case 'idle':
    case 'ended':
      return 'idle';
    case 'armed':
      return 'ready';
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
  const tally = selectTally(snapshot);
  return tally === 'live' || tally === 'trouble';
}

/**
 * The engine as the shell's reopen and leave rules see it. Module scope and
 * primitive-returning, like every selector here, so a 1 Hz tick re-renders
 * nothing unless the status itself changes.
 */
export function selectEngineStatus(snapshot: EngineSnapshot): EngineStatus {
  const { state } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'idle';
    case 'armed':
      return 'armed';
    case 'connecting':
    case 'publishing':
    case 'degraded':
    case 'reconnecting':
      return 'live';
    case 'ended':
      // D10: an organiser stop spends the code, exactly as the operator's does.
      return state.reason === 'operator-stopped' || state.reason === 'stopped-by-organiser'
        ? 'stopped'
        : 'failed';
  }
}

/**
 * Whether the orientation gate must hold its lock (ruling R24): armed or live.
 * Armed counts, unlike `selectIsOnAir`, because the camera is already running
 * and a rotation would re-lay it out; this asks "is the camera committed", not
 * "is something going out".
 */
export function selectHoldsOrientation(snapshot: EngineSnapshot): boolean {
  const status = selectEngineStatus(snapshot);
  return status === 'armed' || status === 'live';
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
export const selectReportedAtMs = (snapshot: EngineSnapshot) => snapshot.reportedAtMs;
export const selectSurvivesBackground = (snapshot: EngineSnapshot) => snapshot.survivesBackground;
/** Null with no descriptor, and null when the server sent no usable overlay (a /relay or foreign URL). */
export const selectOverlayUrl = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.overlayUrl ?? null;
export const selectPlaybackUrl = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.playbackUrl ?? null;
export const selectScoreUpdates = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.scoreUpdates ?? null;
export const selectLabel = (snapshot: EngineSnapshot) => snapshot.descriptor?.label ?? null;
/** A number, not the Date: `useEngineSelector` compares by identity. */
export const selectWarmingDeadlineMs = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.warmingDeadline.getTime() ?? null;

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
