import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraState, PairIntent } from './CaptureEnginePort';
import { KIT_CODE_A, KIT_CODE_B } from './contract/engineScenarios';
import {
  createFakeCaptureEngine,
  FAKE_SCENES,
  INTENT_LOG_CAP,
  type FakeCaptureEngine,
  type FakeScene,
} from './FakeCaptureEngine';
import { IDLE_TELEMETRY } from './unreported';

const NOW = Date.parse('2026-10-03T13:00:00Z');
/** 12:34 on air, the fake's scenes' fixed time on air. */
const ON_AIR_MS = 754_000;
/** The kit's tokens: the only secrets a pair carries now (A1). */
const SECRETS = [KIT_CODE_A.token, KIT_CODE_B.token];
/** FNV-1a 32 of KIT_CODE_A's token, from an independent FNV-1a outside the code under test. */
const TAG_A = 'd2e14499';

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

const snapshot = () => engine.getSnapshot();
const state = () => snapshot().state;
const telemetry = () => snapshot().telemetry;
/** Moves the fake's clock and its timers together, as the phone's would. */
const wait = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};
const pair = (intent: PairIntent = KIT_CODE_A) => engine.send(intent);
const goLive = () => {
  pair();
  engine.send({ kind: 'start' });
};
/** Owner decision 1 (2026-10-05): only a stop once live ends the pairing; the fake publishes a second after its connect. */
const onAirLive = () => {
  goLive();
  wait(1_000);
  expect(state().kind).toBe('publishing');
};

