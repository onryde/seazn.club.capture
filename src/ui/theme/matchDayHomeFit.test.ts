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

// Task 8c (owner, 2026-11-12): the not-yet-open sheet's sentence, and the Match Day tile's second line, measured the same way.
// The widest day and time as `formatDay` and `formatTime` write them (Node's ICU for 30 September, a 23:59 opening).
const WIDEST_DAY: Readonly<Record<Lang, string>> = {
  en: 'Wed 30 Sept',
  es: 'mié, 30 sept',
  fr: 'mer. 30 sept.',
  nl: 'wo 30 sep',
};
const geist500 = loadFont('geist-500');

describe('the not-yet-open sheet, in four languages', () => {
  it('its sentence, with the widest day and time, wraps to at most three lines at 320 and 360', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        const text = said(lang, 'matchday.notOpenSheet', { day: WIDEST_DAY[lang], time: '23:59' });
        const unknown = said(lang, 'matchday.notOpenSheet.unknown');
        lines[`${width} ${lang}`] = Math.max(
          linesOf(text, width - 2 * space.md, display('title')),
          linesOf(unknown, width - 2 * space.md, display('title')),
        );
      }
    expect(Math.max(...Object.values(lines))).toBeLessThanOrEqual(3);
    expect(Object.keys(lines)).toHaveLength(WIDTHS.length * LANGS.length);
  });
});

describe('the Match Day tile’s second line, in four languages', () => {
  // A portrait tile's text column: the window less the screen's pads, the 4 dp edge and the tile's own padding.
  const room = (width: number) => width - 2 * space.md - 4 - 2 * space.md;
  const KEYS = [
    'home.tile.matchday.opens',
    'home.tile.matchday.saved',
    'home.tile.matchday.tap',
  ] as const;

  it('every state stays on at most two lines at 320 and 360 (the tile grows from its content)', () => {
    let measured = 0;
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of KEYS) {
          const text = said(lang, key, { day: WIDEST_DAY[lang], time: '23:59' });
          const lines = linesOf(text, room(width), (line) =>
            geist500.width(line, typeScale.metricUnit.fontSize),
          );
          expect({ width, lang, key, fits: lines <= 2 }).toEqual({ width, lang, key, fits: true });
          measured += 1;
        }
    expect(measured).toBe(WIDTHS.length * LANGS.length * KEYS.length);
  });
});
