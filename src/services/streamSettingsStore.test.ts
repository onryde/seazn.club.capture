import { describe, expect, it, vi } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import {
  createStreamSettingsStore,
  DEFAULT_STREAM_SETTINGS,
  SETTINGS_KEY,
} from '@/services/streamSettingsStore';

function build(kv: KeyValueStore = createMemoryKeyValueStore()) {
  const record = createRingRecord();
  const store = createStreamSettingsStore(kv, createLogger({ record, now: () => 0 }));
  return { store, events: () => record.lines().map((line) => parseRecordLine(line).event) };
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
  it('starts with controls on the right and the automatic start on', async () => {
    const { store, events } = build();
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'right', automatic: true });
    // Nothing saved is the first launch, not an unreadable record.
    expect(events()).toEqual([]);
  });

  it('reads what was saved', async () => {
    const kv = createMemoryKeyValueStore({
      [SETTINGS_KEY]: '{"v":3,"side":"left","automatic":false}',
    });
    const { store } = build(kv);
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: false });
  });

  // A4's and D2's upgrades: an operator's side and automatic survive, the automatic start reads on from v1, and the
  // score preview's overlay is dropped from both (D2 §4.1).
  it.each([
    ['{"v":1,"overlay":false,"side":"right"}', { side: 'right', automatic: true }],
    ['{"v":1,"overlay":true,"side":"left"}', { side: 'left', automatic: true }],
    ['{"v":2,"overlay":true,"side":"left","automatic":false}', { side: 'left', automatic: false }],
    ['{"v":2,"overlay":false,"side":"right","automatic":true}', { side: 'right', automatic: true }],
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
    ['{"v":2,"overlay":false,"side":"left"}'],
    ['{"v":2,"overlay":false,"side":"left","automatic":"on"}'],
    ['{"v":3,"side":"left","automatic":"on"}'],
    ['{"v":3,"side":"up","automatic":true}'],
    ['{"v":3,"automatic":true}'],
    // A v4 shaped like a whole v2: only the v2 branch's version check refuses it (review I1).
    ['{"v":4,"overlay":true,"side":"left","automatic":true}'],
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
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"left","automatic":true}');
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
    await store.set({ automatic: false });
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
    expect(await store.set({ automatic: false })).toBe('refused');
    expect(store.getSnapshot().automatic).toBe(false);
    expect(events()).toContain('settings.write-refused');
  });

  it('reads a saved choice back after a cold start, under the key D23 names', async () => {
    const kv = createMemoryKeyValueStore();
    const first = build(kv).store;
    await first.load();
    await first.set({ automatic: false, side: 'left' });
    // A literal, not SETTINGS_KEY: renaming the key would reset every operator's settings (m2).
    expect(kv.entries.get('settings.stream')).toBe('{"v":3,"side":"left","automatic":false}');
    const { store: second, events } = build(kv);
    await second.load();
    expect(second.getSnapshot()).toEqual({ side: 'left', automatic: false });
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

  it('keeps the saved field the operator did not touch (automatic off stays off)', async () => {
    const { kv, set, slow, answer } = slowRead();
    const { store, events } = build(slow);
    const loading = store.load();
    const saving = store.set({ side: 'right' });
    expect(store.getSnapshot().side).toBe('right');
    await flush();
    // Nothing is written while the saved record is still unknown.
    expect(set).not.toHaveBeenCalled();
    answer('{"v":2,"overlay":true,"side":"left","automatic":false}');
    await loading;
    expect(store.getSnapshot()).toEqual({ side: 'right', automatic: false });
    expect(await saving).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"right","automatic":false}');
    expect(events()).toEqual([]);
  });

  it('keeps every change made before the read settles, not only the last', async () => {
    const { kv, slow, answer } = slowRead();
    const { store } = build(slow);
    const loading = store.load();
    const first = store.set({ automatic: false });
    const second = store.set({ side: 'left' });
    answer('{"v":1,"overlay":true,"side":"right"}');
    await loading;
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: false });
    expect([await first, await second]).toEqual(['saved', 'saved']);
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"left","automatic":false}');
  });

  it('reads the saved settings first when a change comes before any load', async () => {
    const kv = createMemoryKeyValueStore({
      [SETTINGS_KEY]: '{"v":2,"overlay":false,"side":"left","automatic":false}',
    });
    const get = vi.spyOn(kv, 'get');
    const { store } = build(kv);
    expect(await store.set({ side: 'right' })).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"right","automatic":false}');
    await store.load();
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ side: 'right', automatic: false });
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
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: true });
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"left","automatic":true}');
    expect(events()).toEqual(['settings.read-refused']);
  });
});

