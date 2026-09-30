import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { isKvTimeout, KV_TIMEOUT_MS, withTimeout } from '@/services/kvTimeout';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';

const never = <T>() => new Promise<T>(() => undefined);

function wrap(kv: KeyValueStore) {
  const record = createRingRecord();
  const store = withTimeout(kv, { logger: createLogger({ record, now: () => 0 }) });
  return { store, events: () => record.lines().map((line) => JSON.parse(line)) };
}

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes answers straight through, and logs nothing once the 5 s have gone', async () => {
    const { store, events } = wrap(createMemoryKeyValueStore({ a: '1' }));
    await expect(store.get('a')).resolves.toBe('1');
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS);
    expect(events()).toEqual([]);
  });

  it('rejects a call that never settles after 5 s, and logs it', async () => {
    const hanging: KeyValueStore = { get: never, set: never, delete: never };
    const { store, events } = wrap(hanging);
    const write = store.set('code.stream', 'x');
    const settled = expect(write).rejects.toSatisfy(isKvTimeout);
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS - 1);
    expect(events()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(events()).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'kv.timeout',
        fields: { op: 'set', key: 'code.stream', ms: KV_TIMEOUT_MS },
      }),
    ]);
  });

  it('passes a refusal through unchanged and logs nothing', async () => {
    const refusing: KeyValueStore = {
      get: () => Promise.reject(new Error('keystore locked')),
      set: never,
      delete: never,
    };
    const { store, events } = wrap(refusing);
    const refusal = store.get('a');
    await expect(refusal).rejects.toThrow('keystore locked');
    await expect(refusal).rejects.not.toSatisfy(isKvTimeout);
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS);
    expect(events()).toEqual([]);
  });

  it('turns a synchronous throw into a rejection, never a timeout too', async () => {
    const throwing: KeyValueStore = {
      get: () => {
        throw new Error('native module missing');
      },
      set: never,
      delete: never,
    };
    const { store, events } = wrap(throwing);
    await expect(store.get('a')).rejects.toThrow('native module missing');
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS);
    expect(events()).toEqual([]);
  });
});
