import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { KV_TIMEOUT_MS, withTimeout } from '@/services/kvTimeout';
import { createLogger } from '@/services/logger';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createRingRecord } from '@/services/sessionRecord';

const code: SavedCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  slot: 0,
  savedAt: new Date('2026-10-03T13:00:00Z'),
  expiresAt: new Date('2026-10-03T18:40:00Z'),
  venueTz: null,
};

const ready = (store: ReturnType<typeof createModeStore>) => {
  const snapshot = store.getSnapshot();
  if (snapshot.status !== 'ready') throw new Error('store not loaded');
  return snapshot;
};

const relaunch = async (kv: KeyValueStore) => {
  const store = createModeStore(kv);
  await store.load();
  return ready(store).saved;
};

describe('modeStore', () => {
  it('is loading until load() finishes', async () => {
    const store = createModeStore(createMemoryKeyValueStore());
    expect(store.getSnapshot()).toEqual({ status: 'loading' });
    await store.load();
    expect(ready(store).saved).toEqual({ active: null, codes: {} });
  });

  it('reads back what was saved', async () => {
    const kv = createMemoryKeyValueStore({
      [STORE_KEYS.active]: 'stream',
      [STORE_KEYS.code('stream')]: encodeSavedCode(code),
    });
    const store = createModeStore(kv);
    await store.load();
    expect(ready(store).saved).toEqual({ active: 'stream', codes: { stream: code } });
  });

  it('deletes an unreadable record and says so, rather than crashing', async () => {
    const kv = createMemoryKeyValueStore({
      [STORE_KEYS.active]: 'stream',
      [STORE_KEYS.code('stream')]: '{"v":99}',
    });
    const store = createModeStore(kv);
    await store.load();
    expect(ready(store).saved.codes).toEqual({});
    expect(ready(store).dropped).toBe(true);
    expect(kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(ready(store).saved.active).toBeNull();
    store.dismissNotices();
    expect(ready(store).dropped).toBe(false);
  });

  it('lands on nothing saved, rather than hanging, when storage cannot be read', async () => {
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error('keystore unavailable')),
      set: () => Promise.reject(new Error('keystore unavailable')),
      delete: () => Promise.reject(new Error('keystore unavailable')),
    };
    const store = createModeStore(broken);
    const listener = vi.fn();
    store.subscribe(listener);
    await expect(store.load()).resolves.toBeUndefined();
    expect(ready(store).saved).toEqual({ active: null, codes: {} });
    expect(ready(store).dropped).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('keeps a good code through a read that fails once', async () => {
    const backing = createMemoryKeyValueStore({
      [STORE_KEYS.active]: 'stream',
      [STORE_KEYS.code('stream')]: encodeSavedCode(code),
    });
    const flaky: KeyValueStore = { ...backing, get: () => Promise.reject(new Error('busy')) };
    await createModeStore(flaky).load();
    expect(await relaunch(backing)).toEqual({ active: 'stream', codes: { stream: code } });
  });

  it('drops a record filed under another mode', async () => {
    const kv = createMemoryKeyValueStore({ [STORE_KEYS.code('scoring')]: encodeSavedCode(code) });
    const store = createModeStore(kv);
    await store.load();
    expect(ready(store).saved.codes).toEqual({});
    expect(ready(store).dropped).toBe(true);
  });

  it('open() saves the code and makes its mode active', async () => {
    const kv = createMemoryKeyValueStore();
    const store = createModeStore(kv);
    await store.load();
    await store.open(code);
    expect(ready(store).saved).toEqual({ active: 'stream', codes: { stream: code } });
    expect(kv.entries.get(STORE_KEYS.active)).toBe('stream');
  });

  it('forget() removes the code and leaves the mode', async () => {
    const store = createModeStore(createMemoryKeyValueStore());
    await store.load();
    await store.open(code);
    await store.forget('stream');
    expect(ready(store).saved).toEqual({ active: null, codes: {} });
  });

  it('expire() removes codes and records the notice until dismissed', async () => {
    const store = createModeStore(createMemoryKeyValueStore());
    await store.load();
    await store.open(code);
    const notice = { mode: 'stream' as const, expiredAt: code.expiresAt as Date };
    await store.expire(['stream'], notice);
    expect(ready(store).saved.codes).toEqual({});
    expect(ready(store).notice).toEqual(notice);
    store.dismissNotices();
    expect(ready(store).notice).toBeNull();
  });

  it('a check that finds nothing expired leaves the notice alone', async () => {
    const store = createModeStore(createMemoryKeyValueStore());
    await store.load();
    await store.open(code);
    await store.expire(['stream'], { mode: 'stream', expiredAt: code.expiresAt as Date });
    const before = store.getSnapshot();
    await store.expire([], null);
    expect(store.getSnapshot()).toBe(before);
  });

  it('publishes an expiry even when the phone refuses the delete, and still rejects (R21)', async () => {
    const memory = createMemoryKeyValueStore({
      [STORE_KEYS.active]: 'stream',
      [STORE_KEYS.code('stream')]: encodeSavedCode(code),
    });
    const kv: KeyValueStore = {
      ...memory,
      delete: () => Promise.reject(new Error('keystore locked')),
    };
    const store = createModeStore(kv);
    await store.load();
    const notice = { mode: 'stream' as const, expiredAt: code.expiresAt as Date };
    await expect(store.expire(['stream'], notice)).rejects.toThrow('keystore locked');
    expect(ready(store).saved).toEqual({ active: null, codes: {} });
    expect(ready(store).notice).toEqual(notice);
    expect(memory.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  describe('one write at a time (I2)', () => {
    /** Every write waits for `release()`, then lands in the order it was asked. */
    function slowKv(seed: Record<string, string>) {
      const memory = createMemoryKeyValueStore(seed);
      let release = () => undefined as void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const kv: KeyValueStore = {
        get: memory.get,
        set: async (key, value) => gate.then(() => memory.set(key, value)),
        delete: async (key) => gate.then(() => memory.delete(key)),
      };
      return { kv, memory, release: () => release() };
    }
    const stale: SavedCode = { ...code, raw: '{"fake":"stale"}' };
    const fresh: SavedCode = { ...code, raw: '{"fake":"fresh"}' };

    it('never expires a code opened after the expired one was judged', async () => {
      const { kv, memory, release } = slowKv({
        [STORE_KEYS.code('stream')]: encodeSavedCode(stale),
      });
      const store = createModeStore(kv);
      await store.load();
      const opened = store.open(fresh);
      // The reopen gate judged the stale code before the fresh one was published.
      const notice = { mode: 'stream' as const, expiredAt: code.expiresAt as Date };
      const expired = store.expire(['stream'], notice);
      release();
      await Promise.all([opened, expired]);
      expect(memory.entries.get(STORE_KEYS.code('stream'))).toBe(encodeSavedCode(fresh));
      expect(memory.entries.get(STORE_KEYS.active)).toBe('stream');
      expect(ready(store).saved).toEqual({ active: 'stream', codes: { stream: fresh } });
      expect(ready(store).notice).toBeNull();
    });

    it('lands Continue then a quick Forget as a forget, on disk and on screen (M-e)', async () => {
      const { kv, memory, release } = slowKv({
        [STORE_KEYS.code('stream')]: encodeSavedCode(code),
      });
      const store = createModeStore(kv);
      await store.load();
      const continued = store.setActive('stream');
      const forgotten = store.forget('stream');
      release();
      await Promise.all([continued, forgotten]);
      expect([...memory.entries.keys()]).toEqual([]);
      expect(ready(store).saved).toEqual({ active: null, codes: {} });
    });

    it('takes the next write after one the phone refused', async () => {
      const memory = createMemoryKeyValueStore();
      let refuse = true;
      const kv: KeyValueStore = {
        ...memory,
        set: (key, value) =>
          refuse ? Promise.reject(new Error('keystore locked')) : memory.set(key, value),
      };
      const store = createModeStore(kv);
      await store.load();
      await expect(store.open(code)).rejects.toThrow('keystore locked');
      refuse = false;
      await store.open(code);
      expect(memory.entries.get(STORE_KEYS.active)).toBe('stream');
    });
  });

  describe('survives a relaunch', () => {
    it('keeps an opened code', async () => {
      const kv = createMemoryKeyValueStore();
      const store = createModeStore(kv);
      await store.load();
      await store.open(code);
      expect(await relaunch(kv)).toEqual({ active: 'stream', codes: { stream: code } });
    });

    it('keeps nothing of a forgotten or expired code', async () => {
      for (const drop of ['forget', 'expire'] as const) {
        const kv = createMemoryKeyValueStore();
        const store = createModeStore(kv);
        await store.load();
        await store.open(code);
        await (drop === 'forget' ? store.forget('stream') : store.expire(['stream'], null));
        expect([...kv.entries.keys()]).toEqual([]);
      }
    });

    it('clears the active mode but keeps the code on setActive(null)', async () => {
      const kv = createMemoryKeyValueStore();
      const store = createModeStore(kv);
      await store.load();
      await store.open(code);
      await store.setActive(null);
      expect([...kv.entries.keys()]).toEqual([STORE_KEYS.code('stream')]);
    });
  });

  it('stops calling a listener once it unsubscribes', async () => {
    const store = createModeStore(createMemoryKeyValueStore());
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener)();
    await store.setActive('stream');
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the same snapshot object until something changes', async () => {
    const store = createModeStore(createMemoryKeyValueStore());
    await store.load();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    const listener = vi.fn();
    store.subscribe(listener);
    await store.setActive('stream');
    expect(listener).toHaveBeenCalled();
  });
});

describe('mode store behind the 5 s timeout (spec §5)', () => {
  afterEach(() => vi.useRealTimers());

  it('lets the next write run once a stuck one times out', async () => {
    vi.useFakeTimers();
    const memory = createMemoryKeyValueStore();
    // Only the first write hangs. The flag flips when that write reaches the
    // store: the serial queue starts it a few microtasks after the call, so a
    // flip from the test body would un-stick it before it ever ran.
    let stuck = true;
    const hanging: KeyValueStore = {
      get: memory.get,
      set: (key, value) => {
        if (!stuck) return memory.set(key, value);
        stuck = false;
        return new Promise(() => undefined);
      },
      delete: memory.delete,
    };
    const logger = createLogger({ record: createRingRecord(), now: () => 0 });
    const store = createModeStore(withTimeout(hanging, { logger }));
    await store.load();
    const first = expect(store.setActive('stream')).rejects.toThrow('did not settle');
    const second = store.forget('stream');
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS);
    await first;
    await expect(second).resolves.toBeUndefined();
  });
});
