import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { StreamPlaceholderScreen } from '@/ui/screens/StreamPlaceholderScreen';
import { TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

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

async function renderStream(options: Parameters<typeof renderWithPorts>[1] = {}) {
  const view = renderWithPorts(<StreamPlaceholderScreen />, { kvSeed: inStream, ...options });
  await act(() => view.ports.modeStore.load());
  view.navigation.go('stream');
  return view;
}

describe('Live Stream placeholder', () => {
  it('shows the slot from the scanned code', async () => {
    await renderStream();
    expect(screen.getByText('Slot 2. The camera arrives in the next build.')).toBeTruthy();
  });

  it('leaves for Home and keeps the code while nothing is live', async () => {
    const view = await renderStream();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(view.kv.entries.has(STORE_KEYS.active)).toBe(false);
  });

  it('leaves for Home while armed, keeping the code and the armed session', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState({ kind: 'armed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    // Armed is free to leave (decision 5): the engine is not told anything.
    expect(view.engine.getSnapshot().state).toEqual({ kind: 'armed' });
  });

  it('cannot be left on air: Home is hidden and Back explains', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState(LIVE));
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    expect(view.navigation.current()).toBe('stream');
  });

  it('forgets the code when leaving after the broadcast stopped', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState(STOPPED));
    act(() => {
      view.back.press();
    });
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('keeps the code when the broadcast failed, so the operator can go straight back', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState({ kind: 'ended', reason: 'fatal-error' }));
    act(() => {
      view.back.press();
    });
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  it('clears the on-air message once the broadcast is over', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState(LIVE));
    act(() => {
      view.back.press();
    });
    act(() => view.engine.forceState(STOPPED));
    expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
  });

  it('drives the fake engine from the development controls', async () => {
    await renderStream();
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.getByText('Engine: live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Engine: stopped')).toBeTruthy();
  });

  it('has no engine controls outside development builds', async () => {
    await renderStream({ devTools: false, devEngine: null });
    expect(screen.queryByText('Fake engine (development only)')).toBeNull();
  });
});

describe('Live Stream placeholder: the next code after a stop (I1)', () => {
  it('keeps a code opened after the last broadcast was stopped', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState(STOPPED));
    act(() => {
      view.back.press();
    });
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    // The spent session is cleared, so it cannot spend the next code too.
    expect(view.engine.getSnapshot().state).toEqual({ kind: 'idle' });

    const next: SavedCode = { ...code, raw: '{"fake":"next"}', slot: 5 };
    await act(() => view.ports.modeStore.open(next));
    view.navigation.go('stream');
    act(() => {
      view.back.press();
    });
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.get(STORE_KEYS.code('stream'))).toBe(encodeSavedCode(next));
  });
});

describe('Live Stream placeholder: the four questions', () => {
  it('says there is no slot when the engine holds a session with nothing saved', async () => {
    // Reachable: the reopen gate sends an armed or live engine here whatever is saved.
    await renderStream({ kvSeed: {} });
    expect(screen.getByText('Slot –. The camera arrives in the next build.')).toBeTruthy();
  });

  it('speaks the operator’s language', async () => {
    await renderStream({ deviceLanguages: ['fr'] });
    expect(
      screen.getByText('Emplacement 2. La caméra arrive dans la prochaine version.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accueil' })).toBeTruthy();
  });

  // Production sets both from __DEV__; each guard is pinned alone so neither hides the other.
  it.each([
    ['development tools are off', { devTools: false }],
    ['there is no fake engine', { devEngine: null }],
  ])('has no engine controls when %s', async (_, options) => {
    await renderStream(options);
    expect(screen.queryByText('Fake engine (development only)')).toBeNull();
  });
});

describe('Live Stream placeholder: a refused write still leaves (R30)', () => {
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
    const view = await renderStream({ modeStore: refusingStore() });
    if (state !== null) act(() => view.engine.forceState(state));
    act(() => {
      view.back.press();
    });
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    await act(async () => undefined);
    expect(rejections).toEqual([]);
  });

  it('leaves again after a refused write', async () => {
    const modeStore = refusingStore();
    const setActive = vi.spyOn(modeStore, 'setActive');
    const view = await renderStream({ modeStore });
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    view.navigation.go('stream');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(setActive).toHaveBeenCalledTimes(2);
  });
});

describe('Live Stream placeholder: one leave at a time', () => {
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

  it('forgets once and goes Home once when Back and Home land together', async () => {
    const { modeStore, release } = slowStore();
    const forget = vi.spyOn(modeStore, 'forget');
    const view = await renderStream({ modeStore });
    const go = vi.spyOn(view.navigation, 'go');
    act(() => view.engine.forceState(STOPPED));
    act(() => {
      view.back.press();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    act(() => {
      view.back.press();
    });
    release();
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(forget).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('keeps Back handled while the first leave is still saving', async () => {
    const { modeStore, release } = slowStore();
    const view = await renderStream({ modeStore });
    act(() => {
      view.back.press();
    });
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    release();
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
  });

  it('leaves once the broadcast stops after Back was refused on air', async () => {
    const view = await renderStream();
    act(() => view.engine.forceState(LIVE));
    act(() => {
      view.back.press();
    });
    act(() => view.engine.forceState(STOPPED));
    act(() => {
      view.back.press();
    });
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });
});
