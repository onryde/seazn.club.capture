import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type { DegradeReason, EndReason } from '@/domain/session/SessionState';

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
 * Declared at module scope so their identity is stable across renders.
 * An inline `(s) => s.telemetry.bitrateKbps` is a new function every render,
 * which defeats the memoisation this hook exists for.
 */
export const selectStateKind = (snapshot: EngineSnapshot) => snapshot.state.kind;
export const selectBitrateKbps = (snapshot: EngineSnapshot) => snapshot.telemetry.bitrateKbps;
export const selectRttMs = (snapshot: EngineSnapshot) => snapshot.telemetry.rttMs;
export const selectAudioLevel = (snapshot: EngineSnapshot) => snapshot.telemetry.audioLevel;
export const selectDroppedFrames = (snapshot: EngineSnapshot) => snapshot.telemetry.droppedFrames;
export const selectShed = (snapshot: EngineSnapshot) => snapshot.telemetry.shed;
export const selectInterruption = (snapshot: EngineSnapshot) => snapshot.telemetry.interruption;
export const selectReportedAtMs = (snapshot: EngineSnapshot) => snapshot.reportedAtMs;
export const selectSurvivesBackground = (snapshot: EngineSnapshot) => snapshot.survivesBackground;
export const selectHoldWindowSeconds = (snapshot: EngineSnapshot) =>
  snapshot.credentials?.holdWindowSeconds ?? null;
export const selectOverlayUrl = (snapshot: EngineSnapshot) =>
  snapshot.credentials?.overlayUrl ?? null;
export const selectPlaybackUrl = (snapshot: EngineSnapshot) =>
  snapshot.credentials?.playbackUrl ?? null;
export const selectScoreUpdates = (snapshot: EngineSnapshot) =>
  snapshot.credentials?.scoreUpdates ?? null;

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

/**
 * One sentence that is always true, in the interface's own voice. Never a bare
 * spinner: "Uplink lost — holding, 38s left" tells an operator what is
 * happening and how long they have. An unexplained delay tells them nothing.
 */
/**
 * Copy budget: 48 characters. The column is 114px wide at 13.5px Geist, which
 * is roughly 17 characters a line and four lines before `StatusLine` silently
 * ellipsises. Longer sentences lost their own instruction — "Check it before
 * going live" became "Check it…" — and nothing would have caught it, because a
 * `numberOfLines` truncation throws no error. Enforced by a test.
 */
export const STATUS_LINE_BUDGET = 48;

export function selectStatusLine(snapshot: EngineSnapshot): string {
  const { state, telemetry } = snapshot;

  // An outside interruption outranks the session copy: on iOS a call keeps the
  // app foregrounded while killing the microphone, and "Live" would be true
  // about the transport and a lie about the broadcast.
  const interrupted = interruptionNote(telemetry.interruption);
  if (interrupted !== null) return interrupted;

  switch (state.kind) {
    case 'idle':
      return 'Scan a fixture code to begin.';
    case 'armed':
      return telemetry.audioLevel >= AUDIO_FLOOR
        ? // Says what the control now asks for: a hold, not a tap (§6).
          'Ready. Hold to go live.'
        : 'No sound. Check the mic before going live.';
    case 'connecting':
      return 'Opening the link.';
    // Thermal state is deliberately NOT reported here. It is a device
    // condition, so the stage's edge note owns it (AGENTS.md §8) — saying it
    // in both places put the same sentence on screen twice, worded
    // differently, with the column's copy truncated.
    case 'publishing':
      return 'Live. Sound and picture going out.';
    case 'degraded':
      return degradedLine(state.reason);
    case 'reconnecting':
      return `Signal lost. Holding ${state.holdRemainingSeconds}s.`;
    case 'ended':
      return endedLine(state.reason);
  }
}

function interruptionNote(interruption: string | null): string | null {
  switch (interruption) {
    case 'call':
      return 'On a call. Audio is paused until it ends.';
    case 'camera-in-use':
      return 'Another app took the camera.';
    case 'background':
      return 'Camera pauses when you leave the app.';
    case 'system':
      return 'The phone interrupted the camera.';
    default:
      return null;
  }
}

/**
 * Closed unions, no default branch. Widening these to `string` is what forced
 * the catch-all "Live, with a problem." into existence — the vaguest sentence
 * in the app, produced by a case that cannot occur. Exhaustiveness means a new
 * reason is a compile error rather than a shrug.
 *
 * Copy is in the ground's vocabulary, not the contract's: an operator can act
 * on "backup link" and "check the mic", not on "RTMPS" or "uplink".
 */
function degradedLine(reason: DegradeReason): string {
  switch (reason) {
    case 'fell-back-to-rtmps':
      return 'Still live, on the backup link.';
    case 'poor-uplink':
      return 'Weak signal. Still live.';
    case 'audio-below-floor':
      return 'Live with no sound. Check the mic now.';
  }
}

function endedLine(reason: EndReason): string {
  switch (reason) {
    case 'operator-stopped':
      return 'Stopped. Scan a code to start another.';
    case 'hold-window-expired':
      return 'Signal never came back. Scan again.';
    case 'fatal-error':
      return 'Stopped unexpectedly. Check Diagnostics.';
  }
}

function transportName(transport: 'srt' | 'rtmps'): string {
  return transport === 'srt' ? 'SRT' : 'RTMPS';
}