describe('the fake engine (spec §2: scripted snapshots, no state machine of its own)', () => {
  it('starts idle, knowing no pairing, broadcast or readiness', () => {
    expect(state()).toEqual({ kind: 'idle' });
    const { pairing, broadcast, ready, unpaired, refusal, lastEnd, codeEndedPending } = snapshot();
    expect({ pairing, broadcast, ready, unpaired, refusal, lastEnd, codeEndedPending }).toEqual({
      pairing: null,
      broadcast: null,
      ready: { camera: false, sound: false, network: false, held: false },
      unpaired: null,
      refusal: null,
      lastEnd: null,
      codeEndedPending: false,
    });
  });

  it('pairs with the intent’s name, zone and automatic choice, ready on every check', () => {
    pair({ ...KIT_CODE_A, venueTimezone: 'Asia/Kolkata', automatic: false });
    expect(state()).toEqual({ kind: 'paired' });
    const { pairing, ready } = snapshot();
    expect(pairing).toMatchObject({
      code: 'ka0000000001',
      slot: 1,
      tokenTag: TAG_A,
      venueTimezone: 'Asia/Kolkata',
      automatic: false,
    });
    expect(ready).toEqual({ camera: true, sound: true, network: true, held: true });
  });

  it('never reports a secret back up, paired or on air (D8)', () => {
    pair();
    const paired = JSON.stringify(snapshot());
    engine.send({ kind: 'start' });
    wait(1000);
    const onAir = JSON.stringify(snapshot());
    for (const secret of SECRETS) {
      expect({ secret, paired: paired.includes(secret), onAir: onAir.includes(secret) }).toEqual({
        secret,
        paired: false,
        onAir: false,
      });
    }
  });

  it('connects on start, then publishes a second later on the primary transport', () => {
    goLive();
    expect(state()).toEqual({ kind: 'connecting', transport: 'srt' });
    wait(1000);
    expect(state()).toEqual({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW + 1000 });
  });

  it('ignores start unless paired, and a second start while connecting', () => {
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'idle' });
    goLive();
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
    // An ended session reads nothing: no moving meter, no broadcast.
    expect(telemetry()).toEqual(IDLE_TELEMETRY);
    // A literal, not the fake's own constant: a sounding meter on Ended is a lie (N2).
    expect(telemetry().audioLevel).toBe(0);
    expect(snapshot().broadcast).toBeNull();
  });

  it.each<FakeScene>(['holding', 'stalled', 'restarting'])(
    'counts the time on air when stopped while reconnecting (%s)',
    (scene) => {
      engine.scene(scene);
      wait(1000);
      engine.send({ kind: 'stop' });
      expect(state()).toEqual({
        kind: 'ended',
        reason: 'operator-stopped',
        durationMs: ON_AIR_MS + 1000,
      });
    },
  );

  it('keeps the first ending when Stop arrives twice (a double hold)', () => {
    engine.scene('live');
    engine.send({ kind: 'stop' });
    wait(5000);
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: ON_AIR_MS });
  });

  // Owner decision 1 (2026-10-05), as native: never live, the broadcast ends and the pairing stays.
  it('returns to paired, stopped, when stopped while connecting, and never publishes after', () => {
    goLive();
    engine.send({ kind: 'stop' });
    wait(5000);
    expect(state()).toEqual({ kind: 'paired' });
    expect([snapshot().lastEnd, snapshot().broadcast]).toEqual(['stopped', null]);
  });

  it('ends a broadcast held past a 401 when stopped never live, as native does (the 401 deferral)', () => {
    goLive();
    engine.hear({ word: 'code-ended' });
    expect(snapshot().codeEndedPending).toBe(true);
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: null });
  });

  // N2: the token's tag, never the token (D8); the kit pins it too.
  it('names the pairing by the tag of its token, keeps it once ended, and forgets it on reset', () => {
    onAirLive();
    engine.send({ kind: 'stop' });
    expect(snapshot().pairing?.tokenTag).toBe(TAG_A);
    engine.send({ kind: 'reset' });
    expect(snapshot().pairing).toBeNull();
  });

  it('ignores a reset while connecting; stopped (never live, so paired) and reset, no pending connect revives it', () => {
    goLive();
    engine.send({ kind: 'reset' });
    expect(state()).toEqual({ kind: 'connecting', transport: 'srt' });
    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });
    wait(5000);
    expect(state()).toEqual({ kind: 'paired' });
  });

  // M5 (final review): the intent log must never hold a pair's token.
  it('keeps the kind of each intent, in order, and never a token', () => {
    pair();
    engine.send({ kind: 'switchCamera' });
    engine.send({ kind: 'setLanguage', language: 'fr' });
    expect(engine.intentKinds).toEqual(['pair', 'switchCamera', 'setLanguage']);
    const kept = JSON.stringify(engine);
    for (const secret of SECRETS) expect(kept).not.toContain(secret);
    const reported = JSON.stringify(snapshot());
    expect(reported).toContain('"tokenTag"');
    for (const secret of SECRETS) expect(reported).not.toContain(secret);
  });

  it('keeps only the latest 100 kinds over a long match', () => {
    expect(INTENT_LOG_CAP).toBe(100);
    pair();
    for (let n = 0; n < 150; n += 1) engine.send({ kind: 'switchCamera' });
    engine.send({ kind: 'start' });
    expect(engine.intentKinds).toHaveLength(100);
    expect(engine.intentKinds.at(0)).toBe('switchCamera');
    expect(engine.intentKinds.at(-1)).toBe('start');
    expect(engine.intentKinds).not.toContain('pair');
  });

  it('reports at least once a second, and stops when suspended', () => {
    const first = snapshot().reportedAtMs;
    wait(1000);
    expect(snapshot().reportedAtMs).toBe(first + 1000);
    engine.suspend();
    wait(5000);
    expect(snapshot().reportedAtMs).toBe(first + 1000);
  });

  it('reports nothing at all once suspended, not even a pending connect', () => {
    goLive();
    engine.suspend();
    wait(5000);
    expect(state()).toEqual({ kind: 'connecting', transport: 'srt' });
    expect(snapshot().reportedAtMs).toBe(NOW);
  });

  it('lets a forced state win over a pending connect (the dev panel’s Fail)', () => {
    goLive();
    engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null });
    wait(5000);
    expect(state()).toEqual({ kind: 'ended', reason: 'fatal-error', durationMs: null });
  });

  it('lets a scene win over a pending connect', () => {
    goLive();
    engine.scene('fell-back');
    wait(5000);
    expect(state()).toMatchObject({ kind: 'degraded', reason: 'fell-back-to-rtmps' });
  });

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = engine.subscribe(() => {
      calls += 1;
    });
    pair();
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

