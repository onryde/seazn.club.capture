import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import type { SessionState } from '@/domain/session/SessionState';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, readRecord, TEST_NOW } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

const code: SavedCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  slot: 2,
  savedAt: TEST_NOW,
  expiresAt: new Date(TEST_NOW.getTime() + 3600_000),
  venueTz: null,
};
const inStream = {
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(code),
};
const LIVE: SessionState = {
  kind: 'publishing',
  transport: 'srt',
  sinceEpochMs: TEST_NOW.getTime(),
};
const STOPPED: SessionState = { kind: 'ended', reason: 'operator-stopped' };
const FAILED: SessionState = { kind: 'ended', reason: 'fatal-error' };

async function leaveHook(options: Parameters<typeof createFakePorts>[0] = {}) {
  const fakes = createFakePorts({ kvSeed: inStream, ...options });
  const hook = renderHook(() => useStreamLeave(), { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  return { ...fakes, hook };
}

describe('useStreamLeave', () => {
  it('leaves for Home and keeps the code while nothing is live', async () => {
    const leaving = await leaveHook();
    act(() => leaving.hook.result.current.leave());
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(leaving.kv.entries.has(STORE_KEYS.active)).toBe(false);
  });

  it('leaves for Home while armed, keeping the code and the armed session', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState({ kind: 'armed' }));
    act(() => leaving.hook.result.current.leave());
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    // Armed is free to leave (decision 5): the engine is not told anything.
    expect(leaving.engine.getSnapshot().state).toEqual({ kind: 'armed' });
  });

  it('cannot be left on air: Home is hidden and Back explains', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState(LIVE));
    expect(leaving.hook.result.current.canLeave).toBe(false);
    let handled = false;
    act(() => {
      handled = leaving.back.press();
    });
    expect(handled).toBe(true);
    expect(leaving.hook.result.current.blocked).toBe(true);
    expect(leaving.navigation.current()).toBe('stream');
  });

  it('forgets the code when leaving after the broadcast stopped', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState(STOPPED));
    act(() => {
      leaving.back.press();
    });
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('keeps the code when the broadcast failed, so the operator can go straight back', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState(FAILED));
    act(() => {
      leaving.back.press();
    });
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    // D11: the failed session is cleared, so Continue re-arms rather than landing on Ended.
    expect(leaving.engine.getSnapshot().state).toEqual({ kind: 'idle' });
  });

  it('clears the on-air message once the broadcast is over', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState(LIVE));
    act(() => {
      leaving.back.press();
    });
    act(() => leaving.engine.forceState(STOPPED));
    expect(leaving.hook.result.current.blocked).toBe(false);
    expect(leaving.hook.result.current.canLeave).toBe(true);
  });

  // Reachable with nothing saved. Armed: the reopen gate sends an armed or live
  // engine here whatever is saved (reopen.ts). Stopped: a stopped leave that was
  // cancelled on air had already forgotten the code, and then the broadcast stops.
  it.each<[string, SessionState]>([
    ['armed', { kind: 'armed' }],
    ['stopped', STOPPED],
  ])('leaves for Home with nothing saved while %s', async (_, state) => {
    const leaving = await leaveHook({ kvSeed: {} });
    act(() => leaving.engine.forceState(state));
    act(() => leaving.hook.result.current.leave());
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.size).toBe(0);
    expect(readRecord(leaving.record)).toEqual([]);
  });

  // Back inside a stream sub-screen (Settings, Diagnostics) is the navigator's,
  // not a leave. `home` stands in for them until Route gains them.
  it.each<[string, SessionState | null]>([
    ['nothing is live', null],
    ['the broadcast is on air', LIVE],
    ['the broadcast stopped', STOPPED],
    ['the broadcast failed', FAILED],
  ])('leaves Back to the navigator off the stream route when %s', async (_, state) => {
    const modeStore = createModeStore(createMemoryKeyValueStore(inStream));
    const setActive = vi.spyOn(modeStore, 'setActive');
    const forget = vi.spyOn(modeStore, 'forget');
    const leaving = await leaveHook({ modeStore });
    const send = vi.spyOn(leaving.engine, 'send');
    if (state !== null) act(() => leaving.engine.forceState(state));
    leaving.navigation.go('home');
    let handled = true;
    act(() => {
      handled = leaving.back.press();
    });
    await act(async () => undefined);
    expect(handled).toBe(false);
    expect(leaving.hook.result.current.blocked).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(leaving.navigation.history).toEqual(['stream', 'home']);
  });
});

describe('useStreamLeave: the next code after a stop (I1)', () => {
  it('keeps a code opened after the last broadcast was stopped', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState(STOPPED));
    act(() => {
      leaving.back.press();
    });
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    // The spent session is cleared, so it cannot spend the next code too.
    expect(leaving.engine.getSnapshot().state).toEqual({ kind: 'idle' });

    const next: SavedCode = { ...code, raw: '{"fake":"next"}', slot: 5 };
    await act(() => leaving.ports.modeStore.open(next));
    leaving.navigation.go('stream');
    act(() => {
      leaving.back.press();
    });
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.get(STORE_KEYS.code('stream'))).toBe(encodeSavedCode(next));
  });
});

