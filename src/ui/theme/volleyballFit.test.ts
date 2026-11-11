import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// S2-6 Task 6: every `scoring.volleyball.*` word at 320 and 360 dp in four languages, portrait only (so the orientation
// question does not apply). The rooms are written out from the token and type declarations and the kit's styles, the
// widths measured from the shipped fonts (`test/fontMetrics.ts`) and the copy read from the dictionaries: nothing is read
// from a component. `padFit.test.ts` is past 1500 lines, so volleyball's sweep lives here (AGENTS §3). Whether real text
// stays inside on a phone is the device check's (exit item 5).

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
type Dictionary = Readonly<Record<string, string>>;
const WIDTHS = [320, 360] as const;
const VB = 'scoring.volleyball';

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');

/** `actionSecondary`: a tool's label, Barlow Condensed 600 at 16, uppercase, letter-spaced. */
const toolWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The strip. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `control`: Geist 500 at 14. The last-tap sentence, a History row, a half's foot, a sheet's choice. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `title`: a sheet's title, Barlow Condensed 700, uppercase, letter-spaced. */
const titleWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
/** `body`: Geist 400. A sheet's sentence. */
const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);

const said = (dictionary: Dictionary, key: string) => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text);
const words = (text: string) => text.split(' ');
/** Every word of the text fits the room: what wraps is never broken, and nothing overflows. */
const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  words(text).every((word) => measure(word) <= room);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** A tool cell's text in a row of `cells`: the row less its gaps, shared equally, less the cell's padding and border. */
const toolRoom = (cells: number) => (width: number) =>
  (column(width) - (cells - 1) * space.sm) / cells - 2 * space.sm - 2 * layout.iconBorder;
/** A strip slot: the row less its gaps, shared equally by the strip's three slots (set, target, note). */
const stripSlot = (width: number) => (column(width) - 2 * space.sm) / 3;
/** Inside a half: the column less the side bar and the half's padding (space.md a side). */
const halfInner = (width: number) => column(width) - layout.padSideBar - 2 * space.md;
/** A step sheet's content: the screen less its padding. A choice's text: less its own padding and border. */
const sheet = (width: number) => width - 2 * space.md;
const choice = (width: number) => sheet(width) - 2 * space.md - 2 * layout.iconBorder;

describe('volleyball: the tool row at 320 and 360 in four languages', () => {
  const room4 = toolRoom(4);
  const room3 = toolRoom(3);
  const fits = (label: string, room: number) =>
    linesOf(label, room, toolWidth) <= layout.padToolLines && wordsFit(label, room, toolWidth);

  it.each(LANGUAGES)(
    '%s: a row of four (Set score or Who serves?, Timeout short, Sub, More), every label in its lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const labels = [
        said(dictionary, `${VB}.tool.setScore`),
        said(dictionary, `${VB}.tool.serving`),
        said(dictionary, `${VB}.tool.timeoutShort`),
        said(dictionary, `${VB}.tool.sub`),
        said(dictionary, `${VB}.tool.more`),
      ];
      for (const label of labels)
        for (const width of WIDTHS)
          expect(fits(label, room4(width)), `${label} @${width}`).toBe(true);
    },
  );

  it.each(LANGUAGES)(
    '%s: a row of three (Timeout in full, Sub, More; Set score, Timeout, More on beach), no word broken',
    (_lang, dictionary: Dictionary) => {
      const labels = [
        said(dictionary, `${VB}.tool.timeout`),
        said(dictionary, `${VB}.tool.setScore`),
        said(dictionary, `${VB}.tool.sub`),
        said(dictionary, `${VB}.tool.more`),
      ];
      for (const label of labels)
        for (const width of WIDTHS)
          expect(fits(label, room3(width)), `${label} @${width}`).toBe(true);
    },
  );

  // Anti-vacuity: the full Timeout is wider than a row of four leaves at 320 in at least one language, which is why the row
  // of four draws the short word; and where the short word is the full one, the full one fits.
  it('would not hold the full Timeout in a row of four in every language, which is why it has a short word', () => {
    const wide = LANGUAGES.filter(
      ([, dictionary]) => !fits(said(dictionary, `${VB}.tool.timeout`), room4(320)),
    ).map(([lang]) => lang);
    expect(wide).toEqual(['en', 'es', 'nl']);
    for (const [lang, dictionary] of LANGUAGES) {
      const full = said(dictionary, `${VB}.tool.timeout`);
      const short = said(dictionary, `${VB}.tool.timeoutShort`);
      const holdsFour = WIDTHS.every((width) => fits(full, room4(width)));
      expect(short === full, lang).toBe(holdsFour);
    }
  });

  // The row draws the short word where the full one does not fit a cell of four, and says the full one.
  it.each(LANGUAGES)(
    '%s: the Sub drawn is the sheet’s word where that fits, short where it does not',
    (_lang, dictionary: Dictionary) => {
      const full = said(dictionary, `${VB}.sheet.sub`);
      const drawn = said(dictionary, `${VB}.tool.sub`);
      expect(drawn === full, full).toBe(fits(full, room4(320)));
    },
  );
});

