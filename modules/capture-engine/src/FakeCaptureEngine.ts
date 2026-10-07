import { tokenTag } from '@/domain/credentials/tokenTag';
import {
  firstNotReady,
  type BroadcastInfo,
  type Cause,
  type LastEnd,
  type PairingInfo,
  type Readiness,
  type Transport,
  type UnpairReason,
} from '@/domain/session/Pairing';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type {
  CameraState,
  CaptureEnginePort,
  EngineIntent,
  EngineSnapshot,
  PairIntent,
  Telemetry,
} from './CaptureEnginePort';
import type { ServerSays } from './contract/serverSays';
import { IDLE_TELEMETRY } from './unreported';

/**
 * The fake is built first, on purpose (AGENTS §10), and it holds no state
 * machine of its own beyond the engine contract's (`test/engineContract.ts`):
 * it plays named snapshots, and intents and the server's words move it only
 * the steps a laptop needs. Every other state is one `scene()` away.
 */
export type FakeScene =
  | 'pairing'
  | 'paired-ready'
  | 'paired-not-ready'
  | 'paired-not-held'
  | 'paired-refused'
  | 'paired-after-organiser-stop'
  | 'arming-retrying'
  | 'armed-not-ready'
  | 'connecting'
  | 'live'
  | 'fell-back'
  | 'holding'
  | 'stalled'
  | 'restarting'
  | 'not-delivered'
  | 'camera-taken'
  | 'camera-reopened'
  | 'camera-switching'
  | 'mic-silenced'
  | 'stopped'
  | 'fatal'
  | 'shed'
  | 'unpaired-replaced';

export const FAKE_SCENES: readonly FakeScene[] = [
  'pairing',
  'paired-ready',
  'paired-not-ready',
  'paired-not-held',
  'paired-refused',
  'paired-after-organiser-stop',
  'arming-retrying',
  'armed-not-ready',
  'connecting',
  'live',
  'fell-back',
  'holding',
  'stalled',
  'restarting',
  'not-delivered',
  'camera-taken',
  'camera-reopened',
  'camera-switching',
  'mic-silenced',
  'stopped',
  'fatal',
  'shed',
  'unpaired-replaced',
];

/** How the permission dialog answers a `pair`. */
export type PermissionAnswer = 'grant' | 'hold' | 'refuse';

export type FakeCaptureEngine = CaptureEnginePort & {
  /** Jump to a named state from spec §6's list, with telemetry and readiness to match. */
  scene(name: FakeScene): void;
  /** Jump to any state; telemetry follows its kind. */
  forceState(state: SessionState): void;
  /** Change telemetry alone, as the next 1 Hz report would. */
  patch(telemetry: Partial<Telemetry>): void;
  /** Change whose camera it is alone, as native reports a take or a reopen under any state. */
  setCamera(camera: CameraState | null): void;
  /** The server's next word, applied at once: the fake has no beat cadence. */
  hear(says: ServerSays): void;
  /** Native's readiness (A11). A Go live waiting in Armed goes on air once every check passes. */
  setReady(ready: Partial<Readiness>): void;
  /** How the permission dialog answers the next `pair`, or the one held open now. */
  setPermissions(answer: PermissionAnswer): void;
  /** The waiting fields this pairing, and every later one, reports. */
  setPairing(pairing: Partial<PairingInfo>): void;
  /**
   * The kind of each intent received, oldest first, at most INTENT_LOG_CAP.
   * Only the kind (M5): a `pair` carries the code's token. Tests that need
   * whole intents record them in the test factory (test/fakePorts.ts).
   */
  readonly intentKinds: readonly EngineIntent['kind'][];
  /** Stop reporting: what a suspended process looks like from JS. */
  suspend(): void;
  /**
   * CD18: whether capture would survive the background, as native reports it:
   * false is Android's foreground service failing to start. The next state
   * the fake reports sets it again from its kind.
   */
  setSurvivesBackground(on: boolean): void;
  /** Stop every timer. Always call this in test teardown. */
  dispose(): void;
};

/** 12:34 on air: the elapsed clock shows every kind of digit. */
const ON_AIR_MS = 754_000;
const CONNECT_MS = 1000;
/**
 * F-P5-10: after our own reopen the camera gets a full 3 s stall window for
 * its first frame. The fake's first frame lands at the end of it: the longest
 * the operator waits. A switch's new camera gets the same window (ruling 14).
 */