/** The rules the kit does not reach, each driven on its own (Task 23, Step 6). */
describe('the paired phase', () => {
  it('keeps a refusal across a second pair for the held code: the re-pair is ignored', () => {
    pair();
    engine.hear({ word: 'refused', refusal: 'no_credit' });
    expect(snapshot().refusal).toBe('no_credit');
    pair();
    expect(snapshot().refusal).toBe('no_credit');
  });

  it('clears the refusal when another code pairs over it', () => {
    pair();
    engine.hear({ word: 'refused', refusal: 'no_credit' });
    pair(KIT_CODE_B);
    expect(snapshot().refusal).toBeNull();
  });

  it('stays paired on a start while the sound check fails', () => {
    pair();
    engine.setReady({ sound: false });
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'paired' });
    expect(snapshot().broadcast).toBeNull();
  });

  it('holds Pairing while the permission dialog is up, and pairs once granted', () => {
    engine.setPermissions('hold');
    pair();
    expect(state()).toEqual({ kind: 'pairing' });
    expect(snapshot().pairing?.code).toBe('ka0000000001');
    engine.setPermissions('grant');
    expect(state()).toEqual({ kind: 'paired' });
  });

  it('leaves for Idle on a refused permission, naming the code and `permissions`', () => {
    engine.setPermissions('refuse');
    pair();
    expect(state()).toEqual({ kind: 'idle' });
    expect(snapshot().unpaired).toEqual({
      reason: 'permissions',
      code: 'ka0000000001',
      slot: 1,
      tokenTag: TAG_A,
    });
  });

  // Review C5 re-review, fake parity: native publishes Pairing, naming no unpair, before the
  // dialog's answer; the same code refused again goes through Pairing again.
  it('publishes Pairing before a refusal, each time, naming no unpair there', () => {
    const seen: [string, string | null][] = [];
    engine.subscribe(() => seen.push([state().kind, snapshot().unpaired?.reason ?? null]));
    engine.setPermissions('refuse');
    pair();
    pair();
    expect(seen).toEqual([
      ['pairing', null],
      ['idle', 'permissions'],
      ['pairing', null],
      ['idle', 'permissions'],
    ]);
  });

  // The scene stands for a pairing native left: it reaches Idle through Pairing, as one does.
  it('plays unpaired-replaced through Pairing', () => {
    const seen: [string, string | null][] = [];
    engine.subscribe(() => seen.push([state().kind, snapshot().unpaired?.reason ?? null]));
    engine.scene('unpaired-replaced');
    engine.scene('unpaired-replaced');
    expect(seen).toEqual([
      ['pairing', null],
      ['idle', 'replaced'],
      ['pairing', null],
      ['idle', 'replaced'],
    ]);
  });

  it('refuses a held dialog later, naming the code', () => {
    engine.setPermissions('hold');
    pair();
    engine.setPermissions('refuse');
    expect(state()).toEqual({ kind: 'idle' });
    expect(snapshot().unpaired?.reason).toBe('permissions');
  });

  it('holds a 401 while live as pending, and the next end unpairs with code-ended', () => {
    goLive();
    wait(1000);
    engine.hear({ word: 'code-ended' });
    expect(state().kind).toBe('publishing');
    expect(snapshot().codeEndedPending).toBe(true);
    engine.hear({ word: 'over', lastEnd: 'stopped-by-organiser' });
    expect(state()).toEqual({ kind: 'idle' });
    expect(snapshot().unpaired).toEqual({
      reason: 'code-ended',
      code: 'ka0000000001',
      slot: 1,
      tokenTag: TAG_A,
    });
  });

  it('unpairs at once on a 401 while paired', () => {
    pair();
    engine.hear({ word: 'code-ended' });
    expect(state()).toEqual({ kind: 'idle' });
    expect(snapshot().unpaired?.reason).toBe('code-ended');
  });

  it('echoes setAutomatic in the pairing, and ignores it with none', () => {
    engine.send({ kind: 'setAutomatic', on: false });
    expect(snapshot().pairing).toBeNull();
    pair();
    engine.send({ kind: 'setAutomatic', on: false });
    expect(snapshot().pairing?.automatic).toBe(false);
    engine.send({ kind: 'setAutomatic', on: true });
    expect(snapshot().pairing?.automatic).toBe(true);
  });

  it('hears nothing once ended: no word moves an Ended engine', () => {
    onAirLive();
    engine.send({ kind: 'stop' });
    const ended = state();
    for (const word of ['replaced', 'taken', 'code-ended', 'live'] as const) engine.hear({ word });
    engine.hear({ word: 'go-live', cause: 'organiser' });
    expect(state()).toEqual(ended);
    expect(snapshot().unpaired).toBeNull();
  });

  it('reports the waiting fields set for this and every later pairing', () => {
    engine.setPairing({ label: 'Example Town v Sample CC', pollSeconds: 15 });
    pair();
    expect(snapshot().pairing).toMatchObject({
      label: 'Example Town v Sample CC',
      pollSeconds: 15,
    });
    engine.setPairing({ label: 'Changed' });
    expect(snapshot().pairing?.label).toBe('Changed');
  });

  // W28: native seeds the scan's round line from the pair (both keys or neither); the fake does the same,
  // and a round line set by setPairing is the fake's own when the pair carries none.
  it('seeds the round line from a pair that carries one, and has none otherwise', () => {
    pair();
    expect(snapshot().pairing?.stageLabel).toBeNull();
    engine.send({ kind: 'unpair' });
    pair({ ...KIT_CODE_A, stageLabel: 'QF', stageMatch: 'Example Town v Sample CC' });
    expect(snapshot().pairing?.stageLabel).toBe('QF');
    engine.send({ kind: 'unpair' });
    pair({ ...KIT_CODE_A, stageLabel: 'QF' });
    expect(snapshot().pairing?.stageLabel).toBeNull();
    engine.send({ kind: 'unpair' });
    engine.setPairing({ stageLabel: 'SF' });
    pair();
    expect(snapshot().pairing?.stageLabel).toBe('SF');
  });
});

