import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// S2-7 Task 6: every `scoring.tennis.*` word at 320 and 360 dp in four languages, portrait only (so the orientation question
// does not apply). The rooms are written out from the token and type declarations and the kit's styles, the widths measured
// from the shipped fonts (`test/fontMetrics.ts`) and the copy read from the dictionaries: nothing is read from a component.
// `padFit.test.ts` is past 1500 lines, so tennis's sweep lives here (AGENTS §3), as volleyball's does. Whether real text stays
// inside on a phone is the device check's (exit item 5).

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
type Dictionary = Readonly<Record<string, string>>;
const WIDTHS = [320, 360] as const;
const TN = 'scoring.tennis';

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
/** `control`: Geist 500 at 14. A half's foot. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `body`: Geist 400. A rules row. */
const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
/** `title`: a sheet's title, Barlow Condensed 700, uppercase, letter-spaced. */
const titleWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
/** `panelTitle`: the result card's title, Barlow Condensed 700 at 22, uppercase, letter-spaced. */
const panelWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.panelTitle.fontSize) +
  typeScale.panelTitle.letterSpacing * [...text].length;

const said = (dictionary: Dictionary, key: string) => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), text);
const words = (text: string) => text.split(' ');
/** Every word of the text fits the room: what wraps is never broken, and nothing overflows. */
const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  words(text).every((word) => measure(word) <= room);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** A tool cell's text in a row of four: the row less its gaps, shared equally, less the cell's padding and border. */
const toolRoom = (width: number) =>
  (column(width) - 3 * space.sm) / 4 - 2 * space.sm - 2 * layout.iconBorder;
/** A strip slot: the row less its gaps, shared equally by the strip's three slots (set, note, ends). */
const stripSlot = (width: number) => (column(width) - 2 * space.sm) / 3;
/** A strip of two (a default waiting, an ending): the note takes one of two slots. */
const stripHalf = (width: number) => (column(width) - space.sm) / 2;
/** Inside a half: the column less the side bar and the half's padding (space.md a side). */
const halfInner = (width: number) => column(width) - layout.padSideBar - 2 * space.md;
/** A step sheet's content: the screen less its padding. A choice's text: less its own padding and border. */
const sheet = (width: number) => width - 2 * space.md;
const choice = (width: number) => sheet(width) - 2 * space.md - 2 * layout.iconBorder;
/** The result card's text: the column less the card's padding and its edge. */
const cardRoom = (width: number) => column(width) - 2 * space.md - layout.padSideBar;

describe('tennis: the tool row at 320 and 360 in four languages', () => {
  const fits = (label: string, room: number) =>
    linesOf(label, room, toolWidth) <= layout.padToolLines && wordsFit(label, room, toolWidth);

  it('leaves each cell’s text 48 dp at 320 and 58 at 360 (a row of four)', () => {
    expect(WIDTHS.map(toolRoom)).toEqual([48, 58]);
  });

  it.each(LANGUAGES)(
    '%s: every drawn label (the short Violation and Award game, Break, Set score) in its lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const labels = ['tool.violationShort', 'tool.break', 'tool.awardShort', 'tool.setScore'].map(
        (key) => said(dictionary, `${TN}.${key}`),
      );
      for (const label of labels)
        for (const width of WIDTHS)
          expect(fits(label, toolRoom(width)), `${label} @${width}`).toBe(true);
    },
  );

  // Ruling 232: a label wider than its cell at 320 takes a short form with the full word said, and only then. The full words
  // are measured too, so the short form is never drawn where the full one fits, and where it is the same word it is the full.
  it.each(LANGUAGES)(
    '%s: the short form is drawn exactly where the full word does not fit a cell at 320',
    (_lang, dictionary: Dictionary) => {
      for (const [full, short] of [
        ['tool.violation', 'tool.violationShort'],
        ['tool.award', 'tool.awardShort'],
      ] as const) {
        const longWord = said(dictionary, `${TN}.${full}`);
        const drawn = said(dictionary, `${TN}.${short}`);
        expect(drawn === longWord, longWord).toBe(fits(longWord, toolRoom(320)));
      }
    },
  );

  // Anti-vacuity: the full Violation does not fit in any language but one that has a short word of its own, so the short
  // form is needed; the Dutch "Overtr." (51.5 dp) is wider than the 48 dp cell and "Overtr" (47.6, the owner's ruling 236) is not.
  it('would not hold the full Violation in a cell at 320 in any language, which is why every language has a short word', () => {
    for (const [lang, dictionary] of LANGUAGES)
      expect(fits(said(dictionary, `${TN}.tool.violation`), toolRoom(320)), lang).toBe(false);
    expect(fits('Overtr.', toolRoom(320))).toBe(false);
    expect(fits('Overtr', toolRoom(320))).toBe(true);
    expect(said(nl, `${TN}.tool.violationShort`)).toBe('Overtr');
  });

  // The Spanish and French "Infrac." fitted a 48 dp cell by 0.1 dp, and Android rounds to whole px (B2 review): "Infr." has room.
  it('draws "Infr." in Spanish and French, with at least 2 dp of margin in the 320 cell (the fit assertion kept)', () => {
    for (const dictionary of [es, fr]) {
      const drawn = said(dictionary, `${TN}.tool.violationShort`);
      expect(drawn).toBe('Infr.');
      expect(fits(drawn, toolRoom(320))).toBe(true);
      expect(toolRoom(320) - toolWidth(drawn)).toBeGreaterThanOrEqual(2);
    }
    expect(toolRoom(320) - toolWidth('Infrac.')).toBeLessThan(2);
  });

  it('would not hold the full Award game in French or Dutch, which is why they have a short word', () => {
    const wide = LANGUAGES.filter(
      ([, dictionary]) => !fits(said(dictionary, `${TN}.tool.award`), toolRoom(320)),
    ).map(([lang]) => lang);
    expect(wide).toEqual(['fr', 'nl']);
  });
});

