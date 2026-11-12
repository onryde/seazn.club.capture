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
    said(lang, 'scoring.sync.asked.one', { count: 1 }),
    said(lang, 'scoring.sync.asked.other', { count: 128 }),
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
    expect(measured).toBe(2 * 4 * 10);
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

// Landscape (plan S2-1 Task 10 review, item 7; homeFit's five geometries): a card is one row, the words on the left
// and the buttons beside them. The words take what the buttons leave: window − Home's 16 each side − the hairline −
// 16 at the start − 12 at the end (`rowCardPadding`) − the 16 gap − the buttons' own width. The plate is its 200 dp
// floor, a second button sits beside it (the row only wraps when the card is too narrow for both, and the words
// have the room first, so it is measured as one row: the narrower the words' column, the more it states).
const GEOMETRIES = [
  [640, 360],
  [728, 328],
  [800, 360],
  [844, 390],
  [915, 412],
] as const;
const GHOST_MIN = 48;
const PLATE_MIN = 56;

const geistLine = (text: string): number => control(text);
const stateTitle = (lang: Lang): string =>
  said(lang, 'home.continue.title', { mode: word(lang, 'mode.scoring') });

/** The words' column on a landscape card, for buttons `buttons` wide. */
const columnAt = (width: number, buttons: number): number =>
  width - 2 * space.md - BORDER - space.md - layout.rowCardPadEnd - space.md - buttons;

/** What a card's words and buttons add up to, tallest first, for one language at one window. */
function cardsAt(width: number, lang: Lang) {
  const dismiss = ghost(word(lang, 'home.scoring.dismiss'));
  const forget = ghost(word(lang, 'home.continue.forget'));
  const saved = columnAt(width, PLATE_FLOOR + space.sm + Math.max(dismiss, forget));
  const left = columnAt(width, dismiss);
  const lines = (text: string, column: number, measure: (t: string) => number): number =>
    linesOf(text, column, measure);
  const dead = said(lang, 'home.scoring.deadHere.other', { count: 128 });
  const unreadable = said(lang, 'home.scoring.unreadable');
  // A queue held for the scorer's answer: the pad's own words, on the saved card and on a leftover's, in a dead one's place.
  const asked = said(lang, 'scoring.sync.asked.other', { count: 128 });
  const elsewhere = said(lang, 'home.scoring.elsewhere.other', { count: 128, match: LONG_LABEL });
  return {
    /** The saved match: title, its name, its sentence. */
    saved:
      2 * layout.rowCardPadV +
      BORDER +
      Math.max(
        PLATE_MIN,
        lines(stateTitle(lang), saved, state) * typeScale.state.lineHeight +
          space.xs +
          lines(LONG_LABEL, saved, geistLine) * typeScale.control.lineHeight +
          space.xs +
          Math.max(
            lines(dead, saved, geistLine),
            lines(unreadable, saved, geistLine),
            lines(asked, saved, geistLine),
          ) *
            typeScale.control.lineHeight,
      ),
    /** A dead leftover: its name as the title, then its sentence. */
    deadLeftover:
      2 * layout.rowCardPadV +
      BORDER +
      Math.max(
        GHOST_MIN,
        lines(LONG_LABEL, left, state) * typeScale.state.lineHeight +
          space.xs +
          Math.max(lines(dead, left, geistLine), lines(asked, left, geistLine)) *
            typeScale.control.lineHeight,
      ),
    /** A leftover still sending, the sentence alone, naming the longest match. */
    liveLeftover:
      2 * layout.rowCardPadV +
      BORDER +
      lines(elsewhere, left, geistLine) * typeScale.control.lineHeight,
    columns: { saved, left },
  };
}

