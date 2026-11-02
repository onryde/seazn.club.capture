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

// The states that stand in the pad's place (plan S2-1 Task 11; design §4 step 3), upright, at the two narrow widths the
// scoring screens are designed for (320 and 360 dp), in four languages. Built from the fonts and the dictionaries, as
// scoringHomeFit and padFit are; none of it is read from a component. The layout facts it takes from the components
// are the screen's padding (`space.md` a side), the card's padding (`space.md`) and its left bar (`layout.padSideBar`),
// the tool buttons' padding (`space.sm`) and border, and the sheet's padding (`space.md`).

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
const plural = (lang: Lang, key: string, count: number): string =>
  said(lang, `${key}.${count === 1 ? 'one' : 'other'}`, { count });

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');

/** `panelTitle`: Barlow Condensed 700 at 22, uppercase, letter-spaced. The card's title. */
const panelTitle = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.panelTitle.fontSize) +
  typeScale.panelTitle.letterSpacing * [...text].length;
/** `title`: Barlow Condensed 700 at 26, uppercase, letter-spaced. The question's title. */
const sheetTitle = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
/** `body`: Geist 400 at 15. A state's sentence and the question's. */
const body = (text: string): number => geist400.width(text, typeScale.body.fontSize);
/** `control`: Geist 500 at 14. The unsent line and a button's note. */
const control = (text: string): number => geist500.width(text, typeScale.control.fontSize);
/** `metricUnit`: Geist 500 at 12. The sport's line. */
const unit = (text: string): number => geist500.width(text, typeScale.metricUnit.fontSize);
/** `actionSecondary`: a tool's label, Barlow Condensed 600 at 16, uppercase, letter-spaced. */
const tool = (text: string): number =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;

const WIDTHS = [320, 360] as const;
/** The card's text: the screen less its padding, the card's padding and its left bar. */
const inner = (width: number): number => width - 2 * space.md - 2 * space.md - layout.padSideBar;
/** A tool's text when `count` share the row: the row less the gaps, one share, less the cell's padding and border. */
const toolText = (width: number, count: number): number =>
  (inner(width) - (count - 1) * space.sm) / count - 2 * space.sm - 2 * layout.iconBorder;
/** The question's text: the screen less the sheet's padding. */
const sheetInner = (width: number): number => width - 2 * space.md;

const TITLES = [
  'loading',
  'offline',
  'linkGone',
  'unreadableQueue',
  'unreadableLink',
  'unsupported',
  'tooLarge',
  'sides',
  'cfg',
  'ledger',
  'outdated',
].map((name) => `scoring.state.${name}.title`);
const BODIES = [
  ...[
    'loading',
    'offline',
    'linkGone',
    'unreadableQueue',
    'unreadableLink',
    'unsupported',
    'tooLarge',
    'sides',
    'cfg',
    'ledger',
  ].map((name) => `scoring.state.${name}.body`),
  'scoring.card.updateNeeded.body',
];
/** The longest label a match carries on the phone: two doubles pairs, joined as the organiser typed them. */
const LONG_LABEL = 'A. Sharma / B. Verma v L. Chen / M. Wong';

/** The most lines of any language and any text in `keys`, per width and language: a table to pin. */
function mostLines(
  keys: readonly string[],
  measure: (text: string) => number,
  room: (width: number) => number,
  vars: Record<string, string | number> = {},
): Record<string, number> {
  const lines: Record<string, number> = {};
  for (const width of WIDTHS)
    for (const lang of LANGS)
      for (const key of keys) {
        const at = `${width} ${lang}`;
        lines[at] = Math.max(lines[at] ?? 0, linesOf(said(lang, key, vars), room(width), measure));
      }
  return lines;
}

describe('the rooms at 320 and 360', () => {
  it('the card’s text is 252 and 292 wide; two tools’ text 104 and 124, one tool’s 234 and 274', () => {
    expect(WIDTHS.map(inner)).toEqual([252, 292]);
    expect(WIDTHS.map((width) => toolText(width, 2))).toEqual([104, 124]);
    expect(WIDTHS.map((width) => toolText(width, 1))).toEqual([234, 274]);
  });
});

