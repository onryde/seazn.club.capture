import { describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';

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
