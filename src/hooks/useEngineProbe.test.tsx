import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureEnginePort, EngineIntent, EngineSnapshot } from '@/engine/CaptureEnginePort';
import { ENGINE_SCENARIOS } from '@/engine/contract/engineScenarios';
import type { NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import { UNREPORTED } from '@/engine/unreported';
import { PROBE_WAIT_MS, probeKit, useEngineProbe } from '@/hooks/useEngineProbe';
import type { Ports } from '@/hooks/usePorts';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { holdIntents } from '../../test/holdIntents';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

/** The bridge's settle, as the fake needs it: the fake reports synchronously, so at once. */
const settlesAtOnce = () =>
  ({ settled: vi.fn(() => Promise.resolve()) }) as unknown as NativeCaptureEngine;
/** An ack that never comes. */
const neverSettles = () =>
  ({ settled: vi.fn(() => new Promise<void>(() => undefined)) }) as unknown as NativeCaptureEngine;

/** The engine as JS reads it, changed by `view`; cached per snapshot, as `useSyncExternalStore` needs. */
function seenAs(
  engine: CaptureEnginePort,
  view: (snapshot: EngineSnapshot) => EngineSnapshot,
  drop: EngineIntent['kind'] | null = null,
): CaptureEnginePort {
  let from: EngineSnapshot | null = null;
  let shown: EngineSnapshot = view(engine.getSnapshot());
  return {
    send: (intent) => (intent.kind === drop ? undefined : engine.send(intent)),
    subscribe: (onChange) => engine.subscribe(onChange),
    getSnapshot: () => {
      const now = engine.getSnapshot();
      if (now !== from) {
        from = now;
        shown = view(now);
      }
      return shown;
    },
  };
}

type Setup = {
  readonly engine?: (fakes: FakePorts) => CaptureEnginePort;
  readonly ports?: Partial<Ports>;
  readonly prepare?: (fakes: FakePorts) => void;
};

/** The probe's hook in a development build with native wired: the fake behind a settling stub. */
function probeOn(setup: Setup = {}) {
  const base = createFakePorts();
  setup.prepare?.(base);
  const ports: Ports = {
    ...base.ports,
    engine: setup.engine?.(base) ?? base.engine,
    devEngine: null,
    nativeEngine: settlesAtOnce(),
    ...setup.ports,
  };
  const fakes: FakePorts = { ...base, ports };
  const hook = renderHook(() => useEngineProbe(), { wrapper: wrapperFor(fakes) });
  return { fakes, hook };
}

const flush = (ms = 10) => act(() => vi.advanceTimersByTimeAsync(ms));
const probeLines = (fakes: FakePorts) =>
  readRecord(fakes.record)
    .filter((entry) => entry.event.startsWith('probe.'))
    .map((entry) => [entry.event, entry.fields]);
const run = (hook: ReturnType<typeof probeOn>['hook']) =>
  act(() => {
    hook.result.current?.run();
  });

/**
 * CD24: the engine contract on a phone, against the real bridge, in a
 * development build: the scenarios that send no start and need no server word.
 */
describe('the device probe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // PV34: fourteen scenarios in the tree (Task 27's thirteen and this task's
  // unpair), three of them on the phone, so the probe skips eleven.
  it('counts the scenarios it runs and skips (PV12: zero is a failure)', () => {
    const onPhone = ENGINE_SCENARIOS.filter((scenario) => scenario.onPhone);
    expect([ENGINE_SCENARIOS.length, onPhone.length]).toEqual([14, 3]);
  });

  it('passes on a sound engine, scene by scene, and leaves it idle', async () => {
    const { fakes, hook } = probeOn();
    expect(hook.result.current?.state).toBe('idle');
    run(hook);
    await flush();
    expect(hook.result.current?.state).toBe('passed');
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.pass', { scene: 0 }],
      ['probe.pass', { scene: 1 }],
      ['probe.pass', { scene: 2 }],
    ]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    expect(fakes.engine.intents.map((intent) => intent.kind)).not.toContain('start');
  });

  it('a mismatch fails, naming the scene and the check, and stays until dismissed (PV35)', async () => {
    const { fakes, hook } = probeOn({
      engine: (base) =>
        seenAs(base.engine, (snapshot) =>
          snapshot.state.kind === 'paired' ? { ...snapshot, pairing: null } : snapshot,
        ),
    });
    run(hook);
    await flush();
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.fail', { scene: 0, check: 3, reason: 'mismatch' }],
    ]);
    // Review C5 I-1: the failed scene's pairing is given back, so no made-up code stays paired.
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    expect(fakes.engine.intents.map((intent) => intent.kind)).toEqual([
      'pair',
      'unpair',
      'stop',
      'reset',
    ]);
    expect(hook.result.current?.state).toBe('failed');
    await flush(60_000);
    expect(hook.result.current?.state).toBe('failed');
    act(() => hook.result.current?.dismiss());
    expect(hook.result.current?.state).toBe('idle');
  });

  // I-1: the cleanup is best effort, inside one more bound; the readout names the scene's failure.
  it('a cleanup that stalls keeps the failure, inside its own bound, and runs nothing while paired', async () => {
    const { fakes, hook } = probeOn({
      engine: (base) =>
        seenAs(
          base.engine,
          (snapshot) =>
            snapshot.state.kind === 'paired' ? { ...snapshot, pairing: null } : snapshot,
          'unpair',
        ),
    });
    run(hook);
    await flush(PROBE_WAIT_MS - 20);
    expect(hook.result.current?.state).toBe('running');
    await flush(40);
    expect(hook.result.current?.state).toBe('failed');
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.fail', { scene: 0, check: 3, reason: 'mismatch' }],
    ]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
    // No second run while the engine is not idle.
    run(hook);
    await flush(PROBE_WAIT_MS * 3);
    expect(probeLines(fakes)).toHaveLength(2);
    expect(hook.result.current?.state).toBe('failed');
  });

  // A refused ack is a stop, at once: the run neither waits out its bound nor leaves a rejection unheard.
  it('a refused ack in the cleanup ends the run at once', async () => {
    const native = {
      settled: vi
        .fn((): Promise<void> => Promise.reject(new Error('the bridge was disposed')))
        .mockImplementationOnce(() => Promise.resolve()),
    } as unknown as NativeCaptureEngine;
    const { fakes, hook } = probeOn({
      ports: { nativeEngine: native },
      engine: (base) =>
        seenAs(base.engine, (snapshot) =>
          snapshot.state.kind === 'paired' ? { ...snapshot, pairing: null } : snapshot,
        ),
    });
    run(hook);
    await flush();
    expect(hook.result.current?.state).toBe('failed');
    expect(fakes.engine.intents.map((intent) => intent.kind)).toEqual(['pair', 'unpair']);
  });

  // I-1: once the bound has given up on the cleanup, it sends nothing more.
  it('a cleanup given up on sends nothing after the readout', async () => {
    // Acks by call: the scene's pair at once, the cleanup's unpair and stop 3 s each, then at once.
    const delays = [0, 3_000, 3_000];
    const native = {
      settled: vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, delays.shift() ?? 0)),
      ),
    } as unknown as NativeCaptureEngine;
    const { fakes, hook } = probeOn({
      ports: { nativeEngine: native },
      engine: (base) =>
        seenAs(
          base.engine,
          (snapshot) =>
            snapshot.state.kind === 'paired' ? { ...snapshot, pairing: null } : snapshot,
          'unpair',
        ),
    });
    run(hook);
    await flush(PROBE_WAIT_MS + 10);
    expect(hook.result.current?.state).toBe('failed');
    await flush(PROBE_WAIT_MS * 3);
    expect(fakes.engine.intents.map((intent) => intent.kind)).toEqual(['pair', 'stop']);
  });

  it('a dismissed readout on an idle engine offers the probe again', async () => {
    const { fakes, hook } = probeOn({
      engine: (base) =>
        seenAs(base.engine, (snapshot) =>
          snapshot.state.kind === 'paired' ? { ...snapshot, pairing: null } : snapshot,
        ),
    });
    run(hook);
    await flush();
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    act(() => hook.result.current?.dismiss());
    expect(hook.result.current?.state).toBe('idle');
    run(hook);
    await flush();
    expect(probeLines(fakes).filter(([event]) => event === 'probe.fail')).toHaveLength(2);
  });

  // The scene's bound, then the cleanup's (I-1): neither ack comes, so two bounds in all.
  it('no ack stops the run, inside its bound', async () => {
    const { fakes, hook } = probeOn({ ports: { nativeEngine: neverSettles() } });
    run(hook);
    await flush(PROBE_WAIT_MS - 20);
    expect(probeLines(fakes)).toEqual([['probe.skip', { count: 11 }]]);
    expect(hook.result.current?.state).toBe('running');
    await flush(20);
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.fail', { scene: 0, reason: 'no-ack' }],
    ]);
    await flush(PROBE_WAIT_MS - 40);
    expect(hook.result.current?.state).toBe('running');
    await flush(40);
    expect(hook.result.current?.state).toBe('failed');
  });

  // The permission answer lands after the pair's ack (Task 38): one that never comes stops it.
  it('a pairing that never leaves Pairing stops the run', async () => {
    const { fakes, hook } = probeOn({ prepare: (base) => base.engine.setPermissions('hold') });
    run(hook);
    await flush(PROBE_WAIT_MS + 100);
    // I-1: the cleanup's unpair ends the pairing the permission dialog held.
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.fail', { scene: 0, reason: 'stuck-pairing' }],
    ]);
    expect(hook.result.current?.state).toBe('failed');
  });

  // PV35: between scenarios the probe waits for idle, not just for acks.
  it('an engine that does not return to idle between scenarios stops the run', async () => {
    const { fakes, hook } = probeOn({
      engine: (base) => seenAs(base.engine, (snapshot) => snapshot, 'unpair'),
    });
    run(hook);
    await flush(PROBE_WAIT_MS + 100);
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.pass', { scene: 0 }],
      ['probe.fail', { scene: 0, reason: 'not-idle' }],
    ]);
  });

  it('a second run while running starts nothing', async () => {
    const { fakes, hook } = probeOn();
    act(() => {
      hook.result.current?.run();
      hook.result.current?.run();
    });
    await flush();
    expect(probeLines(fakes).filter(([event]) => event === 'probe.pass')).toHaveLength(3);
    expect(probeLines(fakes).filter(([event]) => event === 'probe.skip')).toHaveLength(1);
  });

  // The idle guard cannot see this one: native has not yet answered the first run's pair.
  it('a second run before native has answered the first starts nothing', async () => {
    const { fakes, hook } = probeOn();
    const held = holdIntents(fakes.engine, ['pair']);
    act(() => hook.result.current?.run());
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    act(() => hook.result.current?.run());
    act(() => held.release());
    await flush();
    expect(probeLines(fakes).filter(([event]) => event === 'probe.skip')).toHaveLength(1);
  });

  it('a run after a pass runs again', async () => {
    const { fakes, hook } = probeOn();
    run(hook);
    await flush();
    run(hook);
    await flush();
    expect(probeLines(fakes).filter(([event]) => event === 'probe.pass')).toHaveLength(6);
  });

  it('is not offered with the fake wired, without native, outside development, or while paired', () => {
    expect(
      probeOn({ ports: { devEngine: createFakePorts().engine } }).hook.result.current,
    ).toBeNull();
    expect(probeOn({ ports: { nativeEngine: null } }).hook.result.current).toBeNull();
    expect(probeOn({ ports: { devTools: false } }).hook.result.current).toBeNull();
    const paired = probeOn({ prepare: (base) => pairCode(base.engine, savedStreamCode()) });
    expect(paired.hook.result.current).toBeNull();
    expect(probeOn().hook.result.current).not.toBeNull();
  });

  it('writes no scenario phrase and no token to the record', async () => {
    const { fakes, hook } = probeOn();
    run(hook);
    await flush();
    const text = fakes.record.lines().join('\n');
    expect(probeLines(fakes)).toHaveLength(4);
    expect(text).not.toContain('tok-kit');
    for (const scenario of ENGINE_SCENARIOS) expect(text).not.toContain(scenario.name);
  });
});