describe('a state’s title and sentence', () => {
  it('every title takes at most two lines, and no word of one is wider than the card', () => {
    const lines = mostLines(TITLES, panelTitle, inner);
    expect(Object.values(lines).every((count) => count <= 2)).toBe(true);
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of TITLES)
          for (const piece of word(lang, key).split(' '))
            expect(panelTitle(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(
              inner(width),
            );
  });

  it('pins the most lines a title takes, per width and language', () => {
    expect(mostLines(TITLES, panelTitle, inner)).toEqual({
      '320 en': 1,
      '320 es': 2,
      '320 fr': 2,
      '320 nl': 2,
      '360 en': 1,
      '360 es': 2,
      '360 fr': 1,
      '360 nl': 2,
    });
  });

  it('pins the most lines a sentence takes, per width and language (a card scrolls, so more is told, not cut)', () => {
    expect(mostLines(BODIES, body, inner)).toEqual({
      '320 en': 4,
      '320 es': 4,
      '320 fr': 5,
      '320 nl': 5,
      '360 en': 3,
      '360 es': 4,
      '360 fr': 4,
      '360 nl': 4,
    });
  });

  it('no word of a sentence is wider than the card: nothing is cut at the edge', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of BODIES)
          for (const piece of word(lang, key).split(' '))
            expect(body(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(inner(width));
  });

  it('measured every title and sentence of the table: eleven of each', () => {
    expect([TITLES.length, BODIES.length]).toEqual([11, 11]);
  });
});

describe('the one line a state adds', () => {
  it('the sport, named, takes one line even for a long key', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        expect(
          linesOf(
            said(lang, 'scoring.state.unsupported.sport', { sport: 'table_tennis' }),
            inner(width),
            unit,
          ),
          `${width} ${lang}`,
        ).toBe(1);
  });

  it('the taps an update leaves unsent, at 1 and at 99, takes at most two lines', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const count of [1, 99])
          expect(
            linesOf(plural(lang, 'scoring.card.updateNeeded.unsent', count), inner(width), control),
            `${width} ${lang} ${count}`,
          ).toBeLessThanOrEqual(2);
  });

  it('a button’s note (the store or browser would not open; the disk would not forget) takes at most two lines', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of ['scoring.card.cantOpen', 'scoring.state.exitFailed'])
          expect(
            linesOf(word(lang, key), inner(width), control),
            `${width} ${lang} ${key}`,
          ).toBeLessThanOrEqual(2);
  });
});

describe('the buttons', () => {
  it('Update and the browser, side by side, fit their reserved lines with no word broken', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of [
          'scoring.card.updateNeeded.update',
          'scoring.card.updateNeeded.browser',
        ]) {
          const label = word(lang, key);
          expect(
            linesOf(label, toolText(width, 2), tool),
            `${width} ${lang} ${key}`,
          ).toBeLessThanOrEqual(layout.padToolLines);
          for (const piece of label.split(' '))
            expect(tool(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(
              toolText(width, 2),
            );
        }
  });

  it('the browser alone and Dismiss alone fit their one cell, on one line', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of ['scoring.card.updateNeeded.browser', 'home.scoring.dismiss'])
          expect(
            linesOf(word(lang, key), toolText(width, 1), tool),
            `${width} ${lang} ${key}`,
          ).toBe(1);
  });
});

describe('the question before a Dismiss that discards taps', () => {
  const room = sheetInner;

  it('the sheet is 288 and 328 wide inside', () => {
    expect(WIDTHS.map(room)).toEqual([288, 328]);
  });

  it('pins the lines its title takes with the longest match, and the fallback name', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const match of [LONG_LABEL, word(lang, 'home.scoring.matchFallback')]) {
          const at = `${width} ${lang}`;
          lines[at] = Math.max(
            lines[at] ?? 0,
            linesOf(said(lang, 'home.scoring.confirm.title', { match }), room(width), sheetTitle),
          );
        }
    expect(lines).toEqual({
      '320 en': 3,
      '320 es': 3,
      '320 fr': 3,
      '320 nl': 3,
      '360 en': 2,
      '360 es': 2,
      '360 fr': 2,
      '360 nl': 2,
    });
  });

  it('pins the lines its sentence takes, one tap and 128, and the unreadable one', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const text of [
          plural(lang, 'home.scoring.confirm.body', 1),
          plural(lang, 'home.scoring.confirm.body', 128),
          word(lang, 'home.scoring.confirm.bodyUnreadable'),
        ]) {
          const at = `${width} ${lang}`;
          lines[at] = Math.max(lines[at] ?? 0, linesOf(text, room(width), body));
        }
    expect(lines).toEqual({
      '320 en': 3,
      '320 es': 2,
      '320 fr': 3,
      '320 nl': 3,
      '360 en': 2,
      '360 es': 2,
      '360 fr': 3,
      '360 nl': 2,
    });
  });

  // The sheet is anchored to the bottom of the screen and its panel is a column: padding, the title, a gap, the
  // sentence, a gap, the lime plate (56 tall), a gap and the outline (a touch target). At its tallest (the title at 3
  // lines of 29, the sentence at 3 of 22) it must leave the top bar (the phone's smallest portrait height is 568) clear.
  it('at its tallest the sheet is 313 dp, which leaves the top bar and the first card line clear on 568', () => {
    const tallest =
      2 * space.md +
      3 * typeScale.title.lineHeight +
      space.sm +
      3 * typeScale.body.lineHeight +
      space.sm +
      56 +
      space.sm +
      layout.touch;
    expect(tallest).toBe(313);
    const bar = layout.touch + 2 * space.md;
    expect(568 - tallest).toBeGreaterThan(bar + 100);
  });
});
