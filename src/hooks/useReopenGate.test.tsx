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

    act(() => fakes.engine.forceState({ kind: 'ended', reason: 'hold-window-expired' }));
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
