import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { useReopenGate } from '@/hooks/useReopenGate';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, TEST_NOW } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

const EXPIRY = new Date(TEST_NOW.getTime() + 3600_000);
const code: SavedCode = savedStreamCode({
  raw: '{}',
  slot: 0,
  savedAt: TEST_NOW,
  expiresAt: EXPIRY,
});
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
  it('reopens into Live Stream while its code is valid, then hides the splash', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    expect(fakes.splash.hides).toBe(1);
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

  it('follows the engine over the store', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'armed' });
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

  it('checks again on every return to the foreground, against the current clock', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
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

    act(() =>
      fakes.engine.forceState({ kind: 'ended', reason: 'hold-window-expired', durationMs: null }),
    );
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

  it.each(['stopped', 'stopped-by-organiser', 'fatal'] as const)(
    'clears a %s session once its code expired while the app was away',
    async (scene) => {
      const fakes = createFakePorts({ kvSeed: inStream });
      fakes.engine.scene(scene);
      gate(fakes);
      // Its Ended screen while the code is valid: nothing cleared.
      await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
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
    ['armed', 'armed-ready'],
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
    ['streamDiagnostics', 'the engine armed', 'armed-ready'],
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

  it('still leaves a sub-screen for Home once the code has expired', async () => {
    const fakes = createFakePorts({ kvSeed: inStream });
    gate(fakes);
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    fakes.navigation.go('streamDiagnostics');
    fakes.setNow(new Date(EXPIRY.getTime() + 60_000));
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('home'));
    expect(noticeOf(fakes)).toMatchObject({ mode: 'stream', expiredAt: EXPIRY });
  });
});
