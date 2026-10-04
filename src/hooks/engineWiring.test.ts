import { afterEach, describe, expect, it } from 'vitest';
import { KIT_CODE_A } from '@/engine/contract/engineScenarios';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import { vectorWire } from '@/engine/wire/vectorWire';
import { chooseEngine, routedRecordFor, type WiredEngine } from '@/hooks/engineWiring';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';

const NOW = 1_790_000_000_000;
const quiet = { now: () => NOW, onRecordLine: () => undefined };

/** Every engine a test wired, to stop its timers and listeners. */
const wiredHere: WiredEngine[] = [];
const wire = (input: Parameters<typeof chooseEngine>[0]): WiredEngine => {
  const wired = chooseEngine(input);
  wiredHere.push(wired);
  return wired;
};
afterEach(() => {
  for (const wired of wiredHere.splice(0)) {
    wired.native?.dispose();
    wired.devEngine?.dispose();
  }
});

describe('CD24: which engine the composition root wires', () => {
  it('a release build wires native when the module is there, whatever the flag', () => {
    const wired = wire({ dev: false, fakeFlag: '1', native: new FakeNativeModule(), ...quiet });
    expect(wired.native).not.toBeNull();
    expect(wired.engine).toBe(wired.native);
    expect(wired.devEngine).toBeNull();
  });

  it('a development build wires native unless EXPO_PUBLIC_FAKE_ENGINE=1', () => {
    const native = wire({
      dev: true,
      fakeFlag: undefined,
      native: new FakeNativeModule(),
      ...quiet,
    });
    expect(native.devEngine).toBeNull();
    expect(native.native).not.toBeNull();
    expect(native.engine).toBe(native.native);
    const fake = wire({ dev: true, fakeFlag: '1', native: new FakeNativeModule(), ...quiet });
    expect(fake.devEngine).toBe(fake.engine);
    expect(fake.native).toBeNull();
  });

  it('a flag other than "1" is not the fake', () => {
    const wired = wire({ dev: true, fakeFlag: 'true', native: new FakeNativeModule(), ...quiet });
    expect(wired.devEngine).toBeNull();
    expect(wired.native).not.toBeNull();
  });

  it('no native module (iOS in S1, web) wires the absent engine, which ends a pair naming the code', () => {
    const wired = wire({ dev: false, fakeFlag: undefined, native: null, ...quiet });
    expect(wired.native).toBeNull();
    expect(wired.devEngine).toBeNull();
    wired.engine.send(KIT_CODE_A);
    const { state, pairing } = wired.engine.getSnapshot();
    expect(state.kind === 'ended' ? state.reason : state.kind).toBe('fatal-error');
    expect(pairing?.code).toBe('ka0000000001');
  });

  it('a development build with no module and the flag unset still wires the absent engine', () => {
    const wired = wire({ dev: true, fakeFlag: undefined, native: null, ...quiet });
    expect([wired.native, wired.devEngine]).toEqual([null, null]);
    wired.engine.send(KIT_CODE_A);
    expect(wired.engine.getSnapshot().state.kind).toBe('ended');
  });

  // The native engine's record lines reach the ring the screen reads (D3).
  it("hands native's record lines to the ring", () => {
    const ring = createRingRecord();
    wire({
      dev: false,
      fakeFlag: undefined,
      native: new FakeNativeModule({ tail: ['{"kind":"paired"}'] }),
      now: () => NOW,
      onRecordLine: ring.appendLine,
    });
    expect(ring.lines()).toEqual(['{"kind":"paired"}']);
  });
});

/**
 * M16 as wired (the routed record): a JS line goes to native's record while
 * native holds a pairing, and to the ring otherwise. C4c carry (b): the kind is
 * the one native reports when the line is written (`current()`), never the JS
 * snapshot's, which may lag it by up to a tick.
 */
describe('M16: where a JS record line goes', () => {
  function routed(current: unknown, wiring: { dev: boolean; fakeFlag?: string } = { dev: false }) {
    const shared: { current?: unknown } = { current };
    const native = new FakeNativeModule(shared);
    const ring = createRingRecord();
    const wired = wire({
      dev: wiring.dev,
      fakeFlag: wiring.fakeFlag,
      native,
      now: () => NOW,
      onRecordLine: ring.appendLine,
    });
    const logger = createLogger({ record: routedRecordFor(ring, wired), now: () => NOW });
    return { shared, native, ring, logger };
  }

  it('goes to the ring while native is idle', () => {
    const { native, ring, logger } = routed(null);
    logger.info('intent.pair', { claim: 'new' });
    expect(native.logged).toEqual([]);
    expect(ring.lines()).toHaveLength(1);
  });

  it("goes to native's record while native holds a pairing", () => {
    const { native, ring, logger } = routed(vectorWire('paired-after-organiser-stop'));
    logger.info('intent.stop');
    expect(native.logged).toEqual([['info', 'intent.stop', {}]]);
    expect(ring.lines()).toEqual([]);
  });

  it('C4c (b) follows native as it reports now, ahead of the queued snapshot event', () => {
    const { shared, native, ring, logger } = routed(null);
    shared.current = vectorWire('paired-after-organiser-stop');
    logger.info('intent.stop');
    expect(native.logged).toEqual([['info', 'intent.stop', {}]]);
    shared.current = vectorWire('idle');
    logger.info('intent.pair');
    expect(native.logged).toHaveLength(1);
    expect(ring.lines()).toHaveLength(1);
  });

  it('never goes to native with the fake wired', () => {
    const { native, ring, logger } = routed(vectorWire('paired-after-organiser-stop'), {
      dev: true,
      fakeFlag: '1',
    });
    logger.info('intent.stop');
    expect(native.logged).toEqual([]);
    expect(ring.lines()).toHaveLength(1);
  });
});
