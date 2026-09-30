import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import {
  createFakeCaptureEngine,
  FAKE_SCENES,
  IDLE_TELEMETRY,
  type FakeCaptureEngine,
  type FakeScene,
} from './FakeCaptureEngine';
import { streamSession } from '../../../test/fixtures/session';
import { FIXTURE_SECRETS } from '../../../test/fixtures/wire';

const NOW = Date.parse('2026-10-03T13:00:00Z');
/** 12:34 on air, the fake's scenes' fixed time on air. */
const ON_AIR_MS = 754_000;
const session = streamSession();
const heartbeat = { url: session.descriptor.heartbeatUrl, token: session.token };

let clock = NOW;
let engine: FakeCaptureEngine;

beforeEach(() => {
  vi.useFakeTimers();
  clock = NOW;
  engine = createFakeCaptureEngine(() => clock);
});
afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

const state = () => engine.getSnapshot().state;
const telemetry = () => engine.getSnapshot().telemetry;
/** Moves the fake's clock and its timers together, as the phone's would. */
const wait = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

describe('the fake engine (spec §2: scripted snapshots, no state machine of its own)', () => {
  it('starts idle, knowing no session', () => {
    expect(state()).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().descriptor).toBeNull();
  });

  it('arms with the session’s descriptor and a ready pre-flight', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    expect(state()).toEqual({ kind: 'armed' });
    expect(engine.getSnapshot().descriptor).toBe(session.descriptor);
    const { cameraReady, networkReachable, audioLevel } = telemetry();
    expect({ cameraReady, networkReachable, floor: audioLevel >= AUDIO_FLOOR }).toEqual({
      cameraReady: true,
      networkReachable: true,
      floor: true,
    });
  });

  it('ignores a second arm while armed: the first session stays (a double scan)', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({
      kind: 'arm',
      session: streamSession({ label: 'Other XI v Else CC' }),
      heartbeat,
    });
    expect(engine.getSnapshot().descriptor).toBe(session.descriptor);
  });

  it('never reports a secret back up, armed or on air (D8)', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    const armed = JSON.stringify(engine.getSnapshot());
    engine.send({ kind: 'start' });
    wait(1000);
    const onAir = JSON.stringify(engine.getSnapshot());
    for (const secret of FIXTURE_SECRETS) {
      expect({ secret, armed: armed.includes(secret), onAir: onAir.includes(secret) }).toEqual({
        secret,
        armed: false,
        onAir: false,
      });
    }
  });

  it('connects on start, then publishes a second later on the primary transport', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'connecting', transport: 'srt' });
    wait(1000);
    expect(state()).toEqual({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW + 1000 });
  });

  it('connects on the code’s preferred transport when that is RTMPS', () => {
    const rtmpsFirst = streamSession({}, { preferred: 'rtmps' });
    engine.send({ kind: 'arm', session: rtmpsFirst, heartbeat });
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'connecting', transport: 'rtmps' });
  });

  it('ignores start unless armed, and a second start while connecting', () => {
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'idle' });
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    wait(500);
    engine.send({ kind: 'start' });
    wait(500);
    expect(state()).toEqual({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW + 1000 });
  });

  it('stops with the time on air, and ignores a stop with nothing running', () => {
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'idle' });
    engine.scene('live');
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: ON_AIR_MS });
    // An ended session reads nothing: no ready camera, no moving meter.
    expect(telemetry()).toEqual(IDLE_TELEMETRY);
  });

  it('keeps the first ending when Stop arrives twice (a double hold)', () => {
    engine.scene('live');
    engine.send({ kind: 'stop' });
    wait(5000);
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: ON_AIR_MS });
  });

  it('ends with no time on air when stopped while connecting, and never publishes after', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.send({ kind: 'stop' });
    wait(5000);
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: null });
  });

  it('resets to idle and forgets the descriptor', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'reset' });
    expect(state()).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().descriptor).toBeNull();
  });

  it('stays idle after a reset while connecting', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.send({ kind: 'reset' });
    wait(5000);
    expect(state()).toEqual({ kind: 'idle' });
  });

  it('keeps every intent it was sent, in order', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'switchCamera' });
    expect(engine.intents.map((intent) => intent.kind)).toEqual(['arm', 'switchCamera']);
  });

  it('reports at least once a second, and stops when suspended', () => {
    const first = engine.getSnapshot().reportedAtMs;
    wait(1000);
    expect(engine.getSnapshot().reportedAtMs).toBe(first + 1000);
    engine.suspend();
    wait(5000);
    expect(engine.getSnapshot().reportedAtMs).toBe(first + 1000);
  });

  it('reports nothing at all once suspended, not even a pending connect', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.suspend();
    wait(5000);
    expect(state()).toEqual({ kind: 'connecting', transport: 'srt' });
    expect(engine.getSnapshot().reportedAtMs).toBe(NOW);
  });

  it('lets a forced state win over a pending connect (the dev panel’s Fail)', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null });
    wait(5000);
    expect(state()).toEqual({ kind: 'ended', reason: 'fatal-error', durationMs: null });
  });

  it('lets a scene win over a pending connect', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.scene('fell-back');
    wait(5000);
    expect(state()).toMatchObject({ kind: 'degraded', reason: 'fell-back-to-rtmps' });
  });

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = engine.subscribe(() => {
      calls += 1;
    });
    engine.send({ kind: 'arm', session, heartbeat });
    expect(calls).toBe(1);
    unsubscribe();
    engine.send({ kind: 'start' });
    expect(calls).toBe(1);
  });

  it('pairs a forced state with telemetry that describes it', () => {
    engine.forceState({
      kind: 'reconnecting',
      cause: 'uplink-lost',
      holdRemainingSeconds: 9,
      holdWindowSeconds: 183,
      sinceEpochMs: NOW - 60_000,
    });
    // "RECONNECTING · 2840k" would teach the operator to distrust the HUD.
    expect({ bitrate: telemetry().bitrateKbps, delivery: telemetry().delivery }).toEqual({
      bitrate: null,
      delivery: 'unknown',
    });
    engine.forceState({ kind: 'publishing', transport: 'rtmps', sinceEpochMs: NOW - 60_000 });
    expect(telemetry().bitrateKbps).toBe(2840);
  });
});