describe('volleyball: the strip at 320 and 360 in four languages', () => {
  // Three equal slots: the set of how many (left), its target, and the note (right, one line, cut with an ellipsis).
  const facts = (dictionary: Dictionary) => [
    fill(said(dictionary, `${VB}.setOf`), { set: '5', bestOf: '5' }),
    fill(said(dictionary, `${VB}.target`), { target: '25' }),
    fill(said(dictionary, `${VB}.note.setting`), { winBy: '2' }),
    said(dictionary, `${VB}.note.goldenPoint`),
  ];

  it('is 90.67 dp a slot at 320 and 104 at 360', () => {
    expect(WIDTHS.map((width) => stripSlot(width).toFixed(2))).toEqual(['90.67', '104.00']);
  });

  it.each(LANGUAGES)(
    '%s: each fact on one line in its slot, at both widths',
    (_lang, dictionary: Dictionary) => {
      for (const fact of facts(dictionary))
        for (const width of WIDTHS)
          expect(linesOf(fact, stripSlot(width), unitWidth), `${fact} @${width}`).toBe(
            layout.padStripLines,
          );
    },
  );
});

describe('volleyball: a half’s foot at 320 and 360 in four languages', () => {
  // "T/O 2 of 2 · Subs 6 of 6" at its widest (both counts at FIVB's number), one line (the foot keeps its words whole).
  // The finished sets' boxes and the hint share the row in a real match: how they share it is the screen's (Task 11), and
  // this pins what the foot needs alone.
  const widest = (dictionary: Dictionary) =>
    fill(said(dictionary, `${VB}.foot.indoor`), {
      timeouts: '2',
      timeoutCap: '2',
      subs: '6',
      subCap: '6',
    });
  const beach = (dictionary: Dictionary) =>
    fill(said(dictionary, `${VB}.foot.beach`), { timeouts: '1', timeoutCap: '1' });

  it.each(LANGUAGES)(
    '%s: the indoor foot and the beach foot are each one line in a half',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const text of [widest(dictionary), beach(dictionary)])
          expect(controlWidth(text), `${text} @${width}`).toBeLessThanOrEqual(halfInner(width));
    },
  );

  it('leaves the foot a room it needs, and no more: the indoor foot is the wider (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES)
      expect(controlWidth(widest(dictionary))).toBeGreaterThan(controlWidth(beach(dictionary)));
  });
});

describe('volleyball: History’s rows and the last-tap line at 320 and 360 in four languages', () => {
  // As table tennis's: a row's sentence takes the column less the right column, in at most `padHistoryLines`.
  const room = (width: number) => column(width) - space.sm - layout.padHistorySide;
  const SIDE = 'Falcons';
  const sentences = (dictionary: Dictionary) => {
    const point = fill(said(dictionary, `${VB}.last.rally`), { side: SIDE });
    const vars = {
      side: SIDE,
      serving: SIDE,
      person: 'A. Sharma',
      off: 'A. Sharma',
      on: 'L. Chen',
      level: said(dictionary, 'scoring.sanction.disqualification'),
      set: '5',
      score: '31–29',
      point,
    };
    return Object.keys(dictionary)
      .filter(
        (key) =>
          key.startsWith(`${VB}.last.`) || key.startsWith(`${VB}.undone.`) || key === `${VB}.held`,
      )
      .map((key) => ({ key, text: fill(said(dictionary, key), vars) }));
  };

  it('reads the last-tap vocabulary (anti-vacuity): eleven last, five undone and the held answer', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary)).toHaveLength(17);
  });

  it.each(LANGUAGES)(
    '%s: every sentence in the two lines of a History row, no word broken',
    (lang, dictionary: Dictionary) => {
      for (const { key, text } of sentences(dictionary))
        for (const width of WIDTHS) {
          expect(
            linesOf(text, room(width), controlWidth),
            `${lang} ${key} @${width}`,
          ).toBeLessThanOrEqual(layout.padHistoryLines);
          expect(wordsFit(text, room(width), controlWidth), `${key} @${width}`).toBe(true);
        }
    },
  );

  const headingWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;

  it.each(LANGUAGES)(
    '%s: "Set 5" on one line in the cover’s column',
    (_lang, dictionary: Dictionary) => {
      const heading = fill(said(dictionary, `${VB}.setHeading`), { set: '5' });
      for (const width of WIDTHS) expect(linesOf(heading, column(width), headingWidth)).toBe(1);
    },
  );
});