describe('the cards on landscape Home, at five windows, in four languages', () => {
  const key = (width: number, height: number, lang: Lang): string => `${width}x${height} ${lang}`;

  it('each card is as tall as pinned, worst case: the longest label, 128 taps and the longest sentence', () => {
    const heights: Record<string, number[]> = {};
    for (const [width, height] of GEOMETRIES)
      for (const lang of LANGS) {
        const cards = cardsAt(width, lang);
        heights[key(width, height, lang)] = [cards.saved, cards.deadLeftover, cards.liveLeftover];
      }
    // [the saved match, a dead leftover, a leftover still sending]. Home scrolls sideways when its rows outgrow the
    // window (homeFit.test.ts), so a tall card costs a scroll, never a cut-off: 640 × 360 is the one that gives the
    // saved match's words the least room (the plate and a second button take 308 dp of a 640 dp row).
    expect(heights).toEqual({
      '640x360 en': [119, 70, 40],
      '640x360 es': [119, 70, 58],
      '640x360 fr': [119, 70, 58],
      '640x360 nl': [119, 70, 58],
      '728x328 en': [83, 70, 40],
      '728x328 es': [101, 70, 40],
      '728x328 fr': [101, 70, 40],
      '728x328 nl': [101, 70, 40],
      '800x360 en': [83, 70, 40],
      '800x360 es': [101, 70, 40],
      '800x360 fr': [101, 70, 40],
      '800x360 nl': [101, 70, 40],
      '844x390 en': [83, 70, 40],
      '844x390 es': [101, 70, 40],
      '844x390 fr': [83, 70, 40],
      '844x390 nl': [101, 70, 40],
      '915x412 en': [83, 70, 40],
      '915x412 es': [83, 70, 40],
      '915x412 fr': [83, 70, 40],
      '915x412 nl': [83, 70, 40],
    });
  });

  it('no word is wider than the words’ column, so nothing is cut off at the buttons', () => {
    let measured = 0;
    for (const [width] of GEOMETRIES)
      for (const lang of LANGS) {
        const { columns } = cardsAt(width, lang);
        for (const [column, texts] of [
          [columns.saved, [stateTitle(lang), LONG_LABEL, ...sentencesIn(lang)]],
          [columns.left, [LONG_LABEL, ...sentencesIn(lang)]],
        ] as const)
          for (const text of texts)
            for (const piece of text.split(' ')) {
              measured += 1;
              expect(
                Math.max(control(piece), state(piece)),
                `${width} ${lang} ${piece}`,
              ).toBeLessThan(column);
            }
      }
    expect(measured).toBeGreaterThan(1000);
  });

  it('the saved match’s column is 239 dp at 640, in the language whose second button is widest', () => {
    const narrowest = Math.min(...LANGS.map((lang) => cardsAt(640, lang).columns.saved));
    expect(Math.floor(narrowest)).toBe(239);
  });
});