// Ruling 234 (Task 17): while a detailed point is held its chips stand in the tools' place, at most three (Ace or Double
// fault, Winner, Error), sharing the row as the tools do (no fixed slots). Every drawn chip in its lines with no word broken;
// a four-cell row would not hold them, so the room measured is the three-cell row's.
describe('tennis: the point chips at 320 and 360 in four languages', () => {
  /** A cell's text in a row of three: the row less its two gaps, shared equally, less the cell's padding and border. */
  const chipRoom = (width: number) =>
    (column(width) - 2 * space.sm) / 3 - 2 * space.sm - 2 * layout.iconBorder;
  const fits = (label: string, room: number) =>
    linesOf(label, room, toolWidth) <= layout.padToolLines && wordsFit(label, room, toolWidth);
  const CHIPS = ['chip.ace', 'chip.doubleFault', 'chip.winner', 'chip.error'];

  it('leaves each chip’s text 72.67 dp at 320 and 86 at 360 (a row of three)', () => {
    expect(WIDTHS.map((width) => Number(chipRoom(width).toFixed(2)))).toEqual([72.67, 86]);
  });

  it.each(LANGUAGES)(
    '%s: every drawn chip in its lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of CHIPS)
        for (const width of WIDTHS) {
          const label = said(dictionary, `${TN}.${key}`);
          expect(fits(label, chipRoom(width)), `${label} @${width}`).toBe(true);
        }
    },
  );

  // Anti-vacuity: the Spanish Winner is wider than a cell of four at 320 (its word "ganador" is 56.7 dp against 48), so the
  // three-cell room is what holds it.
  it('would not hold the Spanish Winner in a cell of four at 320', () => {
    const toolRoom4 = (column(320) - 3 * space.sm) / 4 - 2 * space.sm - 2 * layout.iconBorder;
    expect(fits(said(es, `${TN}.chip.winner`), toolRoom4)).toBe(false);
  });

  it.each(LANGUAGES)(
    '%s: the Point details switch’s label on one line in the Match details sheet',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS) {
        // The sheet's content, less the row's padding, its gap and the 40 dp track (ChoiceRow, SwitchTrack).
        const room = sheet(width) - 2 * layout.switchRowPadX - space.sm - layout.switchTrackW;
        expect(
          linesOf(said(dictionary, `${TN}.details.switch`), room, controlWidth),
          `@${width}`,
        ).toBe(1);
      }
    },
  );
});

describe('tennis: the doubles server’s line beside the half’s foot at 320 and 360 in four languages', () => {
  // Ruling 235: "Ana Ruiz serves" in the half's bottom row, which `HalfFoot` never cuts (the counts and the hint give way
  // before it), so it must be whole in the half's inner width. The names are the longest a sheet gives a player here.
  const NAMES = ['Ana Ruiz', 'Eva Vega', 'Alexandra Wickenhauser'] as const;
  const line = (dictionary: Dictionary, person: string) =>
    controlWidth(fill(said(dictionary, `${TN}.serverPerson`), { person }));

  it.each(LANGUAGES)(
    '%s: the line is whole in the half’s inner width, for every sample name',
    (_lang, dictionary: Dictionary) => {
      for (const person of NAMES)
        for (const width of WIDTHS)
          expect(line(dictionary, person), `${person} @${width}`).toBeLessThanOrEqual(
            halfInner(width),
          );
    },
  );

  it('is measured against something real (anti-vacuity): a name twice as long does not fit at 320', () => {
    expect(line(en, 'Alexandra Wickenhauser Alexandra Wickenhauser')).toBeGreaterThan(
      halfInner(320),
    );
  });
});

describe('tennis: the strip at 320 and 360 in four languages', () => {
  const facts = (dictionary: Dictionary) => [
    fill(said(dictionary, `${TN}.setOf`), { set: '5', bestOf: '5' }),
    said(dictionary, `${TN}.breaker.tiebreak`),
    said(dictionary, `${TN}.breaker.matchTiebreak`),
    said(dictionary, `${TN}.note.deuce`),
    said(dictionary, `${TN}.note.decidingPoint`),
    said(dictionary, `${TN}.endsChange`),
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

  // A default waiting, or an ending, takes the two slots' room for itself: two lines, no word broken, with the longest
  // staging name the organiser can type on the side (the cut is an ellipsis, never a broken word).
  const SAID_LINES = 2;
  const LONG = 'Springfield Tennis Club';
  it.each(LANGUAGES)(
    '%s: the waiting default and every ending in two lines of a two-slot strip, no word broken, inside the strip’s reserved height',
    (_lang, dictionary: Dictionary) => {
      const word = (kind: string) => said(dictionary, `${TN}.ending.${kind}`);
      const texts = [
        said(dictionary, `${TN}.endingPending`),
        ...['retired', 'defaulted', 'walkover', 'withdrew', 'abandoned'].map(word),
        ...['retired', 'defaulted', 'walkover', 'withdrew'].map((kind) =>
          fill(said(dictionary, `${TN}.ending.by`), { ending: word(kind), side: LONG }),
        ),
      ];
      for (const text of texts)
        for (const width of WIDTHS) {
          expect(wordsFit(text, stripHalf(width), unitWidth), `${text} @${width}`).toBe(true);
          expect(
            linesOf(text, stripHalf(width), unitWidth),
            `${text} @${width}`,
          ).toBeLessThanOrEqual(SAID_LINES);
          // The reserved height: SAID_LINES strip lines, one line of which the strip always holds.
          expect(
            linesOf(text, stripHalf(width), unitWidth) * typeScale.metricUnit.lineHeight,
            `${text} @${width}`,
          ).toBeLessThanOrEqual(SAID_LINES * typeScale.metricUnit.lineHeight);
        }
    },
  );
});

describe('tennis: the serve plate at 320 and 360 in four languages', () => {
  const plateWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;

  // The plate shares a half's head with the names: it takes at most two fifths of the inner width (volleyball ships the same words), with its padding.
  it.each(LANGUAGES)(
    '%s: "Serving" in two fifths of a half’s head',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(
          plateWidth(said(dictionary, `${TN}.serving`)) + 2 * space.sm,
          `${lang} @${width}`,
        ).toBeLessThanOrEqual((halfInner(width) * 2) / 5);
    },
  );
});

