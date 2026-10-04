import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import type { PairIntent } from '@/engine/CaptureEnginePort';
import { useEngineFollow } from '@/hooks/useEngineFollow';
import { useReopenGate } from '@/hooks/useReopenGate';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createStreamSettingsStore, SETTINGS_KEY } from '@/services/streamSettingsStore';
import { createFakePorts, readRecord, TEST_NOW } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { FIXTURE_CODE } from '../../test/fixtures/wire';
import { heldReads } from '../../test/heldReads';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

const EXPIRY = new Date(TEST_NOW.getTime() + 3600_000);
/** A readable code: the cold-start re-pair needs its name (amendment, Process death and reopen). */
const code: SavedCode = savedStreamCode({ savedAt: TEST_NOW, expiresAt: EXPIRY });
const inStream = {
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(code),
};

function noticeOf(fakes: ReturnType<typeof createFakePorts>) {
  const snapshot = fakes.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? snapshot.notice : undefined;
}

function gate(fakes: ReturnType<typeof createFakePorts>, navigatorReady = true) {
  return renderHook(({ ready }) => useReopenGate(ready), {
    initialProps: { ready: navigatorReady },
    wrapper: wrapperFor(fakes),
  });
}

describe('useReopenGate', () => {
  it('reopens into Live Stream while its code is valid, re-paired, then hides the splash', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    expect(fakes.splash.hides).toBe(1);
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
  });

  it('lands on Home with a notice once the code has expired', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    fakes.setNow(new Date(EXPIRY.getTime() + 1));
    gate(fakes);
    await waitFor(() => expect(fakes.splash.hides).toBe(1));
    expect(fakes.navigation.current()).toBe('home');
    const snapshot = fakes.ports.modeStore.getSnapshot();
    expect(snapshot.status === 'ready' && snapshot.notice).toEqual({
      mode: 'stream',
      expiredAt: EXPIRY,
      venueTz: 'Europe/London',
    });
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  // The store says no mode is active; the engine is paired with the kept code.
  it('follows the engine over the store', async () => {
    const fakes = createFakePorts({
      kvSeed: { [STORE_KEYS.code('stream')]: encodeSavedCode(code) },
    });
    fakes.engine.forceState({ kind: 'paired' });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  it('follows a broadcast even with nothing saved', async () => {
    const fakes = createFakePorts();
    fakes.engine.scene('live');
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  it('waits for the navigator before moving', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    const { rerender } = gate(fakes, false);
    await act(() => fakes.ports.modeStore.load());
    expect(fakes.navigation.history).toEqual([]);
    expect(fakes.splash.hides).toBe(0);
    rerender({ ready: true });
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  // A paired engine keeps its expired code (R23), so native has let it go here.
  it('checks again on every return to the foreground, against the current clock', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    act(() => fakes.engine.forceState({ kind: 'idle' }));
    fakes.setNow(new Date(EXPIRY.getTime() + 60_000));
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('home'));
    expect(fakes.splash.hides).toBe(1);
  });
});

describe('useReopenGate: beyond the happy path', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  it('does not re-render its host when the store publishes without a status change', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        useReopenGate(true);
      },
      { wrapper: wrapperFor(fakes) },
    );
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    const settled = renders;
    await act(() => fakes.ports.modeStore.setActive(null));
    act(() => fakes.ports.modeStore.dismissNotices());
    expect(renders).toBe(settled);
  });

  it('never expires the code the engine is holding, and names it once the engine lets go (R23)', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    act(() =>
      fakes.engine.forceState({
        kind: 'publishing',
        transport: 'srt',
        sinceEpochMs: TEST_NOW.getTime(),
      }),
    );
    fakes.setNow(new Date(EXPIRY.getTime() + 60_000));
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(fakes.navigation.current()).toBe('stream');
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(fakes.kv.entries.get(STORE_KEYS.active)).toBe('stream');
    expect(noticeOf(fakes)).toBeNull();

    act(() => fakes.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('home'));
    expect(noticeOf(fakes)).toEqual({
      mode: 'stream',
      expiredAt: EXPIRY,
      venueTz: 'Europe/London',
    });
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('does not move on a return to the foreground before the navigator is ready', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes, false);
    await act(() => fakes.ports.modeStore.load());
    act(() => fakes.foreground.fire());
    expect(fakes.navigation.history).toEqual([]);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  it('names the expiry on Home even when the phone refuses the delete; the next launch re-expires it (R21)', async () => {
    const memory = createMemoryKeyValueStore(inStream);
    let refuse = true;
    const kv: KeyValueStore = {
      ...memory,
      delete: (key) => (refuse ? Promise.reject(new Error('keystore locked')) : memory.delete(key)),
    };
    const launch = () => {
      const fakes = createFakePorts({ modeStore: createModeStore(kv) });
      fakes.setNow(new Date(EXPIRY.getTime() + 1));
      gate(fakes);
      return fakes;
    };
    const first = launch();
    await waitFor(() => expect(first.splash.hides).toBe(1));
    expect(first.navigation.current()).toBe('home');
    expect(noticeOf(first)).toEqual({
      mode: 'stream',
      expiredAt: EXPIRY,
      venueTz: 'Europe/London',
    });
    expect(memory.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    await act(async () => undefined);
    expect(rejections).toEqual([]);

    refuse = false;
    const second = launch();
    await waitFor(() => expect(memory.entries.has(STORE_KEYS.code('stream'))).toBe(false));
    expect(noticeOf(second)).toEqual({
      mode: 'stream',
      expiredAt: EXPIRY,
      venueTz: 'Europe/London',
    });
    expect(second.navigation.current()).toBe('home');
  });
});

/**
 * N4 (owner-visible): a session that ended under a code the phone no longer
 * holds has no screen left to show it on. Sent Home, the gate clears it, so
 * the next code scanned never opens on the old Ended screen.
 */
describe('useReopenGate: an ended session whose code is gone (N4)', () => {
  const kinds = (fakes: ReturnType<typeof createFakePorts>) =>
    fakes.engine.intents.map((intent) => intent.kind);

  // Task 24: a failure keeps its Ended screen; the operator's Stop goes Home (reopenTarget).
  it.each([
    ['stopped', 'home'],
    ['fatal', 'stream'],
  ] as const)(
    'clears a %s session once its code expired while the app was away',
    async (scene, landing) => {
      const fakes = createFakePorts({ kvSeed: inStream });
      fakes.engine.scene(scene);
      gate(fakes);
      // While the code is valid: nothing cleared.
      await waitFor(() => expect(fakes.splash.hides).toBe(1));
      expect(fakes.navigation.current()).toBe(landing);
      expect(kinds(fakes)).toEqual([]);
      fakes.setNow(new Date(EXPIRY.getTime() + 60_000));
      act(() => fakes.foreground.fire());
      await waitFor(() => expect(fakes.navigation.current()).toBe('home'));
      expect(noticeOf(fakes)).toMatchObject({ mode: 'stream', expiredAt: EXPIRY });
      expect(kinds(fakes)).toEqual(['reset']);
      expect(fakes.engine.getSnapshot().state).toEqual({ kind: 'idle' });
    },
  );

  it('clears an ended session found at launch with no code saved', async () => {
    const fakes = createFakePorts();
    fakes.engine.scene('stopped');
    gate(fakes);
    await waitFor(() => expect(fakes.splash.hides).toBe(1));
    expect(fakes.navigation.current()).toBe('home');
    expect(kinds(fakes)).toEqual(['reset']);
  });

  // A kept code still owns its Ended screen: Continue opens it, truthfully.
  it('keeps an ended session whose code is still saved, though not active', async () => {
    const fakes = createFakePorts({
      kvSeed: { [STORE_KEYS.code('stream')]: encodeSavedCode(code) },
    });
    fakes.engine.scene('stopped');
    gate(fakes);
    await waitFor(() => expect(fakes.splash.hides).toBe(1));
    expect(fakes.navigation.current()).toBe('home');
    expect(kinds(fakes)).toEqual([]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
  });

  it.each([
    ['idle', null],
    ['paired', 'paired-ready'],
    ['live', 'live'],
  ] as const)('never clears an engine that is %s', async (_, scene) => {
    const fakes = createFakePorts({ kvSeed: inStream });
    if (scene !== null) fakes.engine.scene(scene);
    fakes.setNow(new Date(EXPIRY.getTime() + 60_000));
    gate(fakes);
    await waitFor(() => expect(fakes.splash.hides).toBe(1));
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(kinds(fakes)).toEqual([]);
  });
});

/**
 * M22: Settings and Diagnostics are inside Live Stream (AGENTS §6). A return
 * to the foreground that lands on Live Stream leaves the operator where they
 * were, never popping them back to the camera.
 */
describe('useReopenGate: inside Live Stream already (M22)', () => {
  it.each([
    ['streamSettings', 'a valid code', null],
    ['streamDiagnostics', 'a valid code', null],
    ['streamSettings', 'the engine on air', 'live'],
    ['streamDiagnostics', 'the engine paired', 'paired-ready'],
  ] as const)('stays on %s with %s', async (route, _, scene) => {
    const fakes = createFakePorts({ kvSeed: inStream });
    if (scene !== null) fakes.engine.scene(scene);
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    fakes.navigation.go(route);
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(fakes.navigation.current()).toBe(route);
    expect(fakes.navigation.history).toEqual(['stream', route]);
  });

  // A paired engine keeps its expired code (R23), so native has let it go here.
  it('still leaves a sub-screen for Home once the code has expired', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    act(() => fakes.engine.forceState({ kind: 'idle' }));
    fakes.navigation.go('streamDiagnostics');
    fakes.setNow(new Date(EXPIRY.getTime() + 60_000));
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('home'));
    expect(noticeOf(fakes)).toMatchObject({ mode: 'stream', expiredAt: EXPIRY });
  });
});