describe('two changes in quick succession (a second call)', () => {
  it('saves the last choice even when the phone finishes the writes out of order', async () => {
    const { kv, held, pending } = heldWrites();
    const { store } = build(held);
    await store.load();
    const first = store.set({ automatic: false });
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
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"left","automatic":false}');
  });

  it('still saves the next change after a refused write', async () => {
    const { kv, held, pending } = heldWrites();
    const { store, events } = build(held);
    await store.load();
    const first = store.set({ automatic: false });
    const second = store.set({ side: 'left' });
    await flush();
    pending.shift()?.refuse();
    await flush();
    pending.shift()?.finish();
    await flush();
    expect(await first).toBe('refused');
    expect(await second).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"left","automatic":false}');
    expect(events()).toEqual(['settings.write-refused']);
  });
});

describe('wire v3: the score preview is gone from the record (D2 §4.1)', () => {
  const storeOver = (seed: Record<string, string>) => {
    const kv = createMemoryKeyValueStore(seed);
    const record = createRingRecord();
    const store = createStreamSettingsStore(kv, createLogger({ record, now: () => 0 }));
    return { kv, record, store };
  };

  it('reads a v2 record from before the upgrade, keeping its side and automatic and dropping its overlay', async () => {
    const { store, record } = storeOver({
      [SETTINGS_KEY]: '{"v":2,"overlay":false,"side":"left","automatic":false}',
    });
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: false });
    expect(record.lines()).toEqual([]);
  });

  it('reads a v1 record: its side kept, automatic on by default, its overlay dropped', async () => {
    const { store } = storeOver({ [SETTINGS_KEY]: '{"v":1,"overlay":true,"side":"left"}' });
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: true });
  });

  it('writes v3 on the next save, with no overlay in it', async () => {
    const { store, kv } = storeOver({
      [SETTINGS_KEY]: '{"v":2,"overlay":true,"side":"right","automatic":true}',
    });
    await store.load();
    await store.set({ side: 'left' });
    expect(JSON.parse((await kv.get(SETTINGS_KEY)) ?? 'null')).toEqual({
      v: 3,
      side: 'left',
      automatic: true,
    });
  });

  it('reads its own v3 back, and a v3 that names an overlay is still read (an extra field is not a reason to refuse)', async () => {
    for (const text of [
      '{"v":3,"side":"left","automatic":false}',
      '{"v":3,"overlay":true,"side":"left","automatic":false}',
    ]) {
      const { store } = storeOver({ [SETTINGS_KEY]: text });
      await store.load();
      expect(store.getSnapshot()).toEqual({ side: 'left', automatic: false });
    }
  });

  it.each([
    ['a v2 with no side', '{"v":2,"overlay":true,"automatic":true}'],
    ['a v3 with no automatic', '{"v":3,"side":"left"}'],
    ['a v4', '{"v":4,"side":"left","automatic":true}'],
    ['not JSON', 'side=left'],
  ])('falls back to the defaults for %s, and says so', async (_name, text) => {
    const { store, record } = storeOver({ [SETTINGS_KEY]: text });
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'right', automatic: true });
    expect(record.lines().join('\n')).toContain('settings.unreadable');
  });
});
