import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import {
  PHOTO_DEADLINE_MS,
  createPhotoPort,
  readOutcome,
  type PhotoOutcome,
} from '@/services/photoPort';

describe('the photo port (spec §8, Q2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('M12 reads saved as saved and every other thing as failed', () => {
    expect(readOutcome('saved')).toBe('saved');
    expect(readOutcome('failed')).toBe('failed');
    const garbage: unknown[] = [
      undefined,
      null,
      'busy',
      'unavailable',
      'SAVED',
      42,
      true,
      {},
      ['saved'],
    ];
    for (const value of garbage) expect(readOutcome(value)).toBe('failed');
    expect(garbage).toHaveLength(9);
  });

  it('asks the module each time, and clears its timer when the answer comes', async () => {
    const module = new FakeNativeModule();
    const port = createPhotoPort(() => module.takePhoto());
    await expect(port.take()).resolves.toBe('saved');
    expect(module.photoCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    module.photoAnswer = 'failed';
    await expect(port.take()).resolves.toBe('failed');
    expect(module.photoCalls).toBe(2);
  });

  it('no native module is a failed photo', async () => {
    await expect(createPhotoPort(null).take()).resolves.toBe('failed');
  });

  it('a rejection and a synchronous throw are both failed, never an exception', async () => {
    await expect(createPhotoPort(() => Promise.reject(new Error('x'))).take()).resolves.toBe(
      'failed',
    );
    await expect(
      createPhotoPort(() => {
        throw new Error('not linked');
      }).take(),
    ).resolves.toBe('failed');
  });

  it('M13 gives up at the deadline exactly, and a late native answer does not change it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const port = createPhotoPort(() => new Promise((resolve) => (answer = resolve)));
    let outcome: PhotoOutcome | null = null;
    void port.take().then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('failed');
    answer('saved');
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('failed');
  });

  it('the deadline is 4 s, twice native’s 2 s bound (the owner’s number, written out)', () => {
    expect(PHOTO_DEADLINE_MS).toBe(4_000);
  });
});
