import type { SessionEvent, SessionState, ShedStep } from '@/domain/session/SessionState';
import { projectEvent } from '@/domain/session/projectEvent';
import type {
  CaptureEnginePort,
  EngineIntent,
  EngineSnapshot,
  Interruption,
  Telemetry,
} from './CaptureEnginePort';

/**
 * The fake is built first, on purpose (AGENTS.md §10).
 *
 * Every screen, state and failure mode must be developable on a laptop with no
 * device — and the states that matter most are the ones hardest to produce on
 * real hardware: an uplink dying mid-over, a handset hitting its thermal
 * ceiling, the hold window running out, an iPhone locking mid-match. Those are
 * one call away here.
 */
export type FakeCaptureEngine = CaptureEnginePort & {
  /** Jump straight to any state, with telemetry derived to match it. */
  forceState(state: SessionState): void;
  /** Feed a single native event through the real projection. */
  apply(event: SessionEvent, atMs?: number): void;
  /**
   * Stop the heartbeat and freeze `reportedAtMs` — what an iPhone lock looks
   * like from JavaScript. The snapshot goes stale and the app must stop
   * claiming the broadcast is fine.
   */
  suspend(): void;
  /**
   * Come back after `awayMs`, then resolve the ambiguity the way native would:
   * either the hold covered the absence, or it ran out.
   */
  resume(awayMs: number, outcome: 'held' | 'expired'): void;
  /** Report an interruption that leaves the app foregrounded, e.g. a call. */
  interrupt(interruption: Interruption | null): void;
  /** Whether capture survives backgrounding. Android true, iOS false. */
  setSurvivesBackground(value: boolean): void;
  /** Cancel the scripted session without ending it. */
  cancelScript(): void;
  /** Stop every timer. Always call this in test teardown. */
  dispose(): void;
};

const IDLE_TELEMETRY: Telemetry = {
  bitrateKbps: 0,
  droppedFrames: 0,
  rttMs: null,
  audioLevel: 0,
  thermalHeadroom: null,
  batteryLevel: null,
  captureTimestampMs: null,
  shed: null,
  interruption: null,
};

/** The scripted session, in seconds from `start`. Roughly a bad afternoon. */
const SCRIPT: readonly (readonly [number, SessionEvent])[] = [
  [0, { kind: 'PublishStarted', transport: 'srt' }],
  [8, { kind: 'TransportDegraded', reason: 'poor-uplink' }],
  [12, { kind: 'FellBackToRtmps' }],
  [16, { kind: 'ThermalCeilingHit', shed: 'overlay-preview' }],
  [18, { kind: 'UplinkLost', holdWindowSeconds: 60 }],
  [26, { kind: 'PublishResumed', transport: 'rtmps' }],
];

const HEARTBEAT_MS = 1000;