/**
 * A pad half's height, ARITHMETIC as `volleyballFit.test.ts` writes it out (not measured, not imported): 32 (the safe area
 * above) + 48 (the top bar) + the strip + 54 (the last-tap line, three lines) + 48 (the tool row) + five 8 dp gaps, shared by
 * two halves: 201 at 320 × 640, 243 at 360 × 724. Whether text stays inside on a phone is the device's.
 */
const HALF_FIXED =
  32 + 48 + layout.padStripLines * typeScale.metricUnit.lineHeight + 54 + 48 + 5 * 8;
const PHONES = [
  [320, 640],
  [360, 724],
] as const;
const halfAt = (height: number) => (height - HALF_FIXED) / 2;

describe('tennis: a half’s scoreboard row at 320 and 360 in four languages (rulings 240, 242)', () => {
  /** `boardLabel`: Barlow Condensed 600 at 12, uppercase, letter-spaced. */
  const labelWidth = (text: string) =>
    barlow600.width(text.toUpperCase(), typeScale.boardLabel.fontSize) +
    typeScale.boardLabel.letterSpacing * [...text].length;
  /** A set's box: two tabular digits of `boardScore` and the box's padding, never under `padBoardBox`. */
  const boxWidth = Math.max(
    layout.padBoardBox,
    barlow700.width('00', typeScale.boardScore.fontSize) + 2 * space.xs,
  );
  /** The items' room: the half's inner width less the gap and the word Tap, which gives way before them. */
  const itemsRoom = (width: number, dictionary: Dictionary) =>
    halfInner(width) - space.sm - unitWidth(said(dictionary, 'scoring.pad.tap'));
  const DOT = layout.padDot + layout.padDotGap;
  /** Lines the row's items take: the label and the boxes, then the dots wrapping after them. */
  const rowLines = (room: number, dictionary: Dictionary, sets: number, dots: number) => {
    const lead0 =
      sets === 0
        ? 0
        : labelWidth(said(dictionary, `${TN}.board.sets`)) +
          space.xs +
          sets * (boxWidth + space.xs);
    // The label and boxes themselves wrap when they are wider than the room (a sixth set in French at 320).
    const lead = Math.min(lead0, room);
    const extra = lead0 > room ? 1 : 0;
    const first = Math.max(0, Math.floor((room - lead + layout.padDotGap) / DOT));
    const rest = Math.max(0, dots - first);
    return 1 + extra + Math.ceil(rest / Math.max(1, Math.floor((room + layout.padDotGap) / DOT)));
  };

  /** What the games row says of its games, per language: they were won, so a listener cannot take them for games played. */
  const WON_WORD = { en: /won/i, es: /ganados/i, fr: /gagnés/i, nl: /gewonnen/i } as const;

  it('keeps a numbered dot at the owner’s floor of 20 dp', () => {
    expect(layout.padDot).toBeGreaterThanOrEqual(20);
  });

  // The engine allows any odd best of, so the sweep is 3, 5 and 7: two, four and six sets can be over while a set is under way.
  it.each(LANGUAGES)(
    '%s: the Sets label and the finished-set boxes of a best of 3 and 5 (up to four) stand on one line, a best of 7 (six) in at most two, at both widths',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const sets of [2, 4, 6]) {
          const need =
            labelWidth(said(dictionary, `${TN}.board.sets`)) + sets * (boxWidth + space.xs);
          expect(need, `${lang} ${sets} sets @${width}`).toBeLessThanOrEqual(
            itemsRoom(width, dictionary) * (sets === 6 ? 2 : 1),
          );
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: twelve dots beside four and six set boxes wrap to at most three lines (four beside six), the dots never under 20 dp',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const sets of [4, 6])
          expect(
            rowLines(itemsRoom(width, dictionary), dictionary, sets, 12),
            `${lang} ${sets} sets @${width}`,
          ).toBeLessThanOrEqual(sets === 6 ? 4 : 3);
    },
  );

  it.each(LANGUAGES)(
    '%s: twelve dots (6-6) beside two set boxes take at most two lines, one beside none',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS) {
        const room = itemsRoom(width, dictionary);
        expect(rowLines(room, dictionary, 2, 12), `${lang} @${width}`).toBeLessThanOrEqual(2);
        expect(rowLines(room, dictionary, 0, 12), `${lang} @${width}`).toBeLessThanOrEqual(2);
      }
    },
  );

  // Anti-vacuity: the dots do not all fit one line beside two boxes at 320 (that is why they wrap), and fewer do.
  it('would not hold twelve dots on the line beside two set boxes at 320, and holds five', () => {
    expect(rowLines(itemsRoom(320, en), en, 2, 12)).toBe(2);
    expect(rowLines(itemsRoom(320, en), en, 2, 5)).toBe(1);
  });

  it.each(LANGUAGES)(
    '%s: a screen reader’s "Games won 3: …" and "Sets: …" words are filled, and say the games were won',
    (lang, dictionary: Dictionary) => {
      const spoken = fill(said(dictionary, `${TN}.board.gamesWon`), {
        count: '3',
        games: '1, 3, 4',
      });
      expect(spoken).toContain('3');
      expect(spoken).toContain('1, 3, 4');
      expect(spoken).toMatch(WON_WORD[lang]);
      expect(said(dictionary, `${TN}.board.said`)).toContain('{label}');
    },
  );
});

