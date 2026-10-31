import { describe, expect, it } from 'vitest';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';

const english = createTranslator('en');
const french = createTranslator('fr');

describe('translatePad: a pad’s words, in the operator’s language', () => {
  it('passes a name or a number through as it is', () => {
    expect(translatePad(english, 'A. Sharma')).toBe('A. Sharma');
    expect(translatePad(english, 21)).toBe('21');
  });

  it('fills a key’s placeholders', () => {
    expect(
      translatePad(english, { key: 'scoring.badminton.last.rally', vars: { side: 'L. Chen' } }),
    ).toBe(en['scoring.badminton.last.rally'].replace('{side}', 'L. Chen'));
  });

  it('translates a fill that is words of its own, in the same language', () => {
    const text = {
      key: 'scoring.badminton.last.sanction',
      vars: { level: { key: 'scoring.sanction.warning' }, person: 'R. Iyer' },
    } as const;
    expect(translatePad(french, text)).toBe(
      fr['scoring.badminton.last.sanction']
        .replace('{level}', fr['scoring.sanction.warning'])
        .replace('{person}', 'R. Iyer'),
    );
  });

  it('translates a key with no fills', () => {
    expect(translatePad(french, { key: 'scoring.badminton.intervalNow' })).toBe(
      fr['scoring.badminton.intervalNow'],
    );
  });
});
