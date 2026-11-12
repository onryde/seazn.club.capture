import { describe, expect, it } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { readPointDetails, savePointDetails } from '@/services/tennisPointDetailsStore';

// S2-7 ruling 234 (Task 17): a match's "Point details" switch, kept on the phone per match in the key-value store, off by
// default. A switch that cannot be read is off: the point is then `{by}` alone, sent at once, as before the ruling.

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';
const KEY = `scoring.tennis.details.${FIXTURE}`;

const refusing: KeyValueStore = {
  get: () => Promise.reject(new Error('locked')),
  set: () => Promise.reject(new Error('locked')),
  delete: () => Promise.reject(new Error('locked')),
};

describe('the Point details switch, kept per match', () => {
  it('is off for a match it was never turned on for', async () => {
    expect(await readPointDetails(createMemoryKeyValueStore(), FIXTURE)).toBe(false);
  });

  it('is on once turned on, for that match alone', async () => {
    const kv = createMemoryKeyValueStore();
    await savePointDetails(kv, FIXTURE, true);
    expect(kv.entries.get(KEY)).toBe('on');
    expect(await readPointDetails(kv, FIXTURE)).toBe(true);
    expect(await readPointDetails(kv, 'another-match')).toBe(false);
  });

  it('is off again once turned off, and keeps nothing', async () => {
    const kv = createMemoryKeyValueStore({ [KEY]: 'on' });
    await savePointDetails(kv, FIXTURE, false);
    expect(kv.entries.has(KEY)).toBe(false);
    expect(await readPointDetails(kv, FIXTURE)).toBe(false);
  });

  it('reads anything but its own word as off', async () => {
    expect(await readPointDetails(createMemoryKeyValueStore({ [KEY]: 'true' }), FIXTURE)).toBe(
      false,
    );
  });

  it('is off when the store does not answer, and a refused save rejects', async () => {
    expect(await readPointDetails(refusing, FIXTURE)).toBe(false);
    await expect(savePointDetails(refusing, FIXTURE, true)).rejects.toThrow('locked');
  });

  it('keeps nothing for an id that is no key, and reads it as off', async () => {
    const kv = createMemoryKeyValueStore();
    await expect(savePointDetails(kv, 'no/key', true)).rejects.toThrow();
    expect(kv.entries.size).toBe(0);
    expect(await readPointDetails(kv, 'no/key')).toBe(false);
  });
});