// Break point, set point and match point on a half (owner, 2026-11-13; ruling "own line, always kept": the score never moves). A
// live half's scoreboard row always keeps ONE plate-height line under its boxes, dots and Tap, whether a plate shows or not,
// and the plate draws on it at the left, never among the dots. The rooms are written out from the tokens and the type scale:
// a plate is its word (`state`, Barlow Condensed 700, uppercase, letter-spaced) and `space.sm` of padding each side; the line
// is the `state` line (17) and the dots' row gap (2). Whether it looks right on a phone is the device check's.
describe('tennis: the call plate on its own line in a half at 320 and 360 in four languages', () => {
  const CALLS = ['breakPoint', 'setPoint', 'matchPoint'] as const;
  const plateWord = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;
  const plate = (dictionary: Dictionary, call: (typeof CALLS)[number]) =>
    plateWord(said(dictionary, `scoring.pad.call.${call}`)) + 2 * space.sm;
  /** The reserved line: a plate's line and the dots' row gap. */
  const RESERVE = 17 + 2;

  it('uses the tokens it is written from', () => {
    expect([typeScale.state.lineHeight, layout.padDotGap, layout.padCallMinScale]).toEqual([
      17, 2, 0.7,
    ]);
    expect(WIDTHS.map(halfInner)).toEqual([252, 292]);
    expect(typeScale.state.lineHeight + layout.padDotGap).toBe(RESERVE);
  });

  it.each(LANGUAGES)(
    '%s: every plate word has its own whole line at 320 and 360, no cut, and none needs the 0.7 shrink',
    (lang, dictionary: Dictionary) => {
      for (const call of CALLS) {
        expect(plate(dictionary, call), `${lang} ${call}`).toBeGreaterThan(2 * space.sm);
        for (const width of WIDTHS)
          expect(plate(dictionary, call), `${lang} ${call} @${width}`).toBeLessThanOrEqual(
            halfInner(width),
          );
      }
    },
  );

  // The widest word is Spanish "Punto de partido" (about 135 dp) in 252: the line holds it with 117 dp to spare.
  it('has the widest plate, Spanish match point, at under 0.6 of the line at 320', () => {
    const widest = Math.max(
      ...LANGUAGES.flatMap(([, dictionary]) => CALLS.map((call) => plate(dictionary, call))),
    );
    expect(widest / halfInner(320)).toBeLessThan(0.6);
  });

  // The vertical budget with the reserve: a half holds, at the smallest call (`scoreCompact`, 68), its padding (2 x 16), the names'
  // two lines (22 each), the doubles server's line (18), the call, the row (22, and 22 for each wrapped dot line) and the
  // reserved line. The worst best-of-5 row (four boxes, six dots) is two lines at 320 in every language (the dots' own tests above).
  const content = (rowLines: number, server: boolean) =>
    2 * space.md +
    2 * 22 +
    (server ? 18 : 0) +
    typeScale.scoreCompact.lineHeight +
    22 +
    (rowLines - 1) * (layout.padDot + layout.padDotGap) +
    RESERVE;

  it('puts the worst best-of-5 row over the 320 x 640 budget by 6 dp (singles) and 24 dp (doubles); both fit 360 x 724', () => {
    expect(halfAt(640)).toBe(201);
    expect([content(2, false) - halfAt(640), content(2, true) - halfAt(640)]).toEqual([6, 24]);
    expect(content(2, true)).toBeLessThanOrEqual(halfAt(724));
  });

  it('holds a one-line row in a singles half at 320 x 640, and a doubles half is over by 2 dp', () => {
    expect(content(1, false)).toBeLessThanOrEqual(halfAt(640));
    expect(content(1, true) - halfAt(640)).toBe(2);
  });
});