export function createFakeCaptureEngine(now: () => number = Date.now): FakeCaptureEngine {
  let snapshot: EngineSnapshot = {
    state: { kind: 'idle' },
    telemetry: IDLE_TELEMETRY,
    credentials: null,
    reportedAtMs: now(),
    survivesBackground: false,
  };

  const listeners = new Set<() => void>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const publish = (next: EngineSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const apply = (event: SessionEvent, atMs: number = now()): void => {
    // Telemetry must describe the state it ships with, not the one before it —
    // otherwise the HUD renders "RECONNECTING · 3000k" and the operator stops
    // trusting the display.
    const state = projectEvent(snapshot.state, event, atMs);
    const shed = event.kind === 'ThermalCeilingHit' ? event.shed : snapshot.telemetry.shed;
    publish({
      ...snapshot,
      state,
      telemetry: telemetryFor(state, snapshot.telemetry, atMs, shed),
      credentials: event.kind === 'SessionReset' ? null : snapshot.credentials,
      reportedAtMs: atMs,
    });
  };

  /**
   * Re-emits an unchanged snapshot with a fresh timestamp. Without this,
   * silence would be indistinguishable from absence and `reportedAtMs` would
   * carry no information at all.
   */
  const beat = (): void => {
    const atMs = now();
    publish({
      ...snapshot,
      telemetry: telemetryFor(snapshot.state, snapshot.telemetry, atMs, snapshot.telemetry.shed),
      reportedAtMs: atMs,
    });
  };

  const startHeartbeat = (): void => {
    if (heartbeat === null) heartbeat = setInterval(beat, HEARTBEAT_MS);
  };

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const cancelScript = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers.length = 0;
  };

  const runScript = (): void => {
    cancelScript();
    for (const [seconds, event] of SCRIPT) {
      timers.push(setTimeout(() => apply(event), seconds * 1000));
    }
  };

  const send = (intent: EngineIntent): void => {
    switch (intent.kind) {
      case 'arm':
        snapshot = { ...snapshot, credentials: intent.credentials };
        return apply({ kind: 'SessionArmed' });
      case 'start':
        return runScript();
      case 'stop':
        cancelScript();
        return apply({ kind: 'SessionEnded', reason: 'operator-stopped' });
      case 'reset':
        cancelScript();
        return apply({ kind: 'SessionReset' });
      case 'switchCamera':
        return;
    }
  };

  startHeartbeat();

  return {
    send,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => snapshot,

    forceState: (state) =>
      publish({
        ...snapshot,
        state,
        telemetry: telemetryFor(state, snapshot.telemetry, now(), snapshot.telemetry.shed),
        reportedAtMs: now(),
      }),

    apply,

    suspend: () => {
      stopHeartbeat();
      cancelScript();
    },

    resume: (awayMs, outcome) => {
      startHeartbeat();
      if (outcome === 'held') {
        apply({ kind: 'UplinkLost', holdWindowSeconds: 60 });
        timers.push(
          setTimeout(() => apply({ kind: 'PublishResumed', transport: 'rtmps' }), 1200),
        );
        return;
      }
      apply({ kind: 'SessionEnded', reason: 'hold-window-expired' });
      void awayMs;
    },

    interrupt: (interruption) =>
      publish({
        ...snapshot,
        telemetry: { ...snapshot.telemetry, interruption },
        reportedAtMs: now(),
      }),

    setSurvivesBackground: (value) =>
      publish({ ...snapshot, survivesBackground: value, reportedAtMs: now() }),

    cancelScript,

    dispose: () => {
      cancelScript();
      stopHeartbeat();
    },
  };
}

/**
 * Numbers that move, because a HUD rendered against constants hides every
 * layout bug that matters — a bitrate jittering between four and five digits is
 * exactly what tabular figures are there to hold still.
 */
function telemetryFor(
  state: SessionState,
  previous: Telemetry,
  atMs: number,
  shed: ShedStep | null,
): Telemetry {
  if (state.kind === 'idle' || state.kind === 'ended') return IDLE_TELEMETRY;

  const wobble = Math.sin(atMs / 700);
  const live = state.kind === 'publishing' || state.kind === 'degraded';
  // The microphone is open from the moment the session is armed, not from the
  // moment it publishes. Reporting zero while `armed` held Go live disabled
  // forever against the fake, which made the entire live HUD unreachable — so
  // every on-air state went unreviewed.
  const capturing = live || state.kind === 'armed' || state.kind === 'connecting';

  return {
    bitrateKbps: live ? Math.round(3000 + wobble * 240) : 0,
    droppedFrames: previous.droppedFrames + (state.kind === 'degraded' ? 3 : 0),
    rttMs: live ? Math.round(48 + wobble * 12) : null,
    audioLevel: capturing ? 0.42 + wobble * 0.18 : 0,
    thermalHeadroom: shed === null ? 0.68 : 0.12,
    batteryLevel: 0.74,
    captureTimestampMs: live ? atMs : null,
    shed,
    interruption: previous.interruption,
  };
}
