import { describe, expect, it } from 'vitest';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

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

  // Owner ruling 15's "Best of {n} games", plural-correct for 1: the web's `.one` / `.other` convention, picked by the
  // translator's own rule (`tp`). The key names the `.other` form, so a missing key fails to compile.
  it('picks the form a count needs, by the language’s own rule, and fills {count}', () => {
    const games = (count: number) =>
      ({ key: 'scoring.badminton.rules.bestOf.other', count }) as const;
    expect(translatePad(english, games(1))).toBe(
      en['scoring.badminton.rules.bestOf.one'].replace('{count}', '1'),
    );
    expect(translatePad(english, games(3))).toBe(
      en['scoring.badminton.rules.bestOf.other'].replace('{count}', '3'),
    );
    expect(translatePad(createTranslator('nl'), games(1))).toBe(
      nl['scoring.badminton.rules.bestOf.one'].replace('{count}', '1'),
    );
  });

  it('counts 0 as one in French, as the web does (the translator’s rule, not the pad’s)', () => {
    const none = { key: 'scoring.badminton.rules.bestOf.other', count: 0 } as const;
    expect(translatePad(french, none)).toBe(
      fr['scoring.badminton.rules.bestOf.one'].replace('{count}', '0'),
    );
    expect(translatePad(english, none)).toBe(
      en['scoring.badminton.rules.bestOf.other'].replace('{count}', '0'),
    );
  });
});
