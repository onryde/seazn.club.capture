import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { createStreamSettingsStore, SETTINGS_KEY } from '@/services/streamSettingsStore';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

/** A keystore that refuses the first write and takes every one after. */
function refusingOnce(): KeyValueStore {
  const kv = createMemoryKeyValueStore();
  let refused = false;
  return {
    get: kv.get,
    delete: kv.delete,
    set: (key, value) => {
      if (refused) return kv.set(key, value);
      refused = true;
      return Promise.reject(new Error('keystore locked'));
    },
  };
}

describe('useStreamSettings (D23)', () => {
  it('starts on the defaults, then shows what was saved once it loads', async () => {
    const fakes = createFakePorts({
      kvSeed: { [SETTINGS_KEY]: '{"v":1,"overlay":false,"side":"left"}' },
    });
    const { result } = renderHook(() => useStreamSettings(), { wrapper: wrapperFor(fakes) });
    expect(result.current.settings).toEqual({ overlay: true, side: 'right' });
    await waitFor(() => expect(result.current.settings).toEqual({ overlay: false, side: 'left' }));
    expect(result.current.saveFailed).toBe(false);
  });

  it('applies a change at once and saves it, with nothing failed', async () => {
    const fakes = createFakePorts();
    const { result } = renderHook(() => useStreamSettings(), { wrapper: wrapperFor(fakes) });
    act(() => result.current.change({ side: 'left' }));
    expect(result.current.settings.side).toBe('left');
    await waitFor(() =>
      expect(fakes.kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":true,"side":"left"}'),
    );
    expect(result.current.saveFailed).toBe(false);
  });

  it('says a refused change held for this session only, until a later one saves', async () => {
    const record = createRingRecord();
    const streamSettings = createStreamSettingsStore(
      refusingOnce(),
      createLogger({ record, now: () => 0 }),
    );
    const fakes = createFakePorts({ streamSettings });
    const { result } = renderHook(() => useStreamSettings(), { wrapper: wrapperFor(fakes) });
    act(() => result.current.change({ overlay: false }));
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(result.current.settings.overlay).toBe(false);
    act(() => result.current.change({ side: 'left' }));
    await waitFor(() => expect(result.current.saveFailed).toBe(false));
  });

  it('reads the saved settings once, even when the effect runs twice (StrictMode)', async () => {
    const fakes = createFakePorts();
    const get = vi.spyOn(fakes.kv, 'get');
    renderHook(() => useStreamSettings(), { wrapper: wrapperFor(fakes), reactStrictMode: true });
    await waitFor(() => expect(get).toHaveBeenCalledWith(SETTINGS_KEY));
    expect(get.mock.calls.filter(([key]) => key === SETTINGS_KEY)).toHaveLength(1);
  });
});