/**
 * The amendment's _Process death and reopen_ and _What the operator sees after
 * a cold-start reopen_: JS re-pairs once, at cold start, with claim `resume`,
 * when it finds the engine Idle; a foreground never pairs.
 */
describe('useReopenGate: the cold-start re-pair', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const flush = (ms = 10) => act(() => vi.advanceTimersByTimeAsync(ms));
  const pairs = (fakes: ReturnType<typeof createFakePorts>) =>
    fakes.engine.intents.filter((intent): intent is PairIntent => intent.kind === 'pair');
  /** Shell's two hooks, in its order. */
  async function shell(fakes: ReturnType<typeof createFakePorts>) {
    renderHook(
      () => {
        useReopenGate(true);
        useEngineFollow();
      },
      { wrapper: wrapperFor(fakes) },
    );
    await flush();
  }

  it('re-pairs an Idle engine once, with claim resume, and opens /stream', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    await shell(fakes);
    expect(pairs(fakes)).toEqual([
      expect.objectContaining({ code: FIXTURE_CODE, slot: 1, claim: 'resume' }),
    ]);
    expect(fakes.navigation.current()).toBe('stream');
    expect(readRecord(fakes.record).filter((entry) => entry.event === 'intent.pair')).toEqual([
      expect.objectContaining({ fields: { action: 'pair', claim: 'resume', slot: 1 } }),
    ]);
  });

  it('goes Home, the code forgotten, when the claim answers replaced; and never pairs again', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    await shell(fakes);
    act(() => fakes.engine.hear({ word: 'replaced' }));
    await flush();
    expect(fakes.navigation.current()).toBe('home');
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    act(() => fakes.foreground.fire());
    await flush(3_000);
    expect(pairs(fakes)).toHaveLength(1);
  });

  // The permission dialog closing reads as a foreground: it must never pair.
  it('sends no pair at a foreground that finds the engine Idle, and goes Home', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    await shell(fakes);
    act(() => fakes.engine.forceState({ kind: 'idle' }));
    act(() => fakes.foreground.fire());
    await flush();
    expect(pairs(fakes)).toHaveLength(1);
    expect(fakes.navigation.current()).toBe('home');
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  const marked = savedStreamCode({
    savedAt: TEST_NOW,
    expiresAt: EXPIRY,
    stream: { ...(code.stream ?? fail()), tapToPair: true },
  });
  // `kept`: whether the stream code is still saved once the gate and the
  // follow have both run. An expired code goes with its notice; one native's
  // `unpaired` names is forgotten by the follow (M-1: heard at cold start).
  it.each<
    [string, Record<string, string>, (fakes: ReturnType<typeof createFakePorts>) => void, boolean]
  >([
    [
      'the code is tapToPair',
      { [STORE_KEYS.active]: 'stream', [STORE_KEYS.code('stream')]: encodeSavedCode(marked) },
      () => undefined,
      true,
    ],
    [
      'another mode is active',
      { [STORE_KEYS.active]: 'scoring', [STORE_KEYS.code('stream')]: encodeSavedCode(code) },
      () => undefined,
      true,
    ],
    ['the code expired', inStream, (fakes) => fakes.setNow(new Date(EXPIRY.getTime() + 1)), false],
    [
      'the snapshot’s unpaired names it',
      inStream,
      (fakes) => {
        pairCode(fakes.engine, code);
        fakes.engine.hear({ word: 'taken' });
      },
      false,
    ],
    [
      'the saved code cannot be read',
      {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode({ ...code, raw: '{}' }),
      },
      () => undefined,
      true,
    ],
  ])('sends no pair at cold start when %s, and goes Home', async (_why, kvSeed, prepare, kept) => {
    const fakes = createFakePorts({ kvSeed });
    prepare(fakes);
    const before = pairs(fakes).length;
    await shell(fakes);
    expect(pairs(fakes)).toHaveLength(before);
    expect(fakes.navigation.current()).toBe('home');
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(kept);
  });

  // A JS reload while native lived: the engine is the authority.
  it('sends no pair at cold start when the engine is already paired, and opens /stream', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    pairCode(fakes.engine, code);
    await shell(fakes);
    expect(pairs(fakes)).toHaveLength(1);
    expect(fakes.navigation.current()).toBe('stream');
  });

  // Task 30 (review M12): the cold-start `pair` carries the saved switch, not the default.
  it('waits for the saved switch before the cold-start pair, then carries it', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    const held = heldReads(createMemoryKeyValueStore({ [SETTINGS_KEY]: SWITCH_OFF }));
    const ports = {
      ...fakes,
      ports: {
        ...fakes.ports,
        streamSettings: createStreamSettingsStore(held.store, fakes.ports.logger),
      },
    };
    await shell(ports);
    await flush(1_000);
    expect(pairs(fakes)).toEqual([]);
    expect(fakes.splash.hides).toBe(0);
    await act(async () => held.release());
    await flush();
    expect(pairs(fakes)).toEqual([expect.objectContaining({ claim: 'resume', automatic: false })]);
    expect(fakes.splash.hides).toBe(1);
  });
});

/** The switch saved off, as Settings writes it (v2, A4). */
const SWITCH_OFF = '{"v":2,"overlay":true,"side":"right","automatic":false}';

function fail(): never {
  throw new Error('the fixture has a stream part');
}
