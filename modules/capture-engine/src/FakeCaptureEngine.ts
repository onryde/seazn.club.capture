import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { Transport } from '@/domain/credentials/StreamCredentials';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type {
  CaptureEnginePort,
  EngineIntent,
  EngineSnapshot,
  Telemetry,
} from './CaptureEnginePort';

/**
 * The fake is built first, on purpose (AGENTS §10), and it holds no state
 * machine (spec §2, "One authority"): it plays named snapshots. Intents move
 * it only the few steps a laptop needs — arm, start, stop, reset — and every
 * other state is one `scene()` away.
 */
export type FakeScene =
  | 'armed-not-ready'
  | 'armed-ready'
  | 'connecting'
  | 'live'
  | 'fell-back'
  | 'holding'
  | 'stalled'
  | 'restarting'
  | 'not-delivered'
  | 'camera-taken'
  | 'camera-reopened'
  | 'mic-silenced'
  | 'stopped'
  | 'stopped-by-organiser'
  | 'fatal'
  | 'shed';

export const FAKE_SCENES: readonly FakeScene[] = [
  'armed-not-ready',
  'armed-ready',
  'connecting',
  'live',
  'fell-back',
  'holding',
  'stalled',
  'restarting',
  'not-delivered',
  'camera-taken',
  'camera-reopened',
  'mic-silenced',
  'stopped',
  'stopped-by-organiser',
  'fatal',
  'shed',
];

export type FakeCaptureEngine = CaptureEnginePort & {
  /** Jump to a named state from spec §6's list, with telemetry to match. */
  scene(name: FakeScene): void;
  /** Jump to any state; telemetry follows its kind. */
  forceState(state: SessionState): void;
  /** Change telemetry alone, as the next 1 Hz report would. */
  patch(telemetry: Partial<Telemetry>): void;
  /** Every intent received, in order. */
  readonly intents: readonly EngineIntent[];
  /** Stop reporting: what a suspended process looks like from JS. */
  suspend(): void;
  /** Stop every timer. Always call this in test teardown. */
  dispose(): void;
};

/** 12:34 on air: the elapsed clock shows every kind of digit. */
const ON_AIR_MS = 754_000;
const CONNECT_MS = 1000;
/**
 * F-P5-10: after our own reopen the camera gets a full 3 s stall window, and
 * native is not LIVE until a real frame advances (F-P5-6). The fake's first
 * frame lands at the end of it: the longest the operator waits.
 */
const REOPEN_FIRST_FRAME_MS = 3000;
const REPORT_MS = 1000;

export const IDLE_TELEMETRY: Telemetry = {
  bitrateKbps: null,
  targetBitrateKbps: null,
  audioLevel: 0,
  cameraReady: false,
  networkReachable: false,
  encodedVideoFps: null,
  audioPacketsPerSecond: null,
  srt: null,
  delivery: 'unknown',
  deliveredLagMs: null,
  deliveryCheckedAtMs: null,
  dataUsedBytes: 0,
  charging: null,
  batteryPercent: null,
  drainPctPerHour: null,
  thermalStatus: null,
  thermalHeadroom: null,
  captureTimestampMs: null,
  shed: null,
  heartbeat: { lastSentAtEpochMs: null, lastResult: null, consecutiveFailures: 0, failures: 0 },
};

/**
 * Camera up, sound above the floor, network validated: every chip green.
 * No encoded rates yet: plan B reads them from the on-air stall watchdog, so
 * native reports null until the session is on air.
 */
const ARMED: Telemetry = {
  ...IDLE_TELEMETRY,
  audioLevel: 0.42,
  cameraReady: true,
  networkReachable: true,
  charging: false,
  batteryPercent: 74,
  thermalStatus: 'none',
  thermalHeadroom: 0.68,
};

/** Fixed numbers, so UI tests can assert them; four- and five-digit values exercise tabular figures. */
function onAir(now: number): Telemetry {
  return {
    ...ARMED,
    bitrateKbps: 2840,
    targetBitrateKbps: 3000,
    encodedVideoFps: 30,
    audioPacketsPerSecond: 47,
    srt: { sent: 120_000, retransmitted: 240, dropped: 3, rttMs: 48 },
    delivery: 'ok',
    deliveredLagMs: 9200,
    deliveryCheckedAtMs: now - 1500,
    dataUsedBytes: 312_000_000,
    drainPctPerHour: 18,
    captureTimestampMs: now,
    heartbeat: {
      lastSentAtEpochMs: now - 4000,
      lastResult: 'ok',
      consecutiveFailures: 0,
      failures: 0,
    },
  };
}

