import { describe, expect, it, vi } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import {
  createStreamSettingsStore,
  DEFAULT_STREAM_SETTINGS,
  SETTINGS_KEY,
} from '@/services/streamSettingsStore';

function build(kv: KeyValueStore = createMemoryKeyValueStore()) {
  const record = createRingRecord();
  const store = createStreamSettingsStore(kv, createLogger({ record, now: () => 0 }));
  return { store, events: () => record.lines().map((line) => JSON.parse(line).event) };
}

/** Lets every settled promise run its callbacks. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * A keystore whose writes finish only when the test says, in any order, as
 * SecureStore's may. A write lands in `entries` when it finishes.
 */
function heldWrites() {
  const kv = createMemoryKeyValueStore();
  const pending: { value: string; finish(): void; refuse(): void }[] = [];
  const held: KeyValueStore = {
    get: kv.get,
    delete: kv.delete,
    set: (key, value) =>
      new Promise<void>((resolve, reject) => {
        const write = {
          value,
          finish: () => void kv.set(key, value).then(resolve),
          refuse: () => reject(new Error('keystore locked')),
        };
        pending.push(write);
      }),
  };
  return { kv, held, pending };
}

describe('stream settings (D23)', () => {
  it('starts with the overlay on and controls on the right', async () => {
    const { store, events } = build();
    await store.load();
    expect(store.getSnapshot()).toEqual({ overlay: true, side: 'right' });
    // Nothing saved is the first launch, not an unreadable record.
    expect(events()).toEqual([]);
  });

  it('reads what was saved', async () => {
    const kv = createMemoryKeyValueStore({
      [SETTINGS_KEY]: '{"v":1,"overlay":false,"side":"left"}',
    });
    const { store } = build(kv);
    await store.load();
    expect(store.getSnapshot()).toEqual({ overlay: false, side: 'left' });
  });

  it.each([
    ['{"v":1,"overlay":false,"side":"right"}', { overlay: false, side: 'right' }],
    ['{"v":1,"overlay":true,"side":"left"}', { overlay: true, side: 'left' }],
  ])('reads %s as saved, not as the defaults', async (text, expected) => {
    const { store, events } = build(createMemoryKeyValueStore({ [SETTINGS_KEY]: text }));
    await store.load();
    expect(store.getSnapshot()).toEqual(expected);
    expect(events()).toEqual([]);
  });

  it('falls back to the defaults, and says so, for an unreadable record', async () => {
    const kv = createMemoryKeyValueStore({ [SETTINGS_KEY]: '{"v":9}' });
    const { store, events } = build(kv);
    await store.load();
    expect(store.getSnapshot()).toBe(DEFAULT_STREAM_SETTINGS);
    expect(events()).toContain('settings.unreadable');
  });

  it.each([
    ['not json'],
    ['null'],
    ['"left"'],
    ['[]'],
    ['{"overlay":false,"side":"left"}'],
    ['{"v":"1","overlay":false,"side":"left"}'],
    ['{"v":1,"overlay":"off","side":"left"}'],
    ['{"v":1,"side":"left"}'],
    ['{"v":1,"overlay":false,"side":"up"}'],
    ['{"v":1,"overlay":false}'],
  ])('reads %s as unreadable, never as a half setting', async (text) => {
    const { store, events } = build(createMemoryKeyValueStore({ [SETTINGS_KEY]: text }));
    await store.load();
    expect(store.getSnapshot()).toBe(DEFAULT_STREAM_SETTINGS);
    expect(events()).toEqual(['settings.unreadable']);
  });

  it('falls back to the defaults, and says so, when the phone refuses the read', async () => {
    const refusing: KeyValueStore = {
      get: () => Promise.reject(new Error('keystore locked')),
      set: async () => undefined,
      delete: async () => undefined,
    };
    const { store, events } = build(refusing);
    await store.load();
    expect(store.getSnapshot()).toBe(DEFAULT_STREAM_SETTINGS);
    expect(events()).toEqual(['settings.read-refused']);
  });

  it('applies a change at once and saves it', async () => {
    const kv = createMemoryKeyValueStore();
    const { store } = build(kv);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);
    const saved = store.set({ side: 'left' });
    expect(store.getSnapshot().side).toBe('left');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await saved).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":true,"side":"left"}');
  });

  it('keeps the same snapshot until something changes (useSyncExternalStore)', async () => {
    const { store } = build();
    const before = store.getSnapshot();
    await store.load();
    expect(store.getSnapshot()).toBe(before);
    const unsubscribe = store.subscribe(() => {
      throw new Error('told after unsubscribing');
    });
    unsubscribe();
    await store.set({ overlay: false });
    expect(store.getSnapshot()).not.toBe(before);
  });

  it('keeps a choice the phone refused to save, for this session, and logs it', async () => {
    const refusing: KeyValueStore = {
      get: async () => null,
      set: () => Promise.reject(new Error('keystore locked')),
      delete: async () => undefined,
    };
    const { store, events } = build(refusing);
    await store.load();
    expect(await store.set({ overlay: false })).toBe('refused');
    expect(store.getSnapshot().overlay).toBe(false);
    expect(events()).toContain('settings.write-refused');
  });

  it('reads a saved choice back after a cold start, under the key D23 names', async () => {
    const kv = createMemoryKeyValueStore();
    const first = build(kv).store;
    await first.load();
    await first.set({ overlay: false, side: 'left' });
    // A literal, not SETTINGS_KEY: renaming the key would reset every operator's settings (m2).
    expect(kv.entries.get('settings.stream')).toBe('{"v":1,"overlay":false,"side":"left"}');
    const { store: second, events } = build(kv);
    await second.load();
    expect(second.getSnapshot()).toEqual({ overlay: false, side: 'left' });
    expect(events()).toEqual([]);
  });

  it('reads once however often it is asked to load', async () => {
    const kv = createMemoryKeyValueStore();
    const get = vi.spyOn(kv, 'get');
    const { store } = build(kv);
    await Promise.all([store.load(), store.load()]);
    await store.load();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

/**
 * A choice made before the first read settles (m1): it lands on top of what
 * was saved, and nothing is written until the saved record is known.
 */
describe('a change before the saved settings are read', () => {
  /** A keystore whose first read answers only when the test says. */
  function slowRead() {
    const kv = createMemoryKeyValueStore();
    const set = vi.spyOn(kv, 'set');
    let answer: (text: string | null) => void = () => undefined;
    const slow: KeyValueStore = {
      get: () => new Promise((resolve) => (answer = resolve)),
      set: kv.set,
      delete: kv.delete,
    };
    return { kv, set, slow, answer: (text: string | null) => answer(text) };
  }

  it('never lets a slow first read overwrite a choice made meanwhile', async () => {
    const { slow, answer } = slowRead();
    const { store } = build(slow);
    const loading = store.load();
    const saving = store.set({ side: 'left' });
    answer('{"v":1,"overlay":true,"side":"right"}');
    await loading;
    expect(store.getSnapshot().side).toBe('left');
    expect(await saving).toBe('saved');
  });

  it('keeps the saved field the operator did not touch (score preview off stays off)', async () => {
    const { kv, set, slow, answer } = slowRead();
    const { store, events } = build(slow);
    const loading = store.load();
    const saving = store.set({ side: 'right' });
    expect(store.getSnapshot().side).toBe('right');
    await flush();
    // Nothing is written while the saved record is still unknown.
    expect(set).not.toHaveBeenCalled();
    answer('{"v":1,"overlay":false,"side":"left"}');
    await loading;
    expect(store.getSnapshot()).toEqual({ overlay: false, side: 'right' });
    expect(await saving).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"right"}');
    expect(events()).toEqual([]);
  });

  it('keeps every change made before the read settles, not only the last', async () => {
    const { kv, slow, answer } = slowRead();
    const { store } = build(slow);
    const loading = store.load();
    const first = store.set({ overlay: false });
    const second = store.set({ side: 'left' });
    answer('{"v":1,"overlay":true,"side":"right"}');
    await loading;
    expect(store.getSnapshot()).toEqual({ overlay: false, side: 'left' });
    expect([await first, await second]).toEqual(['saved', 'saved']);
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"left"}');
  });

  it('reads the saved settings first when a change comes before any load', async () => {
    const kv = createMemoryKeyValueStore({
      [SETTINGS_KEY]: '{"v":1,"overlay":false,"side":"left"}',
    });
    const get = vi.spyOn(kv, 'get');
    const { store } = build(kv);
    expect(await store.set({ side: 'right' })).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"right"}');
    await store.load();
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ overlay: false, side: 'right' });
  });

  it('saves the change over the defaults after a refused read, and says the read failed', async () => {
    const kv = createMemoryKeyValueStore();
    const refusingRead: KeyValueStore = {
      get: () => Promise.reject(new Error('keystore locked')),
      set: kv.set,
      delete: kv.delete,
    };
    const { store, events } = build(refusingRead);
    expect(await store.set({ side: 'left' })).toBe('saved');
    expect(store.getSnapshot()).toEqual({ overlay: true, side: 'left' });
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":true,"side":"left"}');
    expect(events()).toEqual(['settings.read-refused']);
  });
});

describe('two changes in quick succession (a second call)', () => {
  it('saves the last choice even when the phone finishes the writes out of order', async () => {
    const { kv, held, pending } = heldWrites();
    const { store } = build(held);
    await store.load();
    const first = store.set({ overlay: false });
    // The second tap lands while the first write is already with the keystore.
    await flush();
    const second = store.set({ side: 'left' });
    // The phone finishes whichever write is newest first, until none is left.
    await flush();
    while (pending.length > 0) {
      pending.pop()?.finish();
      await flush();
    }
    expect(await first).toBe('saved');
    expect(await second).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"left"}');
  });

  it('still saves the next change after a refused write', async () => {
    const { kv, held, pending } = heldWrites();
    const { store, events } = build(held);
    await store.load();
    const first = store.set({ overlay: false });
    const second = store.set({ side: 'left' });
    await flush();
    pending.shift()?.refuse();
    await flush();
    pending.shift()?.finish();
    await flush();
    expect(await first).toBe('refused');
    expect(await second).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"left"}');
    expect(events()).toEqual(['settings.write-refused']);
  });
});