describe('volleyball: the sheets at 320 and 360 in four languages', () => {
  const SIDES = [
    'Falcons',
    'Sunrise Falcons',
    'Sand / Surf',
    'Springfield Volleyball Club',
  ] as const;

  it.each(LANGUAGES)(
    '%s: each sheet’s title in at most two lines, no word wider than the sheet',
    (_lang, dictionary: Dictionary) => {
      const titles = [
        said(dictionary, `${VB}.sheet.timeout`),
        said(dictionary, `${VB}.sheet.sub`),
        said(dictionary, `${VB}.sheet.off`),
        said(dictionary, `${VB}.sheet.on`),
        said(dictionary, 'scoring.sanction.title'),
        said(dictionary, 'scoring.sanction.who'),
        fill(said(dictionary, `${VB}.sheet.serving`), { set: '5' }),
        said(dictionary, `${VB}.tool.more`),
      ];
      for (const title of titles)
        for (const width of WIDTHS) {
          expect(wordsFit(title, sheet(width), titleWidth), `${title} @${width}`).toBe(true);
          expect(
            linesOf(title, sheet(width), titleWidth),
            `${title} @${width}`,
          ).toBeLessThanOrEqual(2);
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: each choice, no word wider than a choice’s text, and a Sanction · side in at most two lines',
    (_lang, dictionary: Dictionary) => {
      const levels = ['warning', 'penalty', 'expulsion', 'disqualification'].map((level) =>
        said(dictionary, `scoring.sanction.${level}`),
      );
      const more = SIDES.map((side) => fill(said(dictionary, `${VB}.more.sanction`), { side }));
      for (const text of [...levels, ...more, ...SIDES])
        for (const width of WIDTHS)
          expect(wordsFit(text, choice(width), controlWidth), `${text} @${width}`).toBe(true);
      for (const text of more)
        for (const width of WIDTHS)
          expect(
            linesOf(text, choice(width), controlWidth),
            `${text} @${width}`,
          ).toBeLessThanOrEqual(2);
    },
  );

  // The sanction's last step says one line to the scorer (rulings 174, 185, 189): a sentence in the body role, wrapping at
  // spaces, never broken.
  it.each(LANGUAGES)(
    '%s: the penalty reminder and the field-six lines in at most four lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const lines = [
        fill(said(dictionary, `${VB}.done.penalty`), { side: SIDES[3] }),
        fill(said(dictionary, `${VB}.done.fieldSix`), { team: SIDES[3] }),
        fill(said(dictionary, `${VB}.done.fieldTwo`), { team: SIDES[3] }),
      ];
      for (const text of lines)
        for (const width of WIDTHS) {
          expect(wordsFit(text, sheet(width), bodyWidth), `${text} @${width}`).toBe(true);
          expect(linesOf(text, sheet(width), bodyWidth), `${text} @${width}`).toBeLessThanOrEqual(
            4,
          );
        }
    },
  );
});

describe('volleyball: every word it has is measured here (the sweep)', () => {
  // A key added to the dictionary must be named by a group above or below: a dead or unmeasured word fails here.
  const MEASURED: readonly RegExp[] = [
    /^tool\./,
    /^setOf$/,
    /^target$/,
    /^note\./,
    /^foot\./,
    /^last\./,
    /^undone\./,
    /^held$/,
    /^setHeading$/,
    /^sheet\./,
    /^more\.sanction$/,
    /^done\./,
  ];
  /** Words the fit tests do not measure, each with the reason. */
  const ELSEWHERE: Readonly<Record<string, string>> = {
    hint: 'the half’s spoken hint: never drawn (the kit draws the word Tap)',
    'start.ask': 'the Start screen’s question: the kit’s own fit (padFit, the Start screen)',
    serving: 'the plate’s word: the kit’s serving plate fit (padFit, a half)',
    serverPerson: 'the doubles line beside the boxes: the screen’s (Task 11)',
    player: 'a word standing for a name: measured inside the History sentences through the names',
    setsTally: 'said to a screen reader only',
    'setsSaid.one': 'said to a screen reader only',
    'setsSaid.other': 'said to a screen reader only',
    'rules.format.label': 'the match card’s rows: the kit’s (padFit, the match card)',
    'rules.bestOf': 'the match card’s rows',
    'rules.points.label': 'the match card’s rows',
    'rules.points.value': 'the match card’s rows',
    'rules.points.deciding': 'the match card’s rows',
    'rules.timeouts.label': 'the match card’s rows',
    'rules.timeouts.value': 'the match card’s rows',
    'rules.subs.label': 'the match card’s rows',
    'rules.subs.value': 'the match card’s rows',
  };

  it('every scoring.volleyball key is in a measured group or has its reason', () => {
    const unowned = Object.keys(en)
      .filter((key) => key.startsWith(`${VB}.`))
      .map((key) => key.slice(VB.length + 1))
      .filter((key) => !MEASURED.some((pattern) => pattern.test(key)) && !(key in ELSEWHERE));
    expect(unowned).toEqual([]);
  });

  it('names no key the dictionary lacks', () => {
    for (const key of Object.keys(ELSEWHERE))
      expect(Object.keys(en), key).toContain(`${VB}.${key}`);
  });
});
