import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCaptureEngine } from './FakeCaptureEngine';

const NOW = 1_700_000_000_000;

let engines: ReturnType<typeof createFakeCaptureEngine>[] = [];

function track<T extends ReturnType<typeof createFakeCaptureEngine>>(engine: T): T {
  engines.push(engine);
  return engine;
}

function armedAndPublishing(clock: () => number = () => NOW) {
  const engine = track(createFakeCaptureEngine(clock));
  engine.apply({ kind: 'SessionArmed' }, clock());
  engine.apply({ kind: 'PublishStarted', transport: 'srt' }, clock());
  return engine;
}

afterEach(() => {
  for (const engine of engines) engine.dispose();
  engines = [];
});

describe('FakeCaptureEngine', () => {
  it('starts idle with no telemetry', () => {
    const engine = track(createFakeCaptureEngine(() => NOW));

    expect(engine.getSnapshot().state).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().telemetry.bitrateKbps).toBe(0);
  });

  it('reports live telemetry while publishing', () => {
    const { state, telemetry } = armedAndPublishing().getSnapshot();

    expect(state.kind).toBe('publishing');
    expect(telemetry.bitrateKbps).toBeGreaterThan(2500);
    expect(telemetry.rttMs).not.toBeNull();
  });

  // Telemetry must describe the state it ships with. Pairing a new state with
  // the previous state's telemetry renders "RECONNECTING · 3000k" and teaches
  // the operator to distrust the display.
  it('does not report a healthy uplink in the same snapshot as a lost one', () => {
    const engine = armedAndPublishing();

    engine.apply({ kind: 'UplinkLost', holdWindowSeconds: 60 }, NOW);
    const { state, telemetry } = engine.getSnapshot();

    expect(state.kind).toBe('reconnecting');
    expect(telemetry.bitrateKbps).toBe(0);
    expect(telemetry.rttMs).toBeNull();
    expect(telemetry.captureTimestampMs).toBeNull();
  });

  it('records how far down the ladder the device was pushed', () => {
    const engine = armedAndPublishing();

    engine.apply({ kind: 'ThermalCeilingHit', shed: 'overlay-preview' }, NOW);
    const { state, telemetry } = engine.getSnapshot();

    expect(state.kind).toBe('publishing');
    expect(telemetry.shed).toBe('overlay-preview');
    expect(telemetry.thermalHeadroom).toBeLessThan(0.2);
  });

  // forceState exists so screens can be built against any state without a
  // device; leaving stale telemetry behind blanks the HUD it is used to build.
  it('derives telemetry for a forced state', () => {
    const engine = track(createFakeCaptureEngine(() => NOW));

    engine.forceState({ kind: 'publishing', transport: 'rtmps', sinceEpochMs: NOW - 60_000 });
    const { telemetry } = engine.getSnapshot();

    expect(telemetry.bitrateKbps).toBeGreaterThan(2500);
    expect(telemetry.audioLevel).toBeGreaterThan(0);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const engine = track(createFakeCaptureEngine(() => NOW));
    let calls = 0;
    const unsubscribe = engine.subscribe(() => {
      calls += 1;
    });

    engine.apply({ kind: 'SessionArmed' }, NOW);
    expect(calls).toBe(1);

    unsubscribe();
    engine.apply({ kind: 'PublishStarted', transport: 'srt' }, NOW);
    expect(calls).toBe(1);
  });

  it('ends the session on the stop intent', () => {
    const engine = armedAndPublishing();

    engine.send({ kind: 'stop' });

    expect(engine.getSnapshot().state).toEqual({ kind: 'ended', reason: 'operator-stopped' });
  });

  // Without a reset the operator is stranded on a finished session: unable to
  // go live again and unable to reach the scan screen.
  it('returns to idle on the reset intent so another fixture can be scanned', () => {
    const engine = armedAndPublishing();

    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });

    expect(engine.getSnapshot().state).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().telemetry.bitrateKbps).toBe(0);
  });

  describe('freshness', () => {
    // Silence has to mean something, or reportedAtMs carries no information and
    // a suspended process is indistinguishable from a working one.
    it('stamps every snapshot with the time native emitted it', () => {
      let clock = NOW;
      const engine = armedAndPublishing(() => clock);

      expect(engine.getSnapshot().reportedAtMs).toBe(NOW);

      clock = NOW + 5_000;
      engine.apply({ kind: 'ThermalCeilingHit', shed: 'preview-framerate' });

      expect(engine.getSnapshot().reportedAtMs).toBe(NOW + 5_000);
    });

    // What an iPhone lock looks like from JavaScript: the timestamp stops
    // advancing while the state still claims to be publishing.
    it('freezes the timestamp when suspended, leaving a stale claim behind', () => {
      let clock = NOW;
      const engine = armedAndPublishing(() => clock);

      engine.suspend();
      clock = NOW + 120_000;

      expect(engine.getSnapshot().reportedAtMs).toBe(NOW);
      expect(engine.getSnapshot().state.kind).toBe('publishing');
    });

    it('resolves the ambiguity as ended when the hold window ran out', () => {
      const engine = armedAndPublishing();

      engine.suspend();
      engine.resume(120_000, 'expired');

      expect(engine.getSnapshot().state).toEqual({
        kind: 'ended',
        reason: 'hold-window-expired',
      });
    });

    it('resolves the ambiguity as reconnecting when the hold covered it', () => {
      const engine = armedAndPublishing();

      engine.suspend();
      engine.resume(8_000, 'held');

      expect(engine.getSnapshot().state.kind).toBe('reconnecting');
    });
  });

  describe('device conditions', () => {
    // A call keeps the app foregrounded while killing the microphone, so this
    // cannot be inferred from AppState — only native knows.
    it('carries an interruption without moving the session', () => {
      const engine = armedAndPublishing();

      engine.interrupt('call');

      expect(engine.getSnapshot().state.kind).toBe('publishing');
      expect(engine.getSnapshot().telemetry.interruption).toBe('call');
    });

    it('clears an interruption when it ends', () => {
      const engine = armedAndPublishing();

      engine.interrupt('call');
      engine.interrupt(null);

      expect(engine.getSnapshot().telemetry.interruption).toBeNull();
    });

    // The lock warning gates on this, never on Platform.OS: an Android
    // foreground service that failed to start must report false.
    it('reports whether capture survives backgrounding', () => {
      const engine = armedAndPublishing();

      expect(engine.getSnapshot().survivesBackground).toBe(false);

      engine.setSurvivesBackground(true);

      expect(engine.getSnapshot().survivesBackground).toBe(true);
    });
  });
});
