import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureEnginePort, EngineIntent, EngineSnapshot } from '@/engine/CaptureEnginePort';
import { ENGINE_SCENARIOS } from '@/engine/contract/engineScenarios';
import type { NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import { UNREPORTED } from '@/engine/unreported';
import { PROBE_WAIT_MS, probeKit, useEngineProbe } from '@/hooks/useEngineProbe';
import { useReopenGate } from '@/hooks/useReopenGate';
import type { Ports } from '@/hooks/usePorts';
import { createLogger } from '@/services/logger';
import {
  createRingRecord,
  createRoutedRecord,
  recordGoesNative,
  type LogEntry,
  type SessionRecord,
} from '@/services/sessionRecord';
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

/**
 * F-S4-2: native's record hands each line forwarded to it back to the ring (`onRecordLine`), where the
 * readout reads it; the ports' record stands in for that ring. A stub with its own `forward` keeps it.
 */
function echoing(
  native: NativeCaptureEngine | null,
  ring: SessionRecord,
): NativeCaptureEngine | null {
  if (native === null) return null;
  // The stubs here are partial: the type gives every engine a `forward`, a stub may have none.
  const stub: Partial<NativeCaptureEngine> = native;
  if (stub.forward !== undefined) return native;
  return { ...stub, forward: (entry: LogEntry) => ring.append(entry) } as NativeCaptureEngine;
}

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
    ...setup.ports,
    nativeEngine: echoing(
      setup.ports && 'nativeEngine' in setup.ports
        ? (setup.ports.nativeEngine ?? null)
        : settlesAtOnce(),
      base.record,
    ),
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
    // Their places in the tree, which each line names: the two pairs first, the unpair last.
    expect(ENGINE_SCENARIOS.flatMap((scenario, at) => (scenario.onPhone ? [at] : []))).toEqual([
      0, 1, 13,
    ]);
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
      ['probe.pass', { scene: 13 }],
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
    // Review C5 m-3: a scene that cannot leave clean has not passed.
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
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

  // Review C5 m-4: a scene names its place in the whole tree, not among the phone's three.
  it('names a failed scene by its place in the tree', async () => {
    const { fakes, hook } = probeOn({
      // An Idle engine that still names an unpair: only the unpair scenario reads it.
      engine: (base) =>
        seenAs(base.engine, (snapshot) =>
          snapshot.state.kind === 'idle'
            ? { ...snapshot, unpaired: { reason: 'replaced', code: 'x', slot: 1, tokenTag: 't' } }
            : snapshot,
        ),
    });
    run(hook);
    await flush();
    expect(probeLines(fakes)).toEqual([
      ['probe.skip', { count: 11 }],
      ['probe.pass', { scene: 0 }],
      ['probe.pass', { scene: 1 }],
      // Reads: Paired after the pair (1); Idle, its name and its unpair (2, 3, 4).
      ['probe.fail', { scene: 13, check: 4, reason: 'mismatch' }],
    ]);
  });

  /**
   * Device session 4, F-S4-2: the run's `probe.fail` never reached the shared record. The probe starts at idle,
   * and a scene that finds the engine idle after its pair (the reopen gate's orphan unpair, there) fails at
   * idle, where M16 files a JS line in the ring only, which the record a phone shares never holds. The probe's
   * lines go to native's record whatever the engine's state: numbers and a reason word only.
   */
  it('F-S4-2 writes every line to native’s record, though the engine reads idle, where M16 keeps a JS line in the ring', async () => {
    const ring = createRingRecord();
    const forwarded: LogEntry[] = [];
    const native = {
      ...settlesAtOnce(),
      forward: vi.fn((entry: LogEntry) => {
        forwarded.push(entry);
        ring.append(entry); // native's line, back in the ring
      }),
    } as unknown as NativeCaptureEngine;
    const view: { seen: CaptureEnginePort | null } = { seen: null };
    // As the app wires it (`routedRecordFor`): native's record while native holds a pairing, the ring otherwise.
    const record = createRoutedRecord(ring, {
      active: () => recordGoesNative(true, view.seen?.getSnapshot().state.kind ?? 'idle'),
      forward: (entry) => native.forward(entry),
    });
    const logger = createLogger({ record, now: () => 0 });
    const { fakes, hook } = probeOn({
      engine: (base) => {
        const idle = base.engine.getSnapshot();
        // Session 4: the pair is answered, then the engine reads idle again.
        view.seen = seenAs(base.engine, (snapshot) =>
          snapshot.state.kind === 'paired' ? idle : snapshot,
        );
        return view.seen;
      },
      ports: { nativeEngine: native, record, logger },
    });
    run(hook);
    await flush();
    expect(hook.result.current?.state).toBe('failed');
    expect(view.seen?.getSnapshot().state.kind).toBe('idle');
    const first = ENGINE_SCENARIOS.findIndex((scenario) => scenario.onPhone);
    const written = forwarded.map((entry) => [entry.event, entry.fields]);
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual(['probe.skip', { count: 11 }]);
    expect(written[1]?.[0]).toBe('probe.fail');
    const failed = written[1]?.[1] as Record<string, unknown>;
    expect(Object.keys(failed)).toEqual(['scene', 'check', 'reason']);
    expect([failed.scene, failed.reason, Number.isInteger(failed.check)]).toEqual([
      first,
      'mismatch',
      true,
    ]);
    expect(failed.check as number).toBeGreaterThan(0);
    // The positive pair: the app's own JS line at idle still files in the ring only (M16 stands).
    fakes.ports.logger.info('probe.control');
    expect(forwarded.map((entry) => entry.event)).not.toContain('probe.control');
    expect(readRecord(ring).map((entry) => entry.event)).toContain('probe.control');
  });

  // Review C5 m-2: Dismiss clears a readout, never a run.
  it('dismiss while running leaves the run running', async () => {
    const { hook } = probeOn({ ports: { nativeEngine: neverSettles() } });
    run(hook);
    await flush();
    act(() => hook.result.current?.dismiss());
    expect(hook.result.current?.state).toBe('running');
    await flush(PROBE_WAIT_MS * 2);
    expect(hook.result.current?.state).toBe('failed');
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

/**
 * Device session 4, F-S4-2: the probe pairs a made-up code no saved code owns, which the reopen gate's
 * orphan rule unpairs at the next return to the foreground (the permission dialog closing is one), so
 * the scene read idle. While the probe runs, the gate leaves its pairing alone; after it, the rule holds.
 */
describe('the reopen gate during a probe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The gate and the probe in one tree, as Shell and the dev panel are, over a native that never acks. */
  function probeAndGate() {
    const base = createFakePorts();
    const ports: Ports = {
      ...base.ports,
      devEngine: null,
      nativeEngine: echoing(neverSettles(), base.record),
    };
    const fakes: FakePorts = { ...base, ports };
    const hook = renderHook(
      () => {
        useReopenGate(true);
        return useEngineProbe();
      },
      { wrapper: wrapperFor(fakes) },
    );
    return { fakes, hook };
  }
  const returned = (fakes: FakePorts) => {
    act(() => fakes.foreground.leave());
    act(() => fakes.foreground.fire());
  };
  const orphanUnpairs = (fakes: FakePorts) =>
    readRecord(fakes.record).filter(
      (entry) => entry.event === 'intent.unpair' && entry.fields.action === 'orphan',
    ).length;

  it('leaves the probe’s pairing alone at a return to the foreground, and unpairs an orphan once it ends', async () => {
    const { fakes, hook } = probeAndGate();
    await flush();
    run(hook);
    await flush();
    expect(hook.result.current?.state).toBe('running');
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
    returned(fakes);
    await flush();
    expect(orphanUnpairs(fakes)).toBe(0);
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
    // No ack: the scene stops at its bound, and its clean-up gives up at its own.
    await flush(PROBE_WAIT_MS * 2);
    expect(hook.result.current?.state).toBe('failed');
    // The positive pair: the same gate, the probe over, unpairs a pairing no saved code owns.
    act(() => pairCode(fakes.engine, savedStreamCode()));
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
    returned(fakes);
    await flush();
    expect(orphanUnpairs(fakes)).toBe(1);
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
