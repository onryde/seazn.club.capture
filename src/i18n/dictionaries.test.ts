import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

type Dictionary = Readonly<Record<string, string>>;

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

const keysOf = (dictionary: Dictionary): string[] =>
  Object.keys(dictionary)
    .filter((key) => key !== '_review')
    .sort();

describe('dictionaries', () => {
  it('English is the source and carries no review marker', () => {
    expect('_review' in en).toBe(false);
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s has exactly the English keys', (_lang, dictionary: Dictionary) => {
    expect(keysOf(dictionary)).toEqual(keysOf(en));
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s keeps every placeholder of every key', (_lang, dictionary: Dictionary) => {
    for (const key of keysOf(en)) {
      expect({ key, placeholders: placeholders(dictionary[key] ?? '') }).toEqual({
        key,
        placeholders: placeholders((en as Dictionary)[key] ?? ''),
      });
    }
  });

  it('no value is empty', () => {
    for (const dictionary of [en, es, fr, nl] as Dictionary[]) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect({ key, empty: value.trim().length === 0 }).toEqual({ key, empty: false });
      }
    }
  });
});