// Review I1 (Task 18 fix round 1): the vertical budget of the worst live board. A half holds, at the smallest call
// (`scoreCompact`, 68): its padding (2 × 16), the names' two lines (22 each), the doubles server's line (18), the call and the
// scoreboard row, whose first line is 22 and each wrapped dot line 20 + the 2 dp dot gap.
describe('tennis: the worst live scoreboard fits a half’s height (arithmetic; ruling 242)', () => {
  const labelWidth = (text: string) =>
    barlow600.width(text.toUpperCase(), typeScale.boardLabel.fontSize) +
    typeScale.boardLabel.letterSpacing * [...text].length;
  const boxWidth = Math.max(
    layout.padBoardBox,
    barlow700.width('00', typeScale.boardScore.fontSize) + 2 * space.xs,
  );
  const DOT = layout.padDot + layout.padDotGap;
  /** Lines of the row beside `sets` finished-set boxes and twelve dots, as the width model of the row above counts them. */
  const linesOfDots = (width: number, dictionary: Dictionary, sets: number, dots: number) => {
    const room = halfInner(width) - space.sm - unitWidth(said(dictionary, 'scoring.pad.tap'));
    const lead =
      labelWidth(said(dictionary, `${TN}.board.sets`)) + space.xs + sets * (boxWidth + space.xs);
    const first = Math.max(0, Math.floor((room - lead + layout.padDotGap) / DOT));
    return 1 + Math.ceil(Math.max(0, dots - first) / Math.floor((room + layout.padDotGap) / DOT));
  };
  const rowHeight = (lines: number) => 22 + (lines - 1) * (layout.padDot + layout.padDotGap);
  const content = (lines: number, server: boolean) =>
    2 * space.md +
    2 * 22 +
    (server ? 18 : 0) +
    typeScale.scoreCompact.lineHeight +
    rowHeight(lines) +
    (typeScale.state.lineHeight + layout.padDotGap);

  it('uses the tokens it is written from', () => {
    expect([typeScale.scoreCompact.lineHeight, typeScale.label.lineHeight, layout.padDot]).toEqual([
      68, 22, 20,
    ]);
    expect([halfAt(640), halfAt(724)]).toEqual([201, 243]);
  });

  it.each(LANGUAGES)(
    '%s: best of 5 (four sets over) with twelve dots, doubles’ server line included, fits the half at 360 × 724',
    (lang, dictionary: Dictionary) => {
      const lines = linesOfDots(360, dictionary, 4, 6);
      expect(content(lines, true), `${lang} ${lines} lines`).toBeLessThanOrEqual(halfAt(724));
    },
  );

  // Round 2 (coordinator): dots are the games THIS side won, and a side wins at most six in a set that ends or goes to a
  // tie-break (6-6 is six dots each), so the realistic worst is four sets over and six dots with two-digit labels (2, 4, 6, 8,
  // 10, 12) in a doubles half, es/fr. At 320 × 640 the half is 201.
  it('draws a two-digit game number inside the 20 dp dot', () => {
    expect(barlow700.width('12', typeScale.dotNumber.fontSize)).toBeLessThanOrEqual(layout.padDot);
  });

  it.each(LANGUAGES)(
    '%s: four sets over and six dots take two lines: with the kept call line a singles half is over the 320 × 640 budget by 6 dp and a doubles half by 24 dp',
    (lang, dictionary: Dictionary) => {
      const lines = linesOfDots(320, dictionary, 4, 6);
      expect(lines, lang).toBe(2);
      expect(content(lines, false) - halfAt(640), lang).toBe(6);
      expect(content(lines, true) - halfAt(640), lang).toBe(24);
    },
  );

  // DEVICE-ONLY known overflow: an advantage set (no tie-break, where the cfg allows) can pass six games won; twelve dots
  // beside four sets over take a third line in es/fr. Pinned (doubles) so it cannot grow unseen; the overflow lands in the
  // half's padding first.
  it.each([
    ['en', en, 24],
    ['es', es, 46],
    ['fr', fr, 46],
    ['nl', nl, 24],
  ] as const)(
    '%s: twelve dots (an advantage set) beside four sets over, doubles, are over the 320 × 640 budget by %i dp',
    (lang, dictionary: Dictionary, over) => {
      const lines = linesOfDots(320, dictionary, 4, 12);
      expect(Math.max(0, content(lines, true) - halfAt(640)), lang).toBe(over);
    },
  );

  it('two dot lines (twelve dots beside two set boxes) put a singles half over 320 × 640 by 6 dp, with the call’s kept line', () => {
    expect(content(linesOfDots(320, en, 2, 12), false) - halfAt(640)).toBe(6);
  });
});