const REOPEN_FIRST_FRAME_MS = 3000;
const REPORT_MS = 1000;
/** M5: a three-hour match sends a handful of intents; the cap only bounds a runaway. */
export const INTENT_LOG_CAP = 100;

/**
 * Camera up, sound above the floor: the meter sounds. No encoded rates yet:
 * plan B reads them from the on-air stall watchdog, so native reports null
 * until the session is on air. Readiness is native's `ready`, not telemetry.
 */
const ARMED: Telemetry = {
  ...IDLE_TELEMETRY,
  audioLevel: 0.42,
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

const NOT_READY: Readiness = { camera: false, sound: false, network: false, held: false };
const READY: Readiness = { camera: true, sound: true, network: true, held: true };
/** Native's camera check fails while the camera is not our own (Readiness.kt). */
const CAMERA_NOT_OURS: Readiness = { ...READY, camera: false };

/**
 * Made-up waiting fields, the fake's stand-in for the claim's answer. Schema-valid
 * (capture-descriptor.v1); the tag is the fixture token's (`token-tag-vectors.json`).
 */
export const FAKE_PAIRING: PairingInfo = {
  code: 'fx42hmnp7k2q',
  slot: 1,
  tokenTag: 'b24bb97b',
  automatic: true,
  label: 'Seazn XI v Fake CC',
  venueTimezone: 'Europe/London',
  scheduledStart: null,
  autoAllowed: true,
  destinationName: 'YouTube · Fake CC',
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q',
  pollSeconds: 60,
};

const broadcastFor = (pairing: PairingInfo, cause: Cause): BroadcastInfo => ({
  sid: 'fake-sid-1',
  cause,
  playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
  overlayUrl: pairing.overlayUrl,
  label: pairing.label,
  holdWindowSeconds: { srt: 183, rtmps: 183 },
  maxDurationMinutes: 300,
  scoreUpdates: 'realtime',
  srtOffered: true,
});

/** The phases that hold a broadcast: `stop` ends them, and `pair` and `unpair` leave them alone. */
const BROADCAST: ReadonlySet<SessionState['kind']> = new Set([
  'arming',
  'armed',
  'connecting',
  'publishing',
  'degraded',
  'reconnecting',
]);

const AT_REST = {
  pairing: null,
  broadcast: null,
  refusal: null,
  lastEnd: null,
  unpaired: null,
  codeEndedPending: false,
} as const;

const IDLE: SessionState = { kind: 'idle' };

type Scene = {
  readonly state: SessionState;
  readonly telemetry: Telemetry;
  /** Whose camera, when not what the state's kind implies (`cameraFor`). */
  readonly camera?: CameraState;
  /** Native's readiness; every check passes when absent. */
  readonly ready?: Readiness;
  readonly extra?: Partial<Pick<EngineSnapshot, 'refusal' | 'lastEnd'>>;
  /** A snapshot native reports by itself a moment later: our camera's first frame, ready again. */
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
    case 'pairing':
      return {
        state: { kind: 'pairing' },
        telemetry: IDLE_TELEMETRY,
        ready: { ...NOT_READY, network: true },
      };
    case 'paired-ready':
      return { state: { kind: 'paired' }, telemetry: ARMED };
    case 'paired-not-ready':
      // The mic is not available (spec §4). Level 0, so no test can read a level as the cause.
      return {
        state: { kind: 'paired' },
        telemetry: { ...ARMED, audioLevel: 0 },
        ready: { ...READY, sound: false },
      };
    case 'paired-not-held':
      return { state: { kind: 'paired' }, telemetry: ARMED, ready: { ...READY, held: false } };
    case 'paired-refused':
      return { state: { kind: 'paired' }, telemetry: ARMED, extra: { refusal: 'no_credit' } };
    case 'paired-after-organiser-stop':
      return {
        state: { kind: 'paired' },
        telemetry: ARMED,
        extra: { lastEnd: 'stopped-by-organiser' },
      };
    case 'arming-retrying':
      return { state: { kind: 'arming', cause: 'automatic', retrying: true }, telemetry: ARMED };
    case 'armed-not-ready':
      return {
        state: { kind: 'armed', cause: 'organiser', notReady: 'held' },
        telemetry: ARMED,
        ready: { ...READY, held: false },
      };
    case 'unpaired-replaced':
      return { state: IDLE, telemetry: IDLE_TELEMETRY, ready: NOT_READY };
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
        telemetry: noEncodedRates(live),
        camera: 'taken',
        ready: CAMERA_NOT_OURS,
      };
    case 'camera-reopened':
      // Plan B holds the session until our reopened camera's first frame: it
      // reads degraded camera-taken with its time on air, never connecting
      // (Projection.onAir). Until that frame the camera is producing none, so
      // native's camera check fails. Clean again once a frame advances.
      return {
        state: degraded('srt', 'camera-taken', since),
        telemetry: noEncodedRates(live),
        camera: 'reopening',
        ready: CAMERA_NOT_OURS,
        then: { afterMs: REOPEN_FIRST_FRAME_MS, state: publishing('srt', since) },
      };
    case 'camera-switching':
      // Plan B holds LIVE through the operator's switch until the new
      // camera's first frame (`SWITCHING`: not shown taken, so no degrade).
      return {
        state: publishing('srt', since),
        telemetry: noEncodedRates(live),
        camera: 'switching',
        ready: CAMERA_NOT_OURS,
        then: { afterMs: REOPEN_FIRST_FRAME_MS, state: publishing('srt', since) },
      };
    case 'mic-silenced':
      // Spec §4: a call takes the mic, so native reads it not available (BridgeCore's systemSilenced).
      return {
        state: degraded('srt', 'mic-silenced', since),
        telemetry: { ...live, audioLevel: 0 },
        ready: { ...READY, sound: false },
      };
    case 'stopped':
      return {
        state: ended('operator-stopped', ON_AIR_MS),
        telemetry: IDLE_TELEMETRY,
        ready: CAMERA_NOT_OURS,
      };
    case 'fatal':
      return {
        state: ended('fatal-error', ON_AIR_MS),
        telemetry: IDLE_TELEMETRY,
        ready: CAMERA_NOT_OURS,
      };
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
    case 'pairing':
    case 'ended':
      return IDLE_TELEMETRY;
    case 'paired':
    case 'arming':
    case 'armed':
    case 'connecting':
      return ARMED;
    case 'reconnecting':
      return reconnectingTelemetry(now);
    default:
      return onAir(now);
  }
}

