import { describe, expect, it } from 'vitest';
import type { Messages } from '@/i18n/messages';
import { createTranslator, pluralCategory } from '@/i18n/translate';
import type { Lang } from '@/i18n/language';

const fixture: Readonly<Record<Lang, Messages>> = {
  en: {
    hello: 'Hello {name}',
    'unsent.one': '{count} score unsent',
    'unsent.other': '{count} scores unsent',
  },
  es: { hello: 'Hola {name}' },
  fr: { 'unsent.one': '{count} score non envoyé', 'unsent.other': '{count} scores non envoyés' },
  nl: {},
};

describe('createTranslator', () => {
  it('fills placeholders', () => {
    expect(createTranslator('es', fixture).t('hello' as never, { name: 'Ana' })).toBe('Hola Ana');
  });

  it('falls back to English, then to the key, for a missing string', () => {
    expect(createTranslator('nl', fixture).t('hello' as never, { name: 'Jo' })).toBe('Hello Jo');
    expect(createTranslator('nl', fixture).t('nope' as never)).toBe('nope');
  });

  it('leaves an unfilled placeholder visible rather than printing undefined', () => {
    expect(createTranslator('en', fixture).t('hello' as never)).toBe('Hello {name}');
  });

  it('picks the plural form and passes the count', () => {
    const en = createTranslator('en', fixture);
    expect(en.tp('unsent', 1)).toBe('1 score unsent');
    expect(en.tp('unsent', 0)).toBe('0 scores unsent');
    expect(createTranslator('fr', fixture).tp('unsent', 0)).toBe('0 score non envoyé');
  });

  it('picks the plural form by the language that supplied the string', () => {
    const frWithoutPlural = createTranslator('fr', { ...fixture, fr: {} });
    expect(frWithoutPlural.tp('unsent', 0)).toBe('0 scores unsent');
    expect(frWithoutPlural.tp('unsent', 1)).toBe('1 score unsent');
  });

  it('translates a real key from the shipped dictionaries', () => {
    expect(createTranslator('fr').t('home.tile.comingSoon')).toBe('Bientôt disponible');
  });
});

describe('pluralCategory', () => {
  it.each<[Lang, number, 'one' | 'other']>([
    ['en', 0, 'other'],
    ['en', 1, 'one'],
    ['en', 2, 'other'],
    ['es', 0, 'other'],
    ['es', 1, 'one'],
    ['es', 2, 'other'],
    ['nl', 0, 'other'],
    ['nl', 1, 'one'],
    ['nl', 2, 'other'],
    ['fr', 0, 'one'],
    ['fr', 1, 'one'],
    ['fr', 1.5, 'one'],
    ['fr', 2, 'other'],
  ])('%s %d is %s', (lang, count, category) => {
    expect(pluralCategory(lang, count)).toBe(category);
  });
});