describe('scenes: every state spec §6 and the amendment list', () => {
  /** A row per scene: the compiler refuses a scene without one. */
  const EXPECTED: Readonly<Record<FakeScene, object>> = {
    pairing: { kind: 'pairing' },
    'paired-ready': { kind: 'paired' },
    'paired-not-ready': { kind: 'paired' },
    'paired-not-held': { kind: 'paired' },
    'paired-refused': { kind: 'paired' },
    'paired-after-organiser-stop': { kind: 'paired' },
    'arming-retrying': { kind: 'arming', cause: 'automatic', retrying: true },
    'armed-not-ready': { kind: 'armed', cause: 'organiser', notReady: 'held' },
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
    'camera-switching': { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW - ON_AIR_MS },
    'mic-silenced': { kind: 'degraded', reason: 'mic-silenced' },
    stopped: { kind: 'ended', reason: 'operator-stopped', durationMs: ON_AIR_MS },
    fatal: { kind: 'ended', reason: 'fatal-error' },
    shed: { kind: 'publishing' },
    'unpaired-replaced': { kind: 'idle' },
  };

  it('lists every scene once, for the dev controls', () => {
    expect(FAKE_SCENES).toHaveLength(23);
    expect([...FAKE_SCENES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(FAKE_SCENES)('%s plays without throwing', (scene) => {
    engine.scene(scene);
    expect(state()).toMatchObject(EXPECTED[scene]);
  });

  it('paired-not-ready has the mic not available, and shed is on the first ladder step', () => {
    engine.scene('paired-not-ready');
    expect(snapshot().ready.sound).toBe(false);
    engine.scene('shed');
    expect(telemetry().shed).toBe('overlay-preview');
  });

  /** Spec §4: a call is the one way the mic reads not available on air; native's readiness says so too (BridgeCore). */
  it('mic-silenced has the mic not available, as native reads a call, and live has it available', () => {
    engine.scene('mic-silenced');
    expect(snapshot().ready.sound).toBe(false);
    engine.scene('live');
    expect(snapshot().ready.sound).toBe(true);
  });

  it('carries each paired scene’s own fact: not held, a refusal, a last end', () => {
    engine.scene('paired-not-held');
    expect(snapshot().ready.held).toBe(false);
    engine.scene('paired-refused');
    expect(snapshot().refusal).toBe('no_credit');
    engine.scene('paired-after-organiser-stop');
    expect([snapshot().lastEnd, snapshot().broadcast]).toEqual(['stopped-by-organiser', null]);
  });

  it('names the held code in unpaired-replaced, and holds no pairing', () => {
    pair();
    engine.scene('unpaired-replaced');
    expect(snapshot().pairing).toBeNull();
    expect(snapshot().unpaired).toEqual({
      reason: 'replaced',
      code: 'ka0000000001',
      slot: 1,
      tokenTag: TAG_A,
    });
  });

  it('keeps the pairing across scenes, and holds a broadcast only on air', () => {
    pair();
    engine.scene('live');
    expect(snapshot().pairing?.tokenTag).toBe(TAG_A);
    expect(snapshot().broadcast).not.toBeNull();
    engine.scene('paired-ready');
    expect(snapshot().broadcast).toBeNull();
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
    pair();
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
    // Not vacuous: the held state and the first frame were both recorded (N4).
    expect(kinds[0]).toBe('degraded');
    expect(kinds.at(-1)).toBe('publishing');
    expect(kinds).not.toContain('connecting');
  });

  it('fails native’s camera check until the reopened camera’s first frame (Readiness.kt)', () => {
    engine.scene('camera-reopened');
    expect(snapshot().ready.camera).toBe(false);
    wait(2999);
    expect(snapshot().ready.camera).toBe(false);
    wait(1);
    expect(snapshot().ready.camera).toBe(true);
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
  it('forgets it across a reset: the next broadcast, stopped once live, has its own', () => {
    engine.scene('camera-reopened');
    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });
    onAirLive();
    wait(2_000);
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: 2_000 });
  });

  // A stale start would read live, and end the pairing: never live, the stop keeps it (owner decision 1).
  it('forgets it when a state is forced: a forced connect then stopped is never live', () => {
    engine.scene('camera-reopened');
    engine.forceState({ kind: 'connecting', transport: 'srt' });
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'paired' });
  });
});

