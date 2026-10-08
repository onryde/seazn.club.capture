import { describe, expect, it } from 'vitest';
import { formatAge } from '@/i18n/formatAge';
import { formatNumber } from '@/i18n/formatNumber';
import { LANGS, type Lang } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';

/**
 * How long ago something was, as Diagnostics writes it: tenths of a second under 100 s, whole seconds to
 * 599 s, whole minutes from 10 to 99 min, whole hours beyond (floored: "1 h ago" at 1 h 59). Every expected
 * string is written out, per language, from the board's unit words (s, min, h; nl writes "u" for uur).
 */
const age = (lang: Lang, seconds: number) =>
  formatAge(seconds, createTranslator(lang).t, (value) => formatNumber(value, lang));

/** Seconds -> the text in en, es, fr, nl. */
const CASES: readonly (readonly [
  seconds: number,
  ...text: readonly [string, string, string, string],
])[] = [
  [0, '0 s ago', 'hace 0 s', 'il y a 0 s', '0 s geleden'],
  [1.5, '1.5 s ago', 'hace 1,5 s', 'il y a 1,5 s', '1,5 s geleden'],
  [99.9, '99.9 s ago', 'hace 99,9 s', 'il y a 99,9 s', '99,9 s geleden'],
  [100, '100 s ago', 'hace 100 s', 'il y a 100 s', '100 s geleden'],
  [300, '300 s ago', 'hace 300 s', 'il y a 300 s', '300 s geleden'],
  [599, '599 s ago', 'hace 599 s', 'il y a 599 s', '599 s geleden'],
  [599.9, '599 s ago', 'hace 599 s', 'il y a 599 s', '599 s geleden'],
  [600, '10 min ago', 'hace 10 min', 'il y a 10 min', '10 min geleden'],
  [3599, '59 min ago', 'hace 59 min', 'il y a 59 min', '59 min geleden'],
  [3600, '60 min ago', 'hace 60 min', 'il y a 60 min', '60 min geleden'],
  [5999, '99 min ago', 'hace 99 min', 'il y a 99 min', '99 min geleden'],
  [6000, '1 h ago', 'hace 1 h', 'il y a 1 h', '1 u geleden'],
  [10799, '2 h ago', 'hace 2 h', 'il y a 2 h', '2 u geleden'],
  [86400, '24 h ago', 'hace 24 h', 'il y a 24 h', '24 u geleden'],
];

let checked = 0;

describe('formatAge', () => {
  it.each(CASES)('%f s reads as the board says, in every language', (seconds, ...text) => {
    expect(LANGS).toEqual(['en', 'es', 'fr', 'nl']);
    LANGS.forEach((lang, at) => {
      expect({ lang, text: age(lang, seconds) }).toEqual({ lang, text: text[at] });
      checked += 1;
    });
  });

  // A clock a moment ahead of the phone's (an NTP step) can hand over a negative age: it reads 0, never Intl's "-0".
  it.each([-5, -0.0001, -86400])('%f s is clamped to 0', (seconds) => {
    expect(age('en', seconds)).toBe('0 s ago');
    expect(age('nl', seconds)).toBe('0 s geleden');
  });

  it('checked every case in every language (anti-vacuity)', () => {
    expect(CASES).toHaveLength(14);
    expect(checked).toBe(14 * 4);
  });
});
