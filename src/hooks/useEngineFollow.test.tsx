import { act, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { useEngineFollow } from '@/hooks/useEngineFollow';
import { useReopenGate } from '@/hooks/useReopenGate';
import { STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { captureRaw } from '../../test/fixtures/wire';
import { pairCode } from '../../test/pairCode';
import { flush as flushApp, launchApp, scanFromHome, type LaunchedApp } from '../../test/routedApp';
import { wrapperFor } from '../../test/renderWithPorts';

const code = savedStreamCode();
/** Another camera position of the same match: another code to the identity rules (C7). */
const other = savedStreamCode({
  raw: captureRaw({ slot: 2, tok: 'tok-other-000000000000' }),
  slot: 2,
});
const inStream = (saved: SavedCode = code) => ({
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
});

/** Shell's two hooks, in its order, over fake ports whose engine already holds `paired`. */
async function shell(options: { saved?: SavedCode | null; paired?: SavedCode | null } = {}) {
  const saved = options.saved === undefined ? code : options.saved;
  const paired = options.paired === undefined ? saved : options.paired;
  const fakes = createFakePorts(saved === null ? {} : { kvSeed: inStream(saved) });
  if (paired !== null) pairCode(fakes.engine, paired);
  const view = renderHook(
    () => {
      useReopenGate(true);
      useEngineFollow();
    },
    { wrapper: wrapperFor(fakes) },
  );
  await flush();
  return { ...fakes, view };
}

const flush = (ms = 10) => act(() => vi.advanceTimersByTimeAsync(ms));
const savedOf = (fakes: FakePorts) => {
  const snapshot = fakes.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? snapshot.saved.codes.stream : 'loading';
};

/**
 * The amendment's _The engine port_ and _Process death and reopen_: JS applies
 * native's word to the saved code on every snapshot, and shows /stream while
 * a broadcast is held.
 */
describe('useEngineFollow: native’s word on the saved code', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('forgets the code an unasked unpair names, and goes Home, once', async () => {
    const fakes = await shell();
    expect(fakes.navigation.current()).toBe('stream');
    const forget = vi.spyOn(fakes.ports.modeStore, 'forget');
    act(() => fakes.engine.hear({ word: 'replaced' }));
    await flush();
    expect(savedOf(fakes)).toBeUndefined();
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(fakes.navigation.current()).toBe('home');
    // Three more reports, each still naming the unpaired code: no second write.
    await flush(3_000);
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('keeps the saved code when the unpair names another code', async () => {
    const fakes = await shell({ paired: other });
    act(() => fakes.engine.hear({ word: 'replaced' }));
    await flush();
    expect(fakes.engine.getSnapshot().unpaired).toMatchObject({ slot: 2 });
    expect(savedOf(fakes)).toEqual(code);
  });

  it('forgets the code on the operator’s Stop, and stays on its Ended screen', async () => {
    const fakes = await shell();
    act(() => fakes.engine.send({ kind: 'start' }));
    await flush(5_000);
    act(() => fakes.engine.send({ kind: 'stop' }));
    await flush();
    expect(fakes.engine.getSnapshot().state).toMatchObject({
      kind: 'ended',
      reason: 'operator-stopped',
    });
    expect(savedOf(fakes)).toBeUndefined();
    expect(fakes.navigation.current()).toBe('stream');
  });

  it('marks a permanent failure tapToPair and keeps the code; pairing it again clears the mark', async () => {
    const fakes = await shell();
    const tap = () => {
      const saved = savedOf(fakes);
      return typeof saved === 'object' ? saved.stream?.tapToPair : saved;
    };
    act(() => fakes.engine.scene('fatal'));
    await flush();
    expect(fakes.engine.getSnapshot().state).toMatchObject({
      kind: 'ended',
      reason: 'fatal-error',
    });
    expect(tap()).toBe(true);
    expect(fakes.navigation.current()).toBe('stream');
    // The mark is on disk too, for the next cold start.
    const stored = fakes.kv.entries.get(STORE_KEYS.code('stream')) ?? '';
    expect(JSON.parse(stored)).toMatchObject({ stream: { tapToPair: true } });
    act(() => fakes.engine.send({ kind: 'reset' }));
    await flush();
    expect(tap()).toBe(true);
    act(() => pairCode(fakes.engine, code));
    await flush();
    expect(tap()).toBe(false);
  });

  it('leaves another code’s failure alone', async () => {
    const fakes = await shell({ saved: code, paired: other });
    act(() => fakes.engine.scene('fatal'));
    await flush();
    expect(savedOf(fakes)).toEqual(code);
  });

  it('changes nothing in the store with nothing saved, whatever native says', async () => {
    const fakes = await shell({ saved: null, paired: code });
    const forget = vi.spyOn(fakes.ports.modeStore, 'forget');
    const mark = vi.spyOn(fakes.ports.modeStore, 'markTapToPair');
    for (const say of [{ word: 'replaced' }, { word: 'taken' }] as const) {
      act(() => fakes.engine.hear(say));
      await flush();
    }
    act(() => fakes.engine.scene('fatal'));
    await flush();
    expect([forget.mock.calls.length, mark.mock.calls.length]).toEqual([0, 0]);
    expect(fakes.kv.entries.size).toBe(0);
  });

  it('acts on nothing for a saved code it cannot read', async () => {
    const unreadable = savedStreamCode({ raw: '{}' });
    const fakes = await shell({ saved: unreadable, paired: code });
    const forget = vi.spyOn(fakes.ports.modeStore, 'forget');
    act(() => fakes.engine.hear({ word: 'replaced' }));
    await flush();
    expect(forget).not.toHaveBeenCalled();
    expect(savedOf(fakes)).toEqual(unreadable);
  });

  it('records a refused write, and does not retry it for the same saved code', async () => {
    const fakes = await shell();
    vi.spyOn(fakes.kv, 'delete').mockRejectedValue(new Error('keystore locked'));
    act(() => fakes.engine.hear({ word: 'replaced' }));
    await flush(3_000);
    const refused = readRecord(fakes.record).filter(
      (entry) => entry.event === 'store.write-refused',
    );
    expect(refused.map((entry) => entry.fields)).toEqual([{ action: 'forget' }]);
  });
});

describe('useEngineFollow: the route follows a broadcast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves Home to /stream when a broadcast becomes held', async () => {
    const fakes = await shell();
    fakes.navigation.go('home');
    act(() => fakes.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(fakes.navigation.current()).toBe('stream');
  });

  it.each(['streamSettings', 'streamDiagnostics'] as const)(
    'leaves %s where it is: it is inside Live Stream already (M22)',
    async (route) => {
      const fakes = await shell();
      fakes.navigation.go(route);
      act(() => fakes.engine.hear({ word: 'go-live', cause: 'organiser' }));
      await flush();
      expect(fakes.navigation.current()).toBe(route);
    },
  );

  it('never moves Home to /stream for a pairing that is not on air', async () => {
    const fakes = await shell();
    fakes.navigation.go('home');
    await flush(3_000);
    expect(fakes.navigation.current()).toBe('home');
  });
});

/**
 * The sequence after the rule (TEST-STRATEGY: a second call): the code native
 * ended is scanned again from Home. Its fresh save is not the code native
 * named, though the snapshot still names that identity until native pairs it
 * again (native's `unpaired` lives as long as Idle does; Projection.kt).
 */
describe('useEngineFollow: the same code scanned again', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const launchPaired = () =>
    launchApp({ kvSeed: inStream(), prepare: (fakes) => pairCode(fakes.engine, code) });
  const expectPairedOnStream = (app: LaunchedApp) => {
    expect(app.nav.current()).toBe('stream');
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  };

  it('keeps the fresh save after an unasked unpair named the same code', async () => {
    const app = await launchPaired();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flushApp();
    expect(app.nav.current()).toBe('home');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    await scanFromHome(app, code.raw);
    await flushApp(3_000);
    expectPairedOnStream(app);
  });

  it('keeps the fresh save after the operator’s Stop named the same code', async () => {
    const app = await launchPaired();
    act(() => app.engine.send({ kind: 'start' }));
    await flushApp(5_000);
    act(() => app.engine.send({ kind: 'stop' }));
    await flushApp();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    act(() => screen.getByRole('button', { name: 'Home' }).click());
    await flushApp();
    expect(app.nav.current()).toBe('home');
    await scanFromHome(app, code.raw);
    await flushApp(3_000);
    expectPairedOnStream(app);
    expect(app.engine.intents.map((intent) => intent.kind).slice(-2)).toEqual(['reset', 'pair']);
  });
});