/** The kit over the bridge (PV33 and the probe's refusals). */
describe('the probe kit', () => {
  function recording(checks = { count: 0 }) {
    const events: string[] = [];
    const engine: CaptureEnginePort = {
      send: (intent) => void events.push(`send ${intent.kind}`),
      subscribe: () => () => undefined,
      getSnapshot: () => UNREPORTED,
    };
    const native = {
      settled: () => {
        events.push('settled');
        return Promise.resolve();
      },
    } as unknown as NativeCaptureEngine;
    return { events, kit: probeKit(engine, native, checks) };
  }

  it('PV33 sendTogether sends every intent, then settles once', async () => {
    const { events, kit } = recording();
    await kit.sendTogether([{ kind: 'unpair' }, { kind: 'reset' }]);
    expect(events).toEqual(['send unpair', 'send reset', 'settled']);
  });

  it('send settles after each intent', async () => {
    const { events, kit } = recording();
    await kit.send({ kind: 'unpair' });
    await kit.send({ kind: 'reset' });
    expect(events).toEqual(['send unpair', 'settled', 'send reset', 'settled']);
  });

  // A start on a phone would go on air for real: the probe refuses it, sent alone or together.
  it('refuses a start, a server word and readiness, sending nothing', async () => {
    const { events, kit } = recording();
    await expect(kit.send({ kind: 'start' })).rejects.toMatchObject({ reason: 'unsupported' });
    await expect(kit.sendTogether([{ kind: 'stop' }, { kind: 'start' }])).rejects.toMatchObject({
      reason: 'unsupported',
    });
    await expect(kit.say({ word: 'replaced' })).rejects.toMatchObject({ reason: 'unsupported' });
    await expect(kit.ready({ held: true })).rejects.toMatchObject({ reason: 'unsupported' });
    expect(events).toEqual([]);
  });

  it('counts each snapshot read, as the failing check’s ordinal', async () => {
    const checks = { count: 0 };
    const { kit } = recording(checks);
    kit.snapshot();
    await kit.send({ kind: 'unpair' });
    kit.snapshot();
    expect(checks.count).toBe(2);
  });
});