// A match that is over (owner ruling 41, 2026-11-02): the card says "Finished · {score}" in the title role, in lime, its
// name under it, and Close, its one button, beside or under the words. The score is the sport's line: badminton's
// longest is three games, each at the cap, and a sport with more games writes more, so the worst case is measured with
// five games of one digit each too. The words are the card's body, a press target at least `touch` tall.
describe('a finished match’s card at 320 and 360 dp, in four languages', () => {
  const SCORES = ['30–29, 29–30, 30–29', '21–15, 21–18', '6–4, 3–6, 6–4, 3–6, 6–4'] as const;
  const titles = (lang: Lang): string[] => [
    word(lang, 'home.scoring.finished'),
    ...SCORES.map((score) => said(lang, 'home.scoring.finishedScore', { score })),
  ];

  it('the title is one line upright, with the longest score either sport writes', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        lines[`${width} ${lang}`] = Math.max(
          ...titles(lang).map((text) => linesOf(text, innerAt(width), state)),
        );
    expect(lines).toEqual({
      '320 en': 1,
      '320 es': 1,
      '320 fr': 1,
      '320 nl': 1,
      '360 en': 1,
      '360 es': 1,
      '360 fr': 1,
      '360 nl': 1,
    });
  });

  it('the display face carries every mark of a score, so no digit or dash falls back to the system’s', () => {
    for (const mark of '0123456789–, ·')
      expect(barlow700.has(mark.codePointAt(0) ?? 0), mark).toBe(true);
  });

  it('no word is wider than the card’s inner width, and Close fits it on its own', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        for (const text of titles(lang))
          for (const piece of text.split(' '))
            expect(state(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(innerAt(width));
        const close = word(lang, 'home.scoring.close');
        expect(ghost(close), `${width} ${lang} ${close}`).toBeLessThanOrEqual(innerAt(width));
      }
  });

  it('View result and Close sit side by side on one row at 320 and 360 dp, in every language', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        const both =
          ghost(word(lang, 'home.scoring.view')) +
          space.sm +
          ghost(word(lang, 'home.scoring.close'));
        expect(both, `${width} ${lang}`).toBeLessThanOrEqual(innerAt(width));
      }
  });

  it('on landscape Home the title and the longest name are one line each beside View result and Close, so the card is the 48 dp the press target is', () => {
    const heights: Record<string, number> = {};
    for (const [width, height] of GEOMETRIES)
      for (const lang of LANGS) {
        const column = columnAt(
          width,
          ghost(word(lang, 'home.scoring.view')) +
            space.sm +
            ghost(word(lang, 'home.scoring.close')),
        );
        const title = Math.max(...titles(lang).map((text) => linesOf(text, column, state)));
        const name = linesOf(LONG_LABEL, column, geistLine);
        expect([title, name], `${width}x${height} ${lang}`).toEqual([1, 1]);
        heights[`${width}x${height} ${lang}`] =
          2 * layout.rowCardPadV +
          BORDER +
          Math.max(
            GHOST_MIN,
            title * typeScale.state.lineHeight + space.xs + name * typeScale.control.lineHeight,
          );
      }
    // The words are 39 dp and the press target 48, so every window and language draws the card 70 dp tall: no taller
    // than a dead leftover's (70), and well under the saved match's with its plate (119 at 640).
    expect(new Set(Object.values(heights))).toEqual(new Set([70]));
  });
});

