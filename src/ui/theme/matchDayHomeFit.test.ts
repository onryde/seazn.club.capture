import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { LANGS, type Lang } from '@/i18n/language';
import { space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// The Match Day sheet's three refusals (MD-2 Task 3; S4 design §4), measured from the fonts and the
// dictionaries in four languages, as scoringHomeFit.test.ts measures Remote Scoring's cards. Nothing is read from the
// components; the layout fact is the sheet's padding. (Match Day has no Continue card: owner, 2026-11-12.)

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const said = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce(
    (all, [name, value]) => all.replaceAll(`{${name}}`, value),
    text,
  );
};

const barlow700 = loadFont('barlow-condensed-700');
/** A display role as drawn: Barlow Condensed 700 in caps at the role's size, letterspaced. */
const display =
  (role: 'state' | 'title') =>
  (text: string): number =>
    barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
    typeScale[role].letterSpacing * text.length;

const WIDTHS = [320, 360] as const;

describe('the sheet’s three refusals, in four languages', () => {
  it('each title takes the lines pinned at 320 and 360 (the sheet is padded 16 each side)', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of ['matchday.ended', 'matchday.withdrawn', 'matchday.unknown']) {
          const at = `${width} ${lang}`;
          lines[at] = Math.max(
            lines[at] ?? 0,
            linesOf(said(lang, key), width - 2 * space.md, display('title')),
          );
        }
    // Two lines at most: "Match Day code not recognised" and its kin wrap once; only Dutch's fit one line at 360.
    expect(lines).toEqual({
      '320 en': 2,
      '320 es': 2,
      '320 fr': 2,
      '320 nl': 2,
      '360 en': 2,
      '360 es': 2,
      '360 fr': 2,
      '360 nl': 1,
    });
  });
});