describe('tennis: the final board at 320 and 360 in four languages (ruling 239)', () => {
  const labelWidth = (text: string) =>
    barlow600.width(text.toUpperCase(), typeScale.boardLabel.fontSize) +
    typeScale.boardLabel.letterSpacing * [...text].length;
  const digits = (text: string) => barlow700.width(text, typeScale.finalScore.fontSize);
  const small = (text: string) => barlow700.width(text, typeScale.boardScore.fontSize);
  /** A box's start: its basis, but never under what its label or value needs (a bracket's box starts at its own basis). */
  const start = (label: string, value: string, bracket: string) =>
    Math.max(
      bracket === '' ? layout.padFinalBox : layout.padFinalBoxBracket,
      labelWidth(label),
      digits(value) + (bracket === '' ? 0 : small(`(${bracket})`)) + 2 * space.xs,
    );
  /** Lines the board takes in a room: boxes fill a line in order, a box that does not fit wraps (never shrunk below its start). */
  const lines = (starts: readonly number[], room: number) => {
    let used = 0;
    let rows = 1;
    for (const one of starts) {
      const need = used === 0 ? one : used + space.xs + one;
      if (need > room && used !== 0) {
        rows += 1;
        used = one;
      } else used = need;
    }
    return rows;
  };
  /** A finished best of `bestOf`: `sets` boxes (the last the match tie-break when `mtb`), a bracket on each of `brackets`, and Sets. */
  const board = (
    dictionary: Dictionary,
    sets: number,
    mtb: boolean,
    brackets: readonly number[],
  ) => {
    const labels = Array.from({ length: sets }, (_, at) =>
      mtb && at === sets - 1
        ? said(dictionary, `${TN}.board.mtb`)
        : fill(said(dictionary, `${TN}.board.set`), { set: String(at + 1) }),
    );
    const boxes = labels.map((label, at) =>
      start(label, mtb && at === sets - 1 ? '10' : '7', brackets.includes(at) ? '10' : ''),
    );
    return [...boxes, start(said(dictionary, `${TN}.board.sets`), '3', '')];
  };

  // The engine allows any odd best of (nested kernel: `bestOf must be odd`), so 3, 5 and 7 are swept; the room is the half's
  // inner width. One line where it fits, two at most for the worst board: five or seven sets, a tie-break bracket on every
  // loser box, and a match tie-break decider.
  it.each(LANGUAGES)(
    '%s: best of 3, 5 and 7 in at most two lines at both widths, brackets and a match tie-break included',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const [bestOf, sets] of [
          [3, 3],
          [5, 5],
          [7, 7],
        ] as const)
          for (const mtb of [false, true]) {
            const everyBox = Array.from({ length: sets }, (_, at) => at);
            expect(
              lines(board(dictionary, sets, mtb, everyBox), halfInner(width)),
              `${lang} best of ${bestOf} mtb ${mtb} @${width}`,
            ).toBeLessThanOrEqual(2);
          }
    },
  );

  // Review I1 (Task 18 fix round 1): the half's height. The final half has no bottom row: its padding (at least 8 dp a side),
  // the names' two lines (22 each) and the board, each of its lines a label (14), a 4 dp gap and a `finalScore` (48), the lines
  // 4 dp apart. The worst board is a best of 5 with a bracket on every loser box.
  it.each(LANGUAGES)(
    '%s: the worst final board (five sets, every bracket, and Sets) fits a half at 320 × 640 and 360 × 724',
    (lang, dictionary: Dictionary) => {
      for (const [width, height] of PHONES) {
        const rows = lines(board(dictionary, 5, false, [0, 1, 2, 3, 4]), halfInner(width));
        const content = 2 * space.sm + 2 * 22 + rows * (14 + 4 + 48) + (rows - 1) * 4;
        expect(content, `${lang} ${rows} rows @${width}`).toBeLessThanOrEqual(halfAt(height));
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: a best of 3 with a bracket stands on one line',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(lines(board(dictionary, 3, false, [0]), halfInner(width)), `${lang} @${width}`).toBe(
          1,
        );
    },
  );

  // Anti-vacuity: a board with more boxes than a line holds does wrap at 320, and eleven sets would take three lines.
  it('wraps a best of 7 at 320 to a second line, and would need three or more for a best of 15', () => {
    expect(lines(board(en, 7, false, []), halfInner(320))).toBe(2);
    expect(lines(board(en, 15, false, []), halfInner(320))).toBeGreaterThanOrEqual(3);
  });

  it(
    'keeps the boxes' +
      ' start above the digits it holds (a two-digit match tie-break score fits its basis)',
    () => {
      expect(digits('10') + 2 * space.xs).toBeLessThanOrEqual(layout.padFinalBoxMax);
      expect(digits('6') + small('(10)') + 2 * space.xs).toBeLessThanOrEqual(
        layout.padFinalBoxBracket,
      );
    },
  );

  it.each(LANGUAGES)(
    '%s: the WON plate, "Final" and the strip’s slot',
    (lang, dictionary: Dictionary) => {
      const plate = (text: string) =>
        barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
        typeScale.state.letterSpacing * [...text].length;
      for (const width of WIDTHS) {
        expect(
          plate(said(dictionary, `${TN}.board.won`)) + 2 * space.sm,
          `${lang} @${width}`,
        ).toBeLessThanOrEqual((halfInner(width) * 2) / 5);
        expect(
          linesOf(said(dictionary, `${TN}.final`), stripSlot(width), unitWidth),
          `${lang} @${width}`,
        ).toBe(1);
      }
    },
  );
});