/**
 * Plan B's `Snapshot.camera` (carry 10): whose camera is on air, null with no
 * session. Our own reopen or switch reads apart from another app's take.
 */
describe('whose camera is on air (carry 10)', () => {
  const camera = () => snapshot().camera;

  /** Plan B's wire strings, a row per scene: the compiler refuses a scene without one. */
  const CAMERA: Readonly<Record<FakeScene, CameraState | null>> = {
    pairing: 'own',
    'paired-ready': 'own',
    'paired-not-ready': 'own',
    'paired-not-held': 'own',
    'paired-refused': 'own',
    'paired-after-organiser-stop': 'own',
    'arming-retrying': 'own',
    'armed-not-ready': 'own',
    connecting: 'own',
    live: 'own',
    'fell-back': 'own',
    holding: 'own',
    stalled: 'own',
    restarting: 'own',
    'not-delivered': 'own',
    'camera-taken': 'taken',
    'camera-reopened': 'reopening',
    'camera-switching': 'switching',
    'mic-silenced': 'own',
    stopped: null,
    fatal: null,
    shed: 'own',
    'unpaired-replaced': null,
  };

  it.each(FAKE_SCENES)('%s', (scene) => {
    engine.scene(scene);
    expect(camera()).toBe(CAMERA[scene]);
  });

  it('has none before a pairing, its own once paired and on air, and none after', () => {
    expect(camera()).toBeNull();
    pair();
    expect(camera()).toBe('own');
    engine.send({ kind: 'start' });
    expect(camera()).toBe('own');
    wait(1000);
    expect(camera()).toBe('own');
    engine.send({ kind: 'stop' });
    expect(camera()).toBeNull();
  });

  it('has none after a reset', () => {
    engine.scene('stopped');
    engine.setCamera('taken');
    engine.send({ kind: 'reset' });
    expect(camera()).toBeNull();
  });

  it('follows a forced state: the camera is our own on air, none once ended', () => {
    engine.scene('camera-taken');
    engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW });
    expect(camera()).toBe('own');
    engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null });
    expect(camera()).toBeNull();
  });

  it('reads reopening until the reopened camera’s first frame, then its own', () => {
    engine.scene('camera-reopened');
    wait(2999);
    expect(camera()).toBe('reopening');
    wait(1);
    expect(camera()).toBe('own');
  });

  it('holds LIVE through our own switch, with no reading until the new camera’s first frame', () => {
    engine.scene('camera-switching');
    const live = { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW - ON_AIR_MS };
    expect(state()).toEqual(live);
    expect([telemetry().encodedVideoFps, snapshot().ready.camera]).toEqual([null, false]);
    wait(2999);
    expect(camera()).toBe('switching');
    wait(1);
    expect(camera()).toBe('own');
    expect(state()).toEqual(live);
    expect([telemetry().encodedVideoFps, snapshot().ready.camera]).toEqual([30, true]);
  });
});