// The question before a Dismiss (owner ruling B, 2026-11-02): one sheet, `CodePanel`'s, padded 16 each side, with the
// panel's kicker, a title that names the match, a body that names the taps, and two full-width buttons, Keep (the
// plate) and Dismiss (a ghost). The title is the `title` role in caps, the body the `body` role, from the fonts.
describe('the dismiss question at 320 and 360 dp, in four languages', () => {
  const geist400 = loadFont('geist-400');
  const titleWidth = (text: string): number =>
    barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
    typeScale.title.letterSpacing * text.length;
  const bodyWidth = (text: string): number => geist400.width(text, typeScale.body.fontSize);
  const sheetInner = (width: number): number => width - 2 * space.md;
  const titles = (lang: Lang): string[] =>
    [LONG_LABEL, word(lang, 'home.scoring.matchFallback')].map((match) =>
      said(lang, 'home.scoring.confirm.title', { match }),
    );
  const bodies = (lang: Lang): string[] => [
    said(lang, 'home.scoring.confirm.body.one', { count: 1 }),
    said(lang, 'home.scoring.confirm.body.other', { count: 128 }),
    said(lang, 'home.scoring.confirm.bodyUnreadable'),
  ];

  it('the title takes at most the lines pinned, with the longest label a match can carry', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        lines[`${width} ${lang}`] = Math.max(
          ...titles(lang).map((text) => linesOf(text, sheetInner(width), titleWidth)),
        );
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

  it('the body takes at most the lines pinned, for one tap, many, and a queue that cannot be read', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        lines[`${width} ${lang}`] = Math.max(
          ...bodies(lang).map((text) => linesOf(text, sheetInner(width), bodyWidth)),
        );
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

  /** The sheet sits at the bottom of the window; taller than the window, its top, the kicker and the title, is lost. */
  it('the sheet is never taller than the window, upright or sideways, worst case', () => {
    const tallest = (width: number, lang: Lang): number => {
      const title = Math.max(...titles(lang).map((t) => linesOf(t, sheetInner(width), titleWidth)));
      const body = Math.max(...bodies(lang).map((t) => linesOf(t, sheetInner(width), bodyWidth)));
      return (
        2 * space.md +
        typeScale.metricUnit.lineHeight +
        title * typeScale.title.lineHeight +
        body * typeScale.body.lineHeight +
        PLATE_MIN +
        GHOST_MIN +
        4 * space.sm
      );
    };
    const heights: Record<string, number> = {};
    for (const [width, height] of [[320, 568], [360, 640], ...GEOMETRIES] as const)
      for (const lang of LANGS)
        heights[`${width}x${height} ${lang}`] = height - tallest(width, lang);
    // Room to spare in dp, over every window and language: the least is 93.
    expect(Math.min(...Object.values(heights))).toBe(93);
    expect(Object.entries(heights).filter(([, spare]) => spare < 0)).toEqual([]);
  });

  it('no word is wider than the sheet’s inner width, and both buttons’ labels fit it', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        for (const text of titles(lang))
          for (const piece of text.split(' '))
            expect(titleWidth(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(
              sheetInner(width),
            );
        for (const text of bodies(lang))
          for (const piece of text.split(' '))
            expect(bodyWidth(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(
              sheetInner(width),
            );
        for (const label of [
          word(lang, 'home.scoring.confirm.keep'),
          word(lang, 'home.scoring.dismiss'),
        ])
          expect(ghost(label), `${width} ${lang} ${label}`).toBeLessThanOrEqual(sheetInner(width));
      }
  });
});

// The scan panel for a scoring link (the Batch D review): the stream check's sheet with the link's own words, "Checking
// the link…" for its title and "Can't check this link — no connection. Try again." for the offline answer's body. The same
// sheet as the Dismiss question's (padded 16, the kicker, the `title` in caps, the `body`), and what stands in its place
// is the stream's own sentence, so the new words may take no more lines than that one in any language.
describe('the scoring link’s scan panel at 320 and 360 dp, in four languages', () => {
  const geist400 = loadFont('geist-400');
  const titleWidth = (text: string): number =>
    barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
    typeScale.title.letterSpacing * text.length;
  const bodyWidth = (text: string): number => geist400.width(text, typeScale.body.fontSize);
  const inner = (width: number): number => width - 2 * space.md;
  const PAIRS = [
    ['home.scoring.checking.title', 'panel.checking.title', titleWidth],
    ['home.scoring.offline.body', 'panel.descriptor.offline.body', bodyWidth],
  ] as const;

  it('takes the lines pinned: one for the title, two for the body, in every width and language', () => {
    const lines: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const [key, , measure] of PAIRS)
          lines[`${width} ${lang} ${key}`] = linesOf(word(lang, key), inner(width), measure);
    expect(lines).toEqual({
      '320 en home.scoring.checking.title': 1,
      '320 en home.scoring.offline.body': 2,
      '320 es home.scoring.checking.title': 1,
      '320 es home.scoring.offline.body': 2,
      '320 fr home.scoring.checking.title': 1,
      '320 fr home.scoring.offline.body': 2,
      '320 nl home.scoring.checking.title': 1,
      '320 nl home.scoring.offline.body': 2,
      '360 en home.scoring.checking.title': 1,
      '360 en home.scoring.offline.body': 2,
      '360 es home.scoring.checking.title': 1,
      '360 es home.scoring.offline.body': 2,
      '360 fr home.scoring.checking.title': 1,
      '360 fr home.scoring.offline.body': 2,
      '360 nl home.scoring.checking.title': 1,
      '360 nl home.scoring.offline.body': 2,
    });
  });

  it('takes no more lines than the stream’s own words for the same answer', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const [key, streamKey, measure] of PAIRS)
          expect(
            linesOf(word(lang, key), inner(width), measure),
            `${width} ${lang} ${key}`,
          ).toBeLessThanOrEqual(linesOf(word(lang, streamKey), inner(width), measure));
  });

  it('has no word wider than the sheet’s inner width', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const [key, , measure] of PAIRS)
          for (const piece of word(lang, key).split(/[\s ]+/))
            expect(measure(piece), `${width} ${lang} ${piece}`).toBeLessThanOrEqual(inner(width));
  });
});
