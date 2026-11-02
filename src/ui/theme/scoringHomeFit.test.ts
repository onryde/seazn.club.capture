import { describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '@/i18n/language';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// Remote Scoring's cards on Home, upright (plan S2-1 Task 10; design §5): the saved match's Continue card and the
// leftovers. Built from the fonts and the dictionaries, as homeFit is, for the two narrow widths Home is designed
// for (320 and 360 dp), in four languages. None of it is read from the components; the three layout facts a
// component sets (the card's border and padding, the plate's 200 dp floor, the ghost's padding and border) are
// the ones ContinueCard and Button already carry.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return text;
};
const said = (lang: Lang, key: string, vars: Record<string, string | number> = {}): string =>
  Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    word(lang, key),
  );

const geist500 = loadFont('geist-500');
const barlow700 = loadFont('barlow-condensed-700');
const control = (text: string): number => geist500.width(text, typeScale.control.fontSize);
const state = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * text.length;

/** The card's border, both sides, and its padding: the text and the buttons live in what is left of the column. */
const BORDER = 2;
const PLATE_FLOOR = 200;
const innerAt = (width: number): number => width - 2 * space.md - BORDER - 2 * space.md;
/** A ghost button is as wide as its label, 16 dp of padding and its 1 dp border each side. */
const ghost = (label: string): number => control(label) + 2 * space.md + 2 * layout.iconBorder;

/** Every sentence a card can say, with the longest label for the ones that name a match. */
function sentencesIn(lang: Lang): string[] {
  return [
    said(lang, 'home.scoring.unsent.one', { count: 1 }),
    said(lang, 'home.scoring.unsent.other', { count: 128 }),
    said(lang, 'home.scoring.deadHere.one', { count: 1 }),
    said(lang, 'home.scoring.deadHere.other', { count: 128 }),
    said(lang, 'home.scoring.unreadable'),
    said(lang, 'home.scoring.elsewhere.one', { count: 1, match: LONG_LABEL }),
    said(lang, 'home.scoring.elsewhere.other', { count: 128, match: LONG_LABEL }),
    said(lang, 'home.scoring.elsewhere.other', {
      count: 128,
      match: word(lang, 'home.scoring.matchFallback'),
    }),
  ];
}

/** The longest label a match carries on the phone: two doubles pairs, joined as the organiser typed them. */
const LONG_LABEL = 'A. Sharma / B. Verma v L. Chen / M. Wong';
const WIDTHS = [320, 360] as const;

describe('the cards’ words at 320 and 360 dp, in four languages', () => {
  it('the title takes at most two lines', () => {
    for (const width of WIDTHS) {
      for (const lang of LANGS) {
        const title = said(lang, 'home.continue.title', { mode: word(lang, 'mode.scoring') });
        expect(linesOf(title, innerAt(width), state), `${width} ${lang}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('each sentence takes at most the lines pinned: three at 320 in French, two otherwise', () => {
    const lines: Record<string, number> = {};
    let measured = 0;
    for (const width of WIDTHS) {
      for (const lang of LANGS) {
        for (const sentence of sentencesIn(lang)) {
          const key = `${width} ${lang}`;
          lines[key] = Math.max(lines[key] ?? 0, linesOf(sentence, innerAt(width), control));
          measured += 1;
        }
      }
    }
    expect(lines).toEqual({
      '320 en': 2,
      '320 es': 2,
      '320 fr': 3,
      '320 nl': 2,
      '360 en': 2,
      '360 es': 2,
      '360 fr': 2,
      '360 nl': 2,
    });
    expect(measured).toBe(2 * 4 * 8);
  });

  it('no word is wider than the card’s inner width: nothing is cut off at the edge', () => {
    for (const width of WIDTHS) {
      for (const lang of LANGS) {
        for (const sentence of sentencesIn(lang)) {
          for (const piece of sentence.split(' '))
            expect(control(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(innerAt(width));
        }
      }
    }
  });
});

describe('the cards’ buttons at 320 and 360 dp, in four languages', () => {
  const labels = (lang: Lang): string[] => [
    word(lang, 'home.scoring.dismiss'),
    word(lang, 'home.continue.forget'),
  ];

  it('each button fits the card’s inner width on its own', () => {
    for (const width of WIDTHS) {
      expect(PLATE_FLOOR).toBeLessThanOrEqual(innerAt(width));
      for (const lang of LANGS)
        for (const label of labels(lang))
          expect(ghost(label), `${width} ${lang} ${label}`).toBeLessThanOrEqual(innerAt(width));
    }
  });

  it('the plate and a second button do not always fit side by side, so the row wraps (the component pins flexWrap)', () => {
    const tight: string[] = [];
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const label of labels(lang))
          if (PLATE_FLOOR + space.sm + ghost(label) > innerAt(width))
            tight.push(`${width} ${lang} ${label}`);
    expect(tight).toEqual([
      '320 en Dismiss',
      '320 en Forget',
      '320 es Descartar',
      '320 es Olvidar',
      '320 fr Ignorer',
      '320 fr Oublier',
      '320 nl Verwijderen',
      '320 nl Vergeten',
      '360 es Descartar',
      '360 nl Verwijderen',
      '360 nl Vergeten',
    ]);
  });
});