/**
 * Reconnecting: native is back in its connect phase, so nothing on air is
 * measured (plan B's projection reads these from the on-air phase only).
 * Delivery is unknown, so there is no delivered lag either.
 */
function reconnectingTelemetry(now: number): Telemetry {
  return {
    ...onAir(now),
    bitrateKbps: null,
    targetBitrateKbps: null,
    encodedVideoFps: null,
    audioPacketsPerSecond: null,
    srt: null,
    delivery: 'unknown',
    deliveredLagMs: null,
  };
}

/** The encoded rates while the stall watchdog holds or has just rebaselined: no reading. */
const noEncodedRates = (telemetry: Telemetry): Telemetry => ({
  ...telemetry,
  encodedVideoFps: null,
  audioPacketsPerSecond: null,
});

type Scene = {
  readonly state: SessionState;
  readonly telemetry: Telemetry;
  /** When the state itself carries no `sinceEpochMs`, the session's time on air still counts. */
  readonly onAirSince?: number;
  /** A snapshot native reports by itself a moment later. */
  readonly then?: { readonly afterMs: number; readonly state: SessionState };
};

const publishing = (transport: Transport, since: number): SessionState => ({
  kind: 'publishing',
  transport,
  sinceEpochMs: since,
});
const degraded = (transport: Transport, reason: DegradeReason, since: number): SessionState => ({
  kind: 'degraded',
  transport,
  reason,
  sinceEpochMs: since,
});
const reconnecting = (cause: ReconnectCause, since: number): SessionState => ({
  kind: 'reconnecting',
  cause,
  holdRemainingSeconds: 38,
  holdWindowSeconds: 183,
  sinceEpochMs: since,
});
const ended = (reason: EndReason, durationMs: number | null): SessionState => ({
  kind: 'ended',
  reason,
  durationMs,
});

/** Spec §6's states. A table, exempt from the line count (AGENTS §12). */
function sceneOf(name: FakeScene, now: number): Scene {
  const since = now - ON_AIR_MS;
  const live = onAir(now);
  switch (name) {
    case 'armed-not-ready':
      return { state: { kind: 'armed' }, telemetry: { ...ARMED, audioLevel: 0.01 } };
    case 'armed-ready':
      return { state: { kind: 'armed' }, telemetry: ARMED };
    case 'connecting':
      return { state: { kind: 'connecting', transport: 'srt' }, telemetry: ARMED };
    case 'live':
      return { state: publishing('srt', since), telemetry: live };
    case 'fell-back':
      return {
        state: degraded('rtmps', 'fell-back-to-rtmps', since),
        telemetry: { ...live, srt: null },
      };
    case 'holding':
      return { state: reconnecting('uplink-lost', since), telemetry: reconnectingTelemetry(now) };
    case 'stalled':
      return { state: reconnecting('video-stalled', since), telemetry: reconnectingTelemetry(now) };
    case 'restarting':
      return { state: reconnecting('not-delivered', since), telemetry: reconnectingTelemetry(now) };
    case 'not-delivered':
      return {
        state: degraded('srt', 'not-delivered', since),
        telemetry: { ...live, delivery: 'stalled', deliveredLagMs: 21_000 },
      };
    case 'camera-taken':
      return {
        state: degraded('srt', 'camera-taken', since),
        telemetry: noEncodedRates({ ...live, cameraReady: false }),
      };
    case 'camera-reopened':
      // Our camera is back, but native is not LIVE until a real frame advances.
      return {
        state: { kind: 'connecting', transport: 'srt' },
        telemetry: noEncodedRates(live),
        onAirSince: since,
        then: { afterMs: REOPEN_FIRST_FRAME_MS, state: publishing('srt', since) },
      };
    case 'mic-silenced':
      return {
        state: degraded('srt', 'mic-silenced', since),
        telemetry: { ...live, audioLevel: 0 },
      };
    case 'stopped':
      return { state: ended('operator-stopped', ON_AIR_MS), telemetry: IDLE_TELEMETRY };
    case 'stopped-by-organiser':
      return { state: ended('stopped-by-organiser', ON_AIR_MS), telemetry: IDLE_TELEMETRY };
    case 'fatal':
      return { state: ended('fatal-error', ON_AIR_MS), telemetry: IDLE_TELEMETRY };
    case 'shed':
      return {
        state: publishing('srt', since),
        telemetry: {
          ...live,
          shed: 'overlay-preview',
          thermalStatus: 'severe',
          thermalHeadroom: 0.12,
        },
      };
  }
}

