import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfter, withDeadline } from '@/services/httpAsk';
import { FIXTURE_NOW } from '../../test/fixtures/wire';

afterEach(() => vi.useRealTimers());

describe('the deadline race', () => {
  it('answers late, aborts the work, and never rejects when the work throws', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hung = withDeadline(
      (signal) =>
        new Promise<string>(() => signal?.addEventListener('abort', () => (aborted = true))),
      8000,
      () => 'late',
      () => 'threw',
    );
    await vi.advanceTimersByTimeAsync(7999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(hung).resolves.toBe('late');
    expect(aborted).toBe(true);
    await expect(
      withDeadline(
        () => Promise.reject(new Error('x')),
        8000,
        () => 'late',
        () => 'threw',
      ),
    ).resolves.toBe('threw');
  });

  it('answers with the work in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    await expect(
      withDeadline(
        async () => 'answered',
        8000,
        () => 'late',
        () => 'threw',
      ),
    ).resolves.toBe('answered');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('parseRetryAfter (D5)', () => {
  const now = FIXTURE_NOW.getTime();
  it.each([
    [null, 5],
    ['30', 30],
    [' 30 ', 30],
    ['0', 1],
    ['600', 120],
    ['soon', 5],
    ['-5', 5],
    ['1.5', 5],
    ['', 5],
    ['Sat, 03 Oct 2026 13:00:42 GMT', 42],
    ['Sat, 03 Oct 2026 12:00:00 GMT', 1],
    ['Sun, 04 Oct 2026 13:00:00 GMT', 120],
    // The shape of a date that is not one: never NaN, which would retry at once.
    ['Sat, 99 Oct 2026 13:00:00 GMT', 5],
  ])('reads %j as %i s', (value, seconds) => {
    expect(parseRetryAfter(value, now)).toBe(seconds);
  });
});