/**
 * Plan B's `Snapshot.camera`: ours from the pair on (the permission dialog's
 * Pairing included, as native reports it), none at rest or once ended.
 */
const cameraFor = (state: SessionState): CameraState | null =>
  state.kind === 'idle' || state.kind === 'ended' ? null : 'own';

/**
 * CD18: Android runs the foreground service from the pair on (amendment §2, the
 * paired notification), so capture survives the background from Pairing until
 * Idle or Ended.
 */
const survivesFor = (state: SessionState): boolean =>
  state.kind !== 'idle' && state.kind !== 'ended';

const sinceOf = (state: SessionState): number | null =>
  'sinceEpochMs' in state ? state.sinceEpochMs : null;

type Name = Pick<PairingInfo, 'code' | 'slot' | 'tokenTag'>;

const sameName = (pairing: PairingInfo | null, name: Name) =>
  pairing !== null &&
  pairing.code === name.code &&
  pairing.slot === name.slot &&
  pairing.tokenTag === name.tokenTag;

/**
 * The fake's state table, written as one closure so its timers and listeners
 * have one owner (AGENTS §12's exemption for transition tables). It keeps the
 * engine contract (`test/engineContract.ts`) and native's answer table where a
 * laptop needs it (Pairings.kt's `Verdicts`): a word that does not fit the
 * phase does nothing.
 */