describe('tennis: History’s game headings at 320 and 360 in four languages (ruling 238)', () => {
  const headingWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;
  const LONG = 'Anastasia Vandenberghe-Oyelaran / Konstantinos Wolfeschlegelstein';
  const KEYS = [
    'game',
    'gameNoServer',
    'gameWon',
    'gameWonNoServer',
    'tiebreak',
    'tiebreakWon',
    'matchTiebreak',
    'matchTiebreakWon',
  ] as const;

  it.each(LANGUAGES)(
    '%s: every heading, with two doubles pairs for server and winner, in the cover’s column in at most five lines (two 65-character pairs is the extreme), no word broken',
    (lang, dictionary: Dictionary) => {
      for (const key of KEYS) {
        const text = fill(said(dictionary, `${TN}.history.${key}`), {
          set: '3',
          game: '12',
          server: LONG,
          winner: LONG,
        });
        for (const width of WIDTHS) {
          expect(wordsFit(text, column(width), headingWidth), `${lang} ${key} @${width}`).toBe(
            true,
          );
          expect(
            linesOf(text, column(width), headingWidth),
            `${lang} ${key} @${width}`,
          ).toBeLessThanOrEqual(5);
        }
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: a singles heading is one or two lines',
    (lang, dictionary: Dictionary) => {
      for (const key of KEYS) {
        const text = fill(said(dictionary, `${TN}.history.${key}`), {
          set: '3',
          game: '12',
          server: 'Ana Ruiz',
          winner: 'Bea Lund',
        });
        for (const width of WIDTHS)
          expect(
            linesOf(text, column(width), headingWidth),
            `${lang} ${key} @${width}`,
          ).toBeLessThanOrEqual(2);
      }
    },
  );
});

describe('tennis: the rules rows and the result card at 320 and 360 in four languages', () => {
  const ROOMS = {
    card: (width: number) => column(width) - 2 * space.md - layout.padSideBar,
    sheet: (width: number) => width - 2 * space.md,
    start: (width: number) => column(width),
  } as const;
  /** Every row at its widest: a Grand Slam's, in double digits. */
  const rows = (dictionary: Dictionary) => {
    const at = { at: '12', to: '10' };
    return [
      ['format.label', 'bestOf', { bestOf: '5' }],
      ['set.label', 'gamesTo', { gamesTo: '12' }],
      ['tiebreak.label', 'tiebreakAt', at],
      ['tiebreak.label', 'noTiebreak', {}],
      ['game.label', 'noAd', {}],
      ['finalSet.label', 'finalTiebreak', at],
      ['finalSet.label', 'finalMatchTiebreak', { to: '10' }],
    ].map(([label, value, vars]) => ({
      label: said(dictionary, `${TN}.rules.${String(label)}`),
      value: fill(said(dictionary, `${TN}.rules.${String(value)}`), vars as Record<string, string>),
    }));
  };
  const labelColumn = (labels: readonly string[]) =>
    Math.min(Math.ceil(Math.max(...labels.map(bodyWidth))), layout.padRuleLabelMax);

  it.each(LANGUAGES)(
    '%s: no rule label or value has a word wider than its room, in the card, the sheet and the Start screen',
    (_lang, dictionary: Dictionary) => {
      const table = rows(dictionary);
      const labels = table.map((row) => row.label);
      const column = labelColumn(labels);
      for (const width of WIDTHS)
        for (const room of Object.values(ROOMS).map((of) => of(width)))
          for (const { label, value } of table) {
            expect(wordsFit(label, column, bodyWidth), label).toBe(true);
            expect(wordsFit(value, room - column - space.md, bodyWidth), value).toBe(true);
          }
    },
  );

  it.each(LANGUAGES)(
    '%s: the result title keeps every word whole with the longest name and five sets with tie-breaks',
    (_lang, dictionary: Dictionary) => {
      const sets = '7–6(5) 6–7(10) 7–6(12) 6–7(5) [10–8]';
      const titles = [
        fill(said(dictionary, `${TN}.result`), { side: 'Springfield Tennis Club', sets }),
        ...['retired', 'defaulted', 'walkover', 'withdrew'].map((kind) =>
          fill(said(dictionary, `${TN}.ending.by`), {
            ending: said(dictionary, `${TN}.ending.${kind}`),
            side: 'Springfield Tennis Club',
          }),
        ),
      ];
      for (const title of titles)
        for (const width of WIDTHS)
          expect(wordsFit(title, cardRoom(width), panelWidth), `${title} @${width}`).toBe(true);
    },
  );

  it.each(LANGUAGES)(
    '%s: "Who serves first?" in the Start screen’s column',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(wordsFit(said(dictionary, `${TN}.start.ask`), column(width), panelWidth)).toBe(true);
    },
  );
});

describe('tennis: the violation, award and break sheets at 320 and 360 in four languages', () => {
  const SIDES = ['Ana Ruiz', 'Springfield Tennis Club', 'Ruiz / Vega h1 / Ruiz / Vega h2'] as const;
  const kinds = ['medical', 'toilet', 'heat', 'other'] as const;
  const levels = ['warning', 'pointPenalty', 'gamePenalty'] as const;

  it.each(LANGUAGES)(
    '%s: each sheet’s title in at most two lines, no word wider than the sheet',
    (_lang, dictionary: Dictionary) => {
      const titles = [
        'violation.title',
        'violation.who',
        'violation.confirm.title',
        'award.title',
        'award.confirm.title',
        'break.title',
        ...kinds.map((kind) => `break.kind.${kind}`),
      ].map((key) => said(dictionary, `${TN}.${key}`));
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
    '%s: each choice, no word wider than a choice’s text, and a long side in at most two lines',
    (_lang, dictionary: Dictionary) => {
      const texts = [
        ...levels.map((level) => said(dictionary, `${TN}.level.${level}`)),
        ...kinds.map((kind) => said(dictionary, `${TN}.break.kind.${kind}`)),
        said(dictionary, `${TN}.break.both`),
        said(dictionary, `${TN}.violation.confirm.action`),
        said(dictionary, `${TN}.award.confirm.action`),
        ...SIDES,
      ];
      for (const text of texts)
        for (const width of WIDTHS)
          expect(wordsFit(text, choice(width), controlWidth), `${text} @${width}`).toBe(true);
      for (const side of SIDES)
        for (const width of WIDTHS)
          expect(
            linesOf(side, choice(width), controlWidth),
            `${side} @${width}`,
          ).toBeLessThanOrEqual(2);
    },
  );

  // The sentences a step says in the body role: wrapping at spaces, never broken, in at most four lines.
  it.each(LANGUAGES)(
    '%s: the questions, the confirm lines and the done lines in at most five lines (two 65-character pairs is the extreme), no word broken',
    (_lang, dictionary: Dictionary) => {
      const side = SIDES[2];
      const lines = [
        said(dictionary, `${TN}.award.ask`),
        said(dictionary, `${TN}.break.askKind`),
        said(dictionary, `${TN}.break.askSide`),
        fill(said(dictionary, `${TN}.award.confirm.body`), { side }),
        fill(said(dictionary, `${TN}.violation.confirm.body`), {
          level: said(dictionary, `${TN}.level.gamePenalty`),
          who: side,
        }),
        fill(said(dictionary, `${TN}.violation.done.point`), { other: side }),
        fill(said(dictionary, `${TN}.violation.done.game`), { other: side }),
        said(dictionary, `${TN}.violation.done.breaker`),
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

describe('tennis: History’s rows and the last-tap line at 320 and 360 in four languages', () => {
  // As volleyball's: a row's sentence takes the column less the right column, in at most `padHistoryLines`.
  const room = (width: number) => column(width) - space.sm - layout.padHistorySide;
  const SIDES = ['Ana Ruiz', 'Ruiz / Vega', 'Springfield Tennis Club'] as const;
  const sentences = (dictionary: Dictionary, side: string) => {
    const longest = (keys: readonly string[]) =>
      keys
        .map((key) => said(dictionary, `${TN}.${key}`))
        .reduce((a, b) => (controlWidth(b) > controlWidth(a) ? b : a));
    const vars = {
      side,
      person: 'Ruiz / Vega h2',
      level: longest(['level.warning', 'level.pointPenalty', 'level.gamePenalty', 'level.default']),
      kind: longest([
        'break.kind.medical',
        'break.kind.toilet',
        'break.kind.heat',
        'break.kind.other',
      ]),
      set: '5',
      score: '7–6(10)',
    };
    return Object.keys(dictionary)
      .filter((key) => key.startsWith(`${TN}.last.`) || key.startsWith(`${TN}.undone.`))
      .map((key) => ({ key, text: fill(said(dictionary, key), vars) }));
  };

  it('reads the last-tap vocabulary (anti-vacuity): eleven last (the toss one of them) and five undone', () => {
    for (const [, dictionary] of LANGUAGES)
      expect(sentences(dictionary, 'Ana Ruiz')).toHaveLength(16);
  });

  it.each(LANGUAGES)(
    '%s: every sentence in the two lines of a History row, no word broken, for a player, a pair and a club',
    (lang, dictionary: Dictionary) => {
      for (const side of SIDES)
        for (const { key, text } of sentences(dictionary, side))
          for (const width of WIDTHS) {
            expect(
              linesOf(text, room(width), controlWidth),
              `${lang} ${key} ${side} @${width}`,
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
      const heading = fill(said(dictionary, `${TN}.setHeading`), { set: '5' });
      for (const width of WIDTHS) expect(linesOf(heading, column(width), headingWidth)).toBe(1);
    },
  );
});

describe('tennis: Set score’s sheet at 320 and 360 in four languages', () => {
  // The score sheet's title is the sheet's title role; a field's label shares its row with the two-touch-wide input.
  const field = (width: number) => sheet(width) - 2 * layout.touch - space.sm;
  const SIDES = ['Ana Ruiz', 'Springfield Tennis Club', 'Ruiz / Vega h1 / Ruiz / Vega h2'] as const;

  it.each(LANGUAGES)(
    '%s: the title in at most two lines, no word wider than the sheet',
    (_lang, dictionary: Dictionary) => {
      const title = fill(said(dictionary, `${TN}.setScore.title`), { set: '5' });
      for (const width of WIDTHS) {
        expect(wordsFit(title, sheet(width), titleWidth), `${title} @${width}`).toBe(true);
        expect(linesOf(title, sheet(width), titleWidth), `${title} @${width}`).toBeLessThanOrEqual(
          2,
        );
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: each field’s label, with the longest side, in at most three lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of ['games', 'tiebreak'])
        for (const side of SIDES)
          for (const width of WIDTHS) {
            const label = fill(said(dictionary, `${TN}.setScore.${key}`), { side });
            expect(wordsFit(label, field(width), controlWidth), `${label} @${width}`).toBe(true);
            expect(
              linesOf(label, field(width), controlWidth),
              `${label} @${width}`,
            ).toBeLessThanOrEqual(3);
          }
    },
  );
});

describe('tennis: every word it has is measured here (the sweep)', () => {
  // A key added to the dictionary must be named by a group above or below: a dead or unmeasured word fails here.
  const MEASURED: readonly RegExp[] = [
    /^tool\./,
    /^setOf$/,
    /^breaker\./,
    /^note\./,
    /^endsChange$/,
    /^endingPending$/,
    /^board\./,
    /^final$/,
    /^history\./,
    /^rules\./,
    /^ending\./,
    /^result$/,
    /^start\.ask$/,
    /^serverPerson$/,
    /^violation\./,
    /^award\./,
    /^break\./,
    /^last\./,
    /^undone\./,
    /^setHeading$/,
    /^setScore\./,
    /^chip\.(ace|doubleFault|winner|error)$/,
    /^details\.switch$/,
  ];
  /** Words the fit tests do not measure, each with the reason. */
  const ELSEWHERE: Readonly<Record<string, string>> = {
    'refusal.invalidScore':
      'the Set score refusal: a last-tap line, measured with the shared refusals in padFit.test.ts',
    hint: 'the half’s spoken hint: never drawn (the kit draws the word Tap)',
    serving: 'the plate’s word: the serve plate group above',
    setsTally: 'said to a screen reader only',
    'level.warning':
      'a level’s word: a screen reader, and the violation sheet’s choices (measured with the sheets)',
    'level.pointPenalty':
      'a level’s word: a screen reader, and the violation sheet’s choices (measured with the sheets)',
    'level.gamePenalty':
      'a level’s word: a screen reader, and the violation sheet’s choices (measured with the sheets)',
    'level.default':
      'a level’s word: a screen reader, and History’s sentences (measured with the History group)',
    player: 'a word standing for a name: measured inside the History sentences through the names',
    'chip.errorSaid': 'the Error chip’s full word: said to a screen reader only',
  };

  it('every scoring.tennis key is in a measured group or has its reason', () => {
    const unowned = Object.keys(en)
      .filter((key) => key.startsWith(`${TN}.`))
      .map((key) => key.slice(TN.length + 1))
      .filter((key) => !MEASURED.some((pattern) => pattern.test(key)) && !(key in ELSEWHERE));
    expect(unowned).toEqual([]);
  });

  it('names no key the dictionary lacks', () => {
    for (const key of Object.keys(ELSEWHERE))
      expect(Object.keys(en), key).toContain(`${TN}.${key}`);
  });
});