describe('scenes: every state spec §6 lists', () => {
  /** A row per scene: the compiler refuses a scene without one. */
  const EXPECTED: Readonly<Record<FakeScene, object>> = {
    'armed-not-ready': { kind: 'armed' },
    'armed-ready': { kind: 'armed' },
    connecting: { kind: 'connecting', transport: 'srt' },
    live: { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW - ON_AIR_MS },
    'fell-back': { kind: 'degraded', transport: 'rtmps', reason: 'fell-back-to-rtmps' },
    holding: {
      kind: 'reconnecting',
      cause: 'uplink-lost',
      holdRemainingSeconds: 38,
      holdWindowSeconds: 183,
    },
    stalled: { kind: 'reconnecting', cause: 'video-stalled', holdRemainingSeconds: 38 },
    restarting: { kind: 'reconnecting', cause: 'not-delivered', holdRemainingSeconds: 38 },
    'not-delivered': { kind: 'degraded', reason: 'not-delivered' },
    'camera-taken': { kind: 'degraded', reason: 'camera-taken' },
    'camera-reopened': {
      kind: 'degraded',
      transport: 'srt',
      reason: 'camera-taken',
      sinceEpochMs: NOW - ON_AIR_MS,
    },
    'mic-silenced': { kind: 'degraded', reason: 'mic-silenced' },
    stopped: { kind: 'ended', reason: 'operator-stopped', durationMs: ON_AIR_MS },
    'stopped-by-organiser': {
      kind: 'ended',
      reason: 'stopped-by-organiser',
      durationMs: ON_AIR_MS,
    },
    fatal: { kind: 'ended', reason: 'fatal-error' },
    shed: { kind: 'publishing' },
  };

  it('lists every scene once, for the dev controls', () => {
    expect([...FAKE_SCENES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(FAKE_SCENES)('%s', (scene) => {
    engine.scene(scene);
    expect(state()).toMatchObject(EXPECTED[scene]);
  });

  it('puts armed-not-ready below the audio floor, and shed on the first ladder step', () => {
    engine.scene('armed-not-ready');
    expect(telemetry().audioLevel).toBeLessThan(AUDIO_FLOOR);
    engine.scene('shed');
    expect(telemetry().shed).toBe('overlay-preview');
  });

  it('keeps the descriptor across scenes', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.scene('live');
    expect(engine.getSnapshot().descriptor).toBe(session.descriptor);
  });
});

/**
 * Plan B's engine reports null, not a number, where it has no reading. The
 * fake does the same, so no screen is built against a zero that never comes.
 */
describe('no reading is null, as the Kotlin engine reports it', () => {
  it('reads encoded frames and delivery on air', () => {
    engine.scene('live');
    const { encodedVideoFps, audioPacketsPerSecond, delivery, deliveredLagMs } = telemetry();
    expect({ encodedVideoFps, audioPacketsPerSecond, delivery, deliveredLagMs }).toEqual({
      encodedVideoFps: 30,
      audioPacketsPerSecond: 47,
      delivery: 'ok',
      deliveredLagMs: 9200,
    });
  });

  it('has no encoded-frame readings before going on air', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    expect([telemetry().encodedVideoFps, telemetry().audioPacketsPerSecond]).toEqual([null, null]);
  });

  it('has no encoded-frame readings while the camera is taken (the watchdog holds)', () => {
    engine.scene('camera-taken');
    expect(telemetry().encodedVideoFps).toBeNull();
    expect(telemetry().audioPacketsPerSecond).toBeNull();
  });

  it.each<FakeScene>(['holding', 'stalled', 'restarting'])(
    'has no delivered lag while %s: delivery is unknown',
    (scene) => {
      engine.scene(scene);
      expect({ delivery: telemetry().delivery, lag: telemetry().deliveredLagMs }).toEqual({
        delivery: 'unknown',
        lag: null,
      });
    },
  );
});

/**
 * Plan B's `Projection.onAir`: a session whose camera is not our own, with no
 * outage, is held. It reads degraded camera-taken with its time on air, and
 * never connecting, until the reopened camera's first frame.
 */
describe('after our own camera reopen (F-P5-10; plan B holds it degraded)', () => {
  const HELD = {
    kind: 'degraded',
    transport: 'srt',
    reason: 'camera-taken',
    sinceEpochMs: NOW - ON_AIR_MS,
  };

  it('holds degraded camera-taken until the first frame, then publishes the same broadcast', () => {
    const kinds: string[] = [];
    engine.subscribe(() => kinds.push(state().kind));
    engine.scene('camera-reopened');
    wait(2999);
    expect(state()).toEqual(HELD);
    expect(telemetry().encodedVideoFps).toBeNull();
    wait(1);
    expect(state()).toEqual({
      kind: 'publishing',
      transport: 'srt',
      sinceEpochMs: NOW - ON_AIR_MS,
    });
    expect(telemetry().encodedVideoFps).toBe(30);
    expect(kinds).not.toContain('connecting');
  });

  it('counts the time on air when stopped before the first frame', () => {
    engine.scene('camera-reopened');
    wait(1000);
    engine.send({ kind: 'stop' });
    wait(5000);
    expect(state()).toEqual({
      kind: 'ended',
      reason: 'operator-stopped',
      durationMs: ON_AIR_MS + 1000,
    });
  });
});

/**
 * The fake keeps no time on air of its own: a stop reads it from the state
 * native reports now. Nothing from a session before a reset or a forced state
 * reaches the next ending.
 */
describe('no stale time on air (M4)', () => {
  it('forgets it across a reset: the next session, stopped while connecting, has none', () => {
    engine.scene('camera-reopened');
    engine.send({ kind: 'reset' });
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: null });
  });

  it('forgets it when a state is forced: a forced connect then stopped ends with none', () => {
    engine.scene('camera-reopened');
    engine.forceState({ kind: 'connecting', transport: 'srt' });
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: null });
  });
});
