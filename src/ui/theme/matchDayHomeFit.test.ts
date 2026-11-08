import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { LANGS, type Lang } from '@/i18n/language';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// Home's Match Day card and the sheet's three refusals (MD-2 Task 3; S4 design §4), measured from the fonts and the
// dictionaries in four languages, as scoringHomeFit.test.ts measures Remote Scoring's cards. Nothing is read from the
// components; the layout facts are the ones ContinueCard, CodePanel and Home already carry (the card's border and
// padding, the plate's 200 dp floor, the landscape row's padding, the sheet's padding).

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

const BORDER = 2;
const PLATE_FLOOR = 200;
const WIDTHS = [320, 360] as const;
const GEOMETRIES = [640, 728, 800, 844, 915] as const;
/** Upright, the card's words have the column less Home's 16 each side, the card's border and its 16 each side. */
const innerAt = (width: number): number => width - 2 * space.md - BORDER - 2 * space.md;
/** Sideways, the words take what the Continue plate leaves of the row (`rowCardPadding`, then a 16 gap). */
const rowColumnAt = (width: number): number =>
  width - 2 * space.md - BORDER - space.md - layout.rowCardPadEnd - space.md - PLATE_FLOOR;

/** The S4 design's own example, and a long competition at a named venue. */
const NAMES = {
  example: { competition: 'SAFE Open', scope: 'Hall A' },
  long: { competition: 'Kent County Badminton Championships 2026', scope: 'Sports Centre Hall A' },
} as const;
const title = (lang: Lang, names: { competition: string; scope: string }): string =>
  said(lang, 'matchday.continue', names);

describe('the Match Day card’s title, in four languages', () => {
  it('upright at 320 and 360: the example takes one line, a long name wraps (the card grows; nothing is cut)', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const [name, names] of Object.entries(NAMES))
          lines[`${width} ${lang} ${name}`] = linesOf(
            title(lang, names),
            innerAt(width),
            display('state'),
          );
    expect(lines).toEqual({
      '320 en example': 1,
      '320 en long': 3,
      '320 es example': 1,
      '320 es long': 3,
      '320 fr example': 1,
      '320 fr long': 3,
      '320 nl example': 1,
      '320 nl long': 3,
      '360 en example': 1,
      '360 en long': 3,
      '360 es example': 1,
      '360 es long': 3,
      '360 fr example': 1,
      '360 fr long': 3,
      '360 nl example': 1,
      '360 nl long': 3,
    });
  });

  it('sideways, beside the Continue plate: the example takes one line at every geometry Home is measured at', () => {
    const lines: Record<string, number> = {};
    for (const width of GEOMETRIES)
      for (const lang of LANGS)
        lines[`${width} ${lang}`] = linesOf(
          title(lang, NAMES.example),
          rowColumnAt(width),
          display('state'),
        );
    expect(lines).toEqual({
      '640 en': 1,
      '640 es': 1,
      '640 fr': 1,
      '640 nl': 1,
      '728 en': 1,
      '728 es': 1,
      '728 fr': 1,
      '728 nl': 1,
      '800 en': 1,
      '800 es': 1,
      '800 fr': 1,
      '800 nl': 1,
      '844 en': 1,
      '844 es': 1,
      '844 fr': 1,
      '844 nl': 1,
      '915 en': 1,
      '915 es': 1,
      '915 fr': 1,
      '915 nl': 1,
    });
  });

  it('a whole-competition code’s title is never longer than the scoped one', () => {
    for (const lang of LANGS) {
      const whole = said(lang, 'matchday.continueWhole', { competition: NAMES.long.competition });
      expect(display('state')(whole)).toBeLessThan(display('state')(title(lang, NAMES.long)));
    }
  });

  it('the Continue plate fits the card on its own, upright (it is the card’s only button)', () => {
    for (const width of WIDTHS) expect(PLATE_FLOOR).toBeLessThanOrEqual(innerAt(width));
  });
});

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
