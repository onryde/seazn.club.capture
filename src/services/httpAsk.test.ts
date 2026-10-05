import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfter, utf8Length, withDeadline } from '@/services/httpAsk';
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

/**
 * Final review M7: the UTF-8 length the code check's cap counts, held to
 * Node's own encoder (`Buffer.byteLength`), never to the code under test.
 */
describe('utf8Length', () => {
  it('counts what Node’s encoder writes, at every width edge and for lone surrogates', () => {
    const edges = [
      '',
      'a',
      '\u007f',
      '\u0080',
      '߿',
      'ࠀ',
      '￿',
      'é',
      '日本',
      '😀',
      'a😀b',
      '\ud83d',
      '\ude00',
      '\ude00\ud83d',
      'x\ud83d',
      '\ud83d😀',
    ];
    for (const text of edges)
      expect(utf8Length(text), JSON.stringify(text)).toBe(Buffer.byteLength(text));
    // Random code units, surrogates included, from a fixed seed.
    let seed = 20261005;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    let checked = 0;
    let wrong = 0;
    for (let n = 0; n < 2000; n += 1) {
      const units = Array.from({ length: next() % 12 }, () => {
        const pick = next() % 4;
        if (pick === 0) return next() % 0x80;
        if (pick === 1) return 0xd800 + (next() % 0x800);
        return next() % 0x10000;
      });
      const text = String.fromCharCode(...units);
      if (utf8Length(text) !== Buffer.byteLength(text)) wrong += 1;
      checked += 1;
    }
    expect(checked).toBe(2000);
    expect(wrong).toBe(0);
  });
});
