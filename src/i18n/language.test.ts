import { describe, expect, it } from 'vitest';
import { parseLang, pickLanguage } from '@/i18n/language';

describe('pickLanguage', () => {
  it('prefers what the operator picked', () => {
    expect(pickLanguage('fr', ['es'])).toBe('fr');
  });

  it('follows the phone when it is one of the four', () => {
    expect(pickLanguage(null, ['nl', 'en'])).toBe('nl');
    expect(pickLanguage(null, ['ES'])).toBe('es');
  });

  it('falls back to English for any other phone language', () => {
    expect(pickLanguage(null, ['de', 'fr'])).toBe('en');
    expect(pickLanguage(null, [null])).toBe('en');
    expect(pickLanguage(null, [])).toBe('en');
  });

  it('parses only the four', () => {
    expect(parseLang('es')).toBe('es');
    expect(parseLang('de')).toBeNull();
    expect(parseLang(null)).toBeNull();
  });
});