function telemetryFor(state: SessionState, now: number): Telemetry {
  switch (state.kind) {
    case 'idle':
    case 'ended':
      return IDLE_TELEMETRY;
    case 'armed':
    case 'connecting':
      return ARMED;
    case 'reconnecting':
      return reconnectingTelemetry(now);
    default:
      return onAir(now);
  }
}

const sinceOf = (state: SessionState): number | null =>
  'sinceEpochMs' in state ? state.sinceEpochMs : null;

export function createFakeCaptureEngine(now: () => number = Date.now): FakeCaptureEngine {
  let snapshot: EngineSnapshot = {
    state: { kind: 'idle' },
    telemetry: IDLE_TELEMETRY,
    descriptor: null,
    reportedAtMs: now(),
    survivesBackground: false,
  };
  let primary: Transport = 'srt';
  /**
   * Plan B's `liveSinceEpochMs`, for a scene whose state carries no
   * `sinceEpochMs` (a camera reopen): a stop there still counts time on air.
   */
  let onAirSince: number | null = null;
  const intents: EngineIntent[] = [];
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | null = null;
  let report: ReturnType<typeof setInterval> | null = null;

  const publish = (next: Partial<EngineSnapshot>): void => {
    snapshot = { ...snapshot, ...next, reportedAtMs: now() };
    for (const listener of listeners) listener();
  };
  const show = (state: SessionState, telemetry: Telemetry = telemetryFor(state, now())) =>
    publish({ state, telemetry });
  const cancelPending = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
  };
  /** Native reporting a new state by itself, `afterMs` from now. */
  const later = (afterMs: number, next: () => SessionState): void => {
    cancelPending();
    pending = setTimeout(() => {
      pending = null;
      show(next());
    }, afterMs);
  };

  const arm = (descriptor: SessionDescriptor, transport: Transport): void => {
    if (snapshot.state.kind !== 'idle') return;
    primary = transport;
    onAirSince = null;
    publish({ state: { kind: 'armed' }, telemetry: ARMED, descriptor });
  };
  const start = (): void => {
    if (snapshot.state.kind !== 'armed') return;
    show({ kind: 'connecting', transport: primary });
    later(CONNECT_MS, () => publishing(primary, now()));
  };
  const stop = (): void => {
    const { kind } = snapshot.state;
    if (kind === 'idle' || kind === 'ended') return;
    cancelPending();
    const since = sinceOf(snapshot.state) ?? onAirSince;
    show(ended('operator-stopped', since === null ? null : now() - since));
  };
  const reset = (): void => {
    cancelPending();
    publish({ state: { kind: 'idle' }, telemetry: IDLE_TELEMETRY, descriptor: null });
  };
  const play = (scene: Scene): void => {
    cancelPending();
    onAirSince = scene.onAirSince ?? null;
    show(scene.state, scene.telemetry);
    const { then } = scene;
    if (then !== undefined) later(then.afterMs, () => then.state);
  };

  const send = (intent: EngineIntent): void => {
    intents.push(intent);
    switch (intent.kind) {
      case 'arm':
        return arm(intent.session.descriptor, intent.session.primary.transport);
      case 'start':
        return start();
      case 'stop':
        return stop();
      case 'reset':
        return reset();
      case 'switchCamera':
        return;
    }
  };

  const stopReporting = (): void => {
    if (report !== null) clearInterval(report);
    report = null;
  };
  // The heartbeat contract: a report at least once a second, changed or not.
  report = setInterval(() => publish({}), REPORT_MS);

  return {
    send,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => snapshot,
    intents,
    scene: (name) => play(sceneOf(name, now())),
    forceState: (state) => {
      cancelPending();
      show(state);
    },
    patch: (telemetry) => publish({ telemetry: { ...snapshot.telemetry, ...telemetry } }),
    // A suspended process reports nothing at all, a pending connect included.
    suspend: () => {
      cancelPending();
      stopReporting();
    },
    dispose: () => {
      cancelPending();
      stopReporting();
    },
  };
}
