import { describe, expect, it } from 'vitest';
import { formatNumber } from '@/i18n/formatNumber';

describe('formatNumber (fix round 1, ruling 2)', () => {
  it.each([
    ['en', '9.2'],
    ['es', '9,2'],
    ['fr', '9,2'],
    ['nl', '9,2'],
  ] as const)('writes the decimal the %s way', (lang, expected) => {
    expect(formatNumber(9.2, lang)).toBe(expected);
  });

  it('keeps at most one decimal, and none on a whole number', () => {
    expect(formatNumber(1.46, 'fr')).toBe('1,5');
    expect(formatNumber(30, 'fr')).toBe('30');
    expect(formatNumber(0, 'nl')).toBe('0');
  });

  // A column of counts must not change width by locale: fr groups with a narrow
  // no-break space, es and nl with a dot, en with a comma. None is used.
  it.each(['en', 'es', 'fr', 'nl'] as const)('never groups thousands in %s', (lang) => {
    expect(formatNumber(120000, lang)).toBe('120000');
  });
});