export function createFakeCaptureEngine(now: () => number = Date.now): FakeCaptureEngine {
  let snapshot: EngineSnapshot = {
    ...AT_REST,
    state: IDLE,
    telemetry: IDLE_TELEMETRY,
    ready: NOT_READY,
    camera: null,
    reportedAtMs: now(),
    survivesBackground: false,
  };
  const primary: Transport = 'srt';
  let permissions: PermissionAnswer = 'grant';
  let waiting: Partial<PairingInfo> = {};
  const intentKinds: EngineIntent['kind'][] = [];
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | null = null;
  let report: ReturnType<typeof setInterval> | null = null;

  const publish = (next: Partial<EngineSnapshot>): void => {
    snapshot = { ...snapshot, ...next, reportedAtMs: now() };
    for (const listener of listeners) listener();
  };
  const show = (state: SessionState, extra: Partial<EngineSnapshot> = {}): void =>
    publish({
      state,
      telemetry: telemetryFor(state, now()),
      camera: cameraFor(state),
      survivesBackground: survivesFor(state),
      ...extra,
    });
  const cancelPending = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
  };
  /**
   * Native reporting a new state by itself, `afterMs` from now. It overwrites
   * `pending` without cancelling it, which is safe only because nothing is ever
   * pending when it runs: `play` and `connect`'s callers cancel or reach it
   * with nothing pending.
   */
  const later = (
    afterMs: number,
    next: () => SessionState,
    extra: Partial<EngineSnapshot> = {},
  ) => {
    pending = setTimeout(() => {
      pending = null;
      show(next(), extra);
    }, afterMs);
  };
  const atRest = (extra: Partial<EngineSnapshot> = {}): void => {
    cancelPending();
    show(IDLE, { ...AT_REST, ready: NOT_READY, ...extra });
  };

  const paired = (pairing: PairingInfo): void =>
    show({ kind: 'paired' }, { ...AT_REST, pairing, ready: READY });

  /** Native leaves a pairing the operator did not end, and says which and why. */
  const unpaired = (reason: UnpairReason): void => {
    const { pairing } = snapshot;
    if (pairing === null) return;
    const { code, slot, tokenTag: tag } = pairing;
    atRest({ unpaired: { reason, code, slot, tokenTag: tag } });
  };

  /** Another code over a pairing pairs it (native unpairs first); the same code changes nothing. */
  const pair = (intent: PairIntent): void => {
    const { kind } = snapshot.state;
    if (BROADCAST.has(kind) || kind === 'ended') return;
    const name = { code: intent.code, slot: intent.slot, tokenTag: tokenTag(intent.token) };
    if ((kind === 'pairing' || kind === 'paired') && sameName(snapshot.pairing, name)) return;
    const pairing: PairingInfo = {
      ...FAKE_PAIRING,
      ...waiting,
      ...name,
      venueTimezone: intent.venueTimezone,
      automatic: intent.automatic,
    };
    if (permissions === 'hold') {
      return show({ kind: 'pairing' }, { ...AT_REST, pairing, ready: NOT_READY });
    }
    if (permissions === 'refuse') {
      // Native's order (review C5, re-review round 1): Pairing, naming no unpair, then the answer.
      show({ kind: 'pairing' }, { ...AT_REST, pairing, ready: NOT_READY });
      return atRest({ unpaired: { reason: 'permissions', ...name } });
    }
    paired(pairing);
  };

  const connect = (broadcast: BroadcastInfo): void => {
    show({ kind: 'connecting', transport: primary }, { broadcast, refusal: null, lastEnd: null });
    later(CONNECT_MS, () => publishing(primary, now()));
  };

  /** A start, remote or held: Armed waits for readiness, as native's gate does (A11). */
  const goLive = (cause: Cause): void => {
    const broadcast = snapshot.broadcast ?? broadcastFor(snapshot.pairing ?? FAKE_PAIRING, cause);
    const notReady = firstNotReady(snapshot.ready);
    if (notReady !== null) {
      return show({ kind: 'armed', cause, notReady }, { broadcast, refusal: null, lastEnd: null });
    }
    connect(broadcast);
  };

  /** The operator's hold: only from Paired, and only when ready (Go live is off otherwise). */
  const start = (): void => {
    if (snapshot.state.kind !== 'paired' || firstNotReady(snapshot.ready) !== null) return;
    goLive('operator');
  };

  /**
   * Owner decision 1 (2026-10-05), as native's `SessionMachine.stop`: a broadcast that never went live ends and the
   * pairing stays, Paired with the last end `stopped`, so Go live can be tried again (native beats the stopped sid
   * at once); one that went live, or one held past a 401, ends the pairing.
   */
  const stop = (): void => {
    if (!BROADCAST.has(snapshot.state.kind)) return;
    cancelPending();
    const since = sinceOf(snapshot.state);
    if (since === null && !snapshot.codeEndedPending) {
      return show({ kind: 'paired' }, { broadcast: null, lastEnd: 'stopped' });
    }
    show(ended('operator-stopped', since === null ? null : now() - since), {
      broadcast: null,
      ready: { ...snapshot.ready, camera: false },
    });
  };

  const unpair = (): void => {
    const { kind } = snapshot.state;
    if (kind === 'pairing' || kind === 'paired') atRest();
  };

  // N1: native resets only from Ended (plan B's SessionMachine.kt); so does the fake.
  const reset = (): void => {
    if (snapshot.state.kind === 'ended') atRest();
  };

  /** The broadcast ends without the operator: back to Paired with why, or out on a pending 401. */
  const over = (lastEnd: LastEnd): void => {
    if (!BROADCAST.has(snapshot.state.kind)) return;
    cancelPending();
    if (snapshot.codeEndedPending) return unpaired('code-ended');
    show({ kind: 'paired' }, { broadcast: null, lastEnd });
  };

  /** Native's answer table by phase (Pairings.kt `Verdicts`); Ended and Idle hear nothing. */
  const hear = (says: ServerSays): void => {
    const { kind } = snapshot.state;
    const isPaired = kind === 'paired';
    const held = BROADCAST.has(kind);
    switch (says.word) {
      case 'go-live':
        return isPaired ? goLive(says.cause) : undefined;
      case 'live':
        return isPaired ? goLive('rejoin') : undefined;
      case 'over':
        return over(says.lastEnd);
      case 'refused':
        return isPaired ? publish({ refusal: says.refusal }) : undefined;
      case 'replaced':
        return isPaired || kind === 'pairing' || held ? unpaired('replaced') : undefined;
      case 'taken':
        return isPaired || kind === 'pairing' ? unpaired('taken') : undefined;
      case 'code-ended':
        if (held && kind !== 'arming') return publish({ codeEndedPending: true });
        return isPaired || kind === 'arming' ? unpaired('code-ended') : undefined;
    }
  };

  const setReady = (change: Partial<Readiness>): void => {
    const ready = { ...snapshot.ready, ...change };
    const { state } = snapshot;
    if (state.kind !== 'armed') return publish({ ready });
    const notReady = firstNotReady(ready);
    publish({ ready, state: { ...state, notReady } });
    if (notReady === null && snapshot.broadcast !== null) connect(snapshot.broadcast);
  };

  const setPermissions = (answer: PermissionAnswer): void => {
    permissions = answer;
    if (snapshot.state.kind !== 'pairing' || snapshot.pairing === null || answer === 'hold') return;
    if (answer === 'grant') return paired(snapshot.pairing);
    const { code, slot, tokenTag: tag } = snapshot.pairing;
    atRest({ unpaired: { reason: 'permissions', code, slot, tokenTag: tag } });
  };

  const automatic = (on: boolean): void => {
    const { pairing, state } = snapshot;
    if (pairing !== null && state.kind !== 'ended')
      publish({ pairing: { ...pairing, automatic: on } });
  };

  const play = (scene: Scene): void => {
    cancelPending();
    const held = snapshot.pairing ?? { ...FAKE_PAIRING, ...waiting };
    const resting = scene.state.kind === 'idle';
    // A pairing native left was paired first: on native an unpair is always reached through
    // Pairing, which names none (review C5, re-review round 1).
    if (resting) show({ kind: 'pairing' }, { ...AT_REST, pairing: held, ready: NOT_READY });
    publish({
      ...AT_REST,
      state: scene.state,
      telemetry: scene.telemetry,
      camera: scene.camera ?? cameraFor(scene.state),
      survivesBackground: survivesFor(scene.state),
      ready: scene.ready ?? READY,
      pairing: resting ? null : held,
      broadcast: BROADCAST.has(scene.state.kind)
        ? (snapshot.broadcast ?? broadcastFor(held, 'operator'))
        : null,
      unpaired: resting
        ? { reason: 'replaced', code: held.code, slot: held.slot, tokenTag: held.tokenTag }
        : null,
      ...scene.extra,
    });
    const { then } = scene;
    if (then !== undefined) later(then.afterMs, () => then.state, { ready: READY });
  };

  const send = (intent: EngineIntent): void => {
    intentKinds.push(intent.kind);
    if (intentKinds.length > INTENT_LOG_CAP) intentKinds.shift();
    switch (intent.kind) {
      case 'pair':
        return pair(intent);
      case 'start':
        return start();
      case 'stop':
        return stop();
      case 'unpair':
        return unpair();
      case 'reset':
        return reset();
      case 'setAutomatic':
        return automatic(intent.on);
      case 'setLanguage':
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
    intentKinds,
    scene: (name) => play(sceneOf(name, now())),
    // A forced state wins over a pending connect or first frame.
    forceState: (state) => {
      cancelPending();
      show(state);
    },
    hear,
    setReady,
    setPermissions,
    setPairing: (change) => {
      waiting = { ...waiting, ...change };
      if (snapshot.pairing !== null) publish({ pairing: { ...snapshot.pairing, ...change } });
    },
    patch: (telemetry) => publish({ telemetry: { ...snapshot.telemetry, ...telemetry } }),
    setCamera: (camera) => publish({ camera }),
    setSurvivesBackground: (on) => publish({ survivesBackground: on }),
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