describe('useStreamLeave: a refused write still leaves (R30)', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  /** Reads always work; every write throws, as a locked Keystore does. */
  function refusingStore() {
    const memory = createMemoryKeyValueStore(inStream);
    const refuse = () => Promise.reject(new Error('keystore locked'));
    const kv: KeyValueStore = { get: memory.get, set: refuse, delete: refuse };
    return createModeStore(kv);
  }

  it.each([
    ['nothing is live (clears the active mode)', null],
    ['the broadcast stopped (forgets the code)', STOPPED],
  ])('a refused write still goes Home when %s', async (_, state) => {
    const leaving = await leaveHook({ modeStore: refusingStore() });
    if (state !== null) act(() => leaving.engine.forceState(state));
    act(() => {
      leaving.back.press();
    });
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    await act(async () => undefined);
    expect(rejections).toEqual([]);
    expect(readRecord(leaving.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'leave' } }),
    );
  });

  it('leaves again after a refused write', async () => {
    const modeStore = refusingStore();
    const setActive = vi.spyOn(modeStore, 'setActive');
    const leaving = await leaveHook({ modeStore });
    act(() => leaving.hook.result.current.leave());
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    leaving.navigation.go('stream');
    act(() => leaving.hook.result.current.leave());
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(setActive).toHaveBeenCalledTimes(2);
  });
});

describe('useStreamLeave: one leave at a time', () => {
  /** Writes wait until `release()`, so a second leave lands while the first is pending. */
  function slowStore() {
    const memory = createMemoryKeyValueStore(inStream);
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const kv: KeyValueStore = {
      get: memory.get,
      set: async (key, value) => gate.then(() => memory.set(key, value)),
      delete: async (key) => gate.then(() => memory.delete(key)),
    };
    return { modeStore: createModeStore(kv), release: () => release() };
  }

  it('stays when a free leave finds the engine live once its write settles (T14 M2)', async () => {
    const { modeStore, release } = slowStore();
    const leaving = await leaveHook({ modeStore });
    act(() => leaving.hook.result.current.leave());
    act(() => leaving.engine.forceState(LIVE));
    release();
    await waitFor(() => expect(leaving.hook.result.current.blocked).toBe(true));
    expect(leaving.navigation.current()).toBe('stream');
  });

  it('releases a leave cancelled on air, so the next leave goes once the broadcast stops (T14 M2)', async () => {
    const { modeStore, release } = slowStore();
    const leaving = await leaveHook({ modeStore });
    act(() => leaving.hook.result.current.leave());
    act(() => leaving.engine.forceState(LIVE));
    release();
    await waitFor(() => expect(leaving.hook.result.current.blocked).toBe(true));
    act(() => leaving.engine.forceState(STOPPED));
    act(() => leaving.hook.result.current.leave());
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
  });

  it('forgets once and goes Home once when Back and Home land together', async () => {
    const { modeStore, release } = slowStore();
    const forget = vi.spyOn(modeStore, 'forget');
    const leaving = await leaveHook({ modeStore });
    const go = vi.spyOn(leaving.navigation, 'go');
    act(() => leaving.engine.forceState(STOPPED));
    act(() => {
      leaving.back.press();
    });
    act(() => leaving.hook.result.current.leave());
    act(() => {
      leaving.back.press();
    });
    release();
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(forget).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('clears no armed session that arrived while the stopped leave was saving (I1)', async () => {
    const { modeStore, release } = slowStore();
    const leaving = await leaveHook({ modeStore });
    const send = vi.spyOn(leaving.engine, 'send');
    act(() => leaving.engine.forceState(STOPPED));
    act(() => {
      leaving.back.press();
    });
    act(() => leaving.engine.forceState({ kind: 'armed' }));
    release();
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(send).not.toHaveBeenCalled();
  });

  it('clears no session that stopped while a free leave was saving: its code was kept (I1)', async () => {
    const { modeStore, release } = slowStore();
    const forget = vi.spyOn(modeStore, 'forget');
    const leaving = await leaveHook({ modeStore });
    const send = vi.spyOn(leaving.engine, 'send');
    act(() => leaving.engine.forceState({ kind: 'armed' }));
    act(() => leaving.hook.result.current.leave());
    act(() => leaving.engine.forceState(STOPPED));
    release();
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(forget).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(leaving.engine.getSnapshot().state).toEqual(STOPPED);
  });

  it('stays on Live Stream when the broadcast went live while the leave was saving (T14 M2)', async () => {
    const { modeStore, release } = slowStore();
    const leaving = await leaveHook({ modeStore });
    const send = vi.spyOn(leaving.engine, 'send');
    act(() => leaving.engine.forceState(STOPPED));
    act(() => {
      leaving.back.press();
    });
    act(() => leaving.engine.forceState(LIVE));
    release();
    await waitFor(() => expect(leaving.hook.result.current.blocked).toBe(true));
    expect(leaving.navigation.current()).toBe('stream');
    expect(send).not.toHaveBeenCalled();
    expect(readRecord(leaving.record)).toContainEqual(
      expect.objectContaining({
        event: 'leave.cancelled-on-air',
        fields: { action: 'freeAndForget' },
      }),
    );
  });

  it('keeps Back handled while the first leave is still saving', async () => {
    const { modeStore, release } = slowStore();
    const leaving = await leaveHook({ modeStore });
    act(() => {
      leaving.back.press();
    });
    let handled = false;
    act(() => {
      handled = leaving.back.press();
    });
    expect(handled).toBe(true);
    release();
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
  });

  it('leaves once the broadcast stops after Back was refused on air', async () => {
    const leaving = await leaveHook();
    act(() => leaving.engine.forceState(LIVE));
    act(() => {
      leaving.back.press();
    });
    act(() => leaving.engine.forceState(STOPPED));
    act(() => {
      leaving.back.press();
    });
    await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
    expect(leaving.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });
});
