import { describe, expect, it } from 'vitest';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';

describe('parseWholeNumber: a score typed into a field', () => {
  it.each([
    ['0', 0],
    ['7', 7],
    ['21', 21],
    [' 15 ', 15],
    ['05', 5],
    ['999', 999],
  ])('reads %j as %d', (text, value) => {
    expect(parseWholeNumber(text)).toBe(value);
  });

  it.each(['', ' ', 'abc', '3.5', '-1', '+2', '1e2', '0x1f', '1 2', '١٢', '1000', '٣'])(
    'refuses %j',
    (text) => {
      expect(parseWholeNumber(text)).toBeNull();
    },
  );
});