describe('reports that change one thing', () => {
  it('changes whose camera it is and nothing else', () => {
    pair();
    const before = snapshot();
    engine.setCamera('taken');
    expect(snapshot()).toEqual({ ...before, camera: 'taken' });
  });

  it('changes readiness and nothing else outside Armed', () => {
    pair();
    const before = snapshot();
    engine.setReady({ network: false });
    expect(snapshot()).toEqual({ ...before, ready: { ...before.ready, network: false } });
  });

  it('tells its listeners', () => {
    const heard = vi.fn();
    engine.subscribe(heard);
    engine.setCamera('reopening');
    engine.setReady({ held: false });
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

/**
 * CD18: Android runs the service from the pair on (amendment §2, the paired
 * notification), so the fake survives the background from Pairing until Idle
 * or Ended. `setSurvivesBackground` is the service failing to start.
 */
describe('surviving the background (CD18)', () => {
  it('survives from Pairing through the broadcast, and not at rest or once ended', () => {
    const seen: [string, boolean][] = [];
    const look = () => seen.push([state().kind, snapshot().survivesBackground]);
    look();
    engine.setPermissions('hold');
    pair();
    look();
    engine.setPermissions('grant');
    look();
    engine.send({ kind: 'start' });
    look();
    wait(1_000);
    look();
    engine.send({ kind: 'stop' });
    look();
    engine.send({ kind: 'reset' });
    look();
    expect(seen).toEqual([
      ['idle', false],
      ['pairing', true],
      ['paired', true],
      ['connecting', true],
      ['publishing', true],
      ['ended', false],
      ['idle', false],
    ]);
  });

  it('follows a scene: on air survives, a stop does not', () => {
    engine.scene('live');
    expect(snapshot().survivesBackground).toBe(true);
    engine.scene('stopped');
    expect(snapshot().survivesBackground).toBe(false);
  });

  it('publishes a service that failed to start, and reports it again', () => {
    pair();
    const heard = vi.fn();
    engine.subscribe(heard);
    engine.setSurvivesBackground(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(snapshot().survivesBackground).toBe(false);
    wait(1_000);
    expect(snapshot().survivesBackground).toBe(false);
  });
});
