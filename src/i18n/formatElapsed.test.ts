import { describe, expect, it } from 'vitest';
import { formatElapsed } from '@/i18n/formatElapsed';

describe('formatElapsed (spec §4: H:MM:SS)', () => {
  it.each([
    [0, '0:00:00'],
    [999, '0:00:00'],
    [59_999, '0:00:59'],
    [754_000, '0:12:34'],
    [3_599_999, '0:59:59'],
    [3_600_000, '1:00:00'],
    [36_000_000, '10:00:00'],
    [-5000, '0:00:00'],
  ])('%i ms reads %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
