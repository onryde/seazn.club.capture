import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import {
  BOARD_FULL_HEIGHT,
  boardTier,
  goalNumeralSize,
  clockHeroLine,
  clockHeroSize,
  goalSide,
  NOTE_HEIGHT,
  cardSwatchSize,
} from '@/ui/theme/columnBoard';
import { maxFontScale, typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// The football pad's fit (plan S2-5 P Task 12; S2-5 design §6; the controller's ruling 7), portrait, at 320 (the
// narrowest the pads are held to) and 360 dp (the owner's phone, 360 × 804) in four languages. As padFit.test.ts: the
// rooms are written out from the tokens, the type scale and the components' styles, the widths measured from the fonts
// the app ships, the copy read from the dictionaries. Nothing is read from the components. A string that does not fit
// is shortened in the dictionary, never set smaller. Whether real text stays inside on a phone is the device check's.

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
type Dictionary = Readonly<Record<string, string>>;
const WIDTHS = [320, 360] as const;

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist500 = loadFont('geist-500');

/** An uppercase, letter-spaced Barlow Condensed 600 role: a button's word, the period's line. */
const capsWidth = (role: 'actionSecondary' | 'diagSection') => (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale[role].fontSize) +
  typeScale[role].letterSpacing * [...text].length;
/** `actionSecondary`: a column button's word, Start and Pause, a tool's label. */
const actionWidth = capsWidth('actionSecondary');
/** `pausedTag`: the PAUSED tag's word, Barlow Condensed 600 at 12, 1.2 apart (ruling 152). */
const pausedWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.pausedTag.fontSize) +
  typeScale.pausedTag.letterSpacing * [...text].length;
/** `goalWord`: the Goal and Scored words under the numeral, Barlow Condensed 600 at 18, 2.52 apart (0.14em, ruling 152). */
const goalWordWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.goalWord.fontSize) +
  typeScale.goalWord.letterSpacing * [...text].length;
/** `diagSection`: the period under the clock. */
const periodWidth = capsWidth('diagSection');
/** `matchName`: Barlow Condensed 600 at 26, as typed. A team's name on its column. */
const nameWidth = (text: string) => barlow600.width(text, typeScale.matchName.fontSize);
/** `controlInk`: Geist 500 at 14. A sheet's row. */
const rowWidth = (text: string) => geist500.width(text, typeScale.controlInk.fontSize);
/** `metricUnit`: Geist 500 at 12. A column button's note ("No subs left"). */
const noteWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** Barlow Condensed 700 at `size`, tabular digits (`zero.tf`); every other glyph at its own advance. The clock and the scores. */
const digitsWidth = (text: string, size: number) =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        size,
    0,
  );
/** `clockHero`: the clock's 80 dp digits. */
const clockWidth = (text: string) => digitsWidth(text, typeScale.clockHero.fontSize);

const words = (text: string) => text.split(' ');
/** Every word of the text fits the room: what wraps is never broken at a letter, and nothing overflows. */
const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  words(text).every((word) => measure(word) <= room);
const said = (dictionary: Dictionary, key: string) => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/**
 * A team column's text: half the pad's column less the gap between the two (space.sm), less the column's padding
 * (space.sm a side). Its colour bar is on its top edge (ruling 147), so it takes no width.
 */
const teamText = (width: number) => (column(width) - space.sm) / 2 - 2 * space.sm;
/** A column button's text: the column's text less the button's own padding (space.sm a side; it has no border). */
const buttonText = (width: number) => teamText(width) - 2 * space.sm;
/** The Goal square's text: the column's text less its padding (space.xs a side). */
const squareText = (width: number) => teamText(width) - 2 * space.xs;
/** The three small squares' side: a third of the column's text less the two gaps (space.xs) between them (ruling 144). */
const smallText = (width: number) => (teamText(width) - 2 * space.xs) / 3;
/** The label's inset a side inside a small square (`layout.padSquareLabelInset`, owner build 1048). */
const SMALL_LABEL_INSET = 3;
/** A tool's text in a row of two (End of period and More): as padFit's `toolTextOf(2)`. */
const toolText = (width: number) =>
  (column(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
/** A sheet row's text: the screen less the sheet's padding and the row's (space.md a side each), less its border. */
const rowText = (width: number) => width - 4 * space.md - 2 * layout.iconBorder;
/** The clock's face is the pad's whole column wide (the plate is under it, not beside it). */
const faceRoom = (width: number) => column(width);

/** Names as an organiser types them: the fake's two teams, and two of 24 characters that need three lines a column. */
const FAKE_NAMES = ['Riverside FC', 'Northgate United'] as const;
const LONG_NAMES = ['Wanderers United Academy', 'Sheffield Wednesday Town'] as const;

describe('the rooms at 320, 360 and 412', () => {
  it('a team’s text is 170 at 412 and the small squares 38.7, 45.3 and 54 wide at 320, 360 and 412', () => {
    expect(teamText(412)).toBe(170);
    expect([320, 360, 412].map((width) => smallText(width).toFixed(1))).toEqual([
      '38.7',
      '45.3',
      '54.0',
    ]);
  });

  it('a team’s text is 124 and 144, a button’s 108 and 128, a tool’s 122 and 142, a sheet row’s 254 and 294', () => {
    expect(WIDTHS.map(teamText)).toEqual([124, 144]);
    expect(WIDTHS.map(buttonText)).toEqual([108, 128]);
    expect(WIDTHS.map(toolText)).toEqual([122, 142]);
    expect(WIDTHS.map(rowText)).toEqual([254, 294]);
  });
});

describe('a team’s name on its column (design §6.2: two lines, then an ellipsis)', () => {
  it('the long names have 24 characters', () => {
    expect(LONG_NAMES.map((name) => [...name].length)).toEqual([24, 24]);
  });

  it('the fake’s names take one line and two; two names of 24 characters need three, so both are cut at two', () => {
    for (const width of WIDTHS) {
      const lines = (name: string) => linesOf(name, teamText(width), nameWidth);
      expect(FAKE_NAMES.map(lines), `@${width}`).toEqual([1, 2]);
      for (const name of LONG_NAMES)
        expect(lines(name), `${name} @${width}`).toBeGreaterThan(layout.padNameLines);
    }
  });

  it('no word of them is broken at a letter', () => {
    for (const width of WIDTHS)
      for (const name of [...FAKE_NAMES, ...LONG_NAMES])
        expect(wordsFit(name, teamText(width), nameWidth), `${name} @${width}`).toBe(true);
  });

  // TeamColumn keeps two lines' room for any name (its `name` style): a name of one line, two, or cut at two stands
  // 60 dp tall, so the two columns' scores and buttons line up, and a long name never moves them.
  it('every name stands two lines tall, 60 dp: the score and the buttons under it never move', () => {
    const reserve = layout.padNameLines * typeScale.matchName.lineHeight;
    expect(reserve).toBe(60);
    for (const width of WIDTHS)
      for (const name of [...FAKE_NAMES, ...LONG_NAMES]) {
        const drawn = Math.min(linesOf(name, teamText(width), nameWidth), layout.padNameLines);
        expect(Math.max(reserve, drawn * typeScale.matchName.lineHeight), `${name} @${width}`).toBe(
          60,
        );
      }
  });
});

// The controller's fix-round ruling (a): a team's name shrinks to fit (down to `teamNameFloor`) before its two-line
// ellipsis, so no word breaks at a letter at 360 dp. A name with a word wider than the column is set on two lines at a
// gap (`splitInTwo`; the lines are written out here) and shrunk until its widest line fits. Whether a phone does so is
// the device check's (Android shrinks with no floor of its own but 4 dp).
describe('a team’s name shrunk to fit, no word broken (ruling a)', () => {
  /** The scale the lines need to sit in `room`: 1 when they fit as they are. */
  const scaleFor = (lines: readonly string[], room: number) =>
    Math.min(1, ...lines.map((line) => room / nameWidth(line)));
  const BROKEN = [
    ['Wolverhampton', 'Wanderers'],
    ['Borussia', 'Mönchengladbach'],
    ['AFC', 'Bournemouth'],
  ] as const;

  it('the long words: 145.1 and 165.6 dp, wider than the column at 360; Bournemouth 123.9, wider at 320 only', () => {
    expect(
      ['Wolverhampton', 'Mönchengladbach', 'Bournemouth'].map((word) => nameWidth(word).toFixed(1)),
    ).toEqual(['145.1', '165.6', '123.9']);
  });

  it('at 360 each needs no less than the floor: 0.99, 0.87 and 1, all at least 0.75', () => {
    expect(layout.teamNameFloor).toBe(0.75);
    const scales = BROKEN.map((lines) => scaleFor(lines, teamText(360)));
    expect(scales.map((scale) => scale.toFixed(2))).toEqual(['0.99', '0.87', '1.00']);
    for (const scale of scales) expect(scale).toBeGreaterThanOrEqual(layout.teamNameFloor);
  });

  it('at 320 Wolverhampton needs 0.85 and Bournemouth 1; Mönchengladbach 0.75, at the floor', () => {
    expect(BROKEN.map((lines) => scaleFor(lines, teamText(320)).toFixed(2))).toEqual([
      '0.85',
      '0.75',
      '1.00',
    ]);
  });
});

// The controller's fix-round 2 ruling (R1): on a compact board each name is one line, shrunk to fit. The fake's two
// names fit above the floor; a name of 23 or more characters needs about half its size, under the floor: iOS ends it in
// an ellipsis at 0.75, Android (no floor but 4 dp) shrinks it to about 12.5 dp at 320. A device check judges it.
describe('a team’s name on one line, on a compact board (ruling R1)', () => {
  const oneLine = (name: string, width: number) =>
    Math.min(1, teamText(width) / nameWidth(name)).toFixed(2);

  it('the fake’s names need 1 and 0.79 at 320, 1 and 0.92 at 360: at least the floor', () => {
    expect(FAKE_NAMES.map((name) => oneLine(name, 320))).toEqual(['1.00', '0.79']);
    expect(FAKE_NAMES.map((name) => oneLine(name, 360))).toEqual(['1.00', '0.92']);
  });

  it('a long name needs about half: 0.50 at 320 and 0.57 at 360, under the floor', () => {
    expect(['Wolverhampton Wanderers', ...LONG_NAMES].map((name) => oneLine(name, 320))).toEqual([
      '0.50',
      '0.49',
      '0.50',
    ]);
    expect(oneLine('Wolverhampton Wanderers', 360)).toBe('0.57');
    expect(Number(oneLine('Wolverhampton Wanderers', 360))).toBeLessThan(layout.teamNameFloor);
  });
});

describe('the clock hero at 320 and 360 in four languages (ruling 130)', () => {
  it('the longest reading, 120+15:00, is 335.9 dp of tabular digits at the hero size of 80', () => {
    expect(typeScale.clockHero.fontSize).toBe(80);
    expect(clockWidth('120+15:00').toFixed(1)).toBe('335.9');
  });

  // The hero never grows with the phone's font scale (`maxFontScale.clockHero`), so the widest reading shrinks to its
  // room by `room / 336` and the floor is the least it may shrink to. The time has the pad's whole column: the plate
  // stands under it.
  it('120+15:00 needs 0.86 of its size in the 288 dp face at 320 and 0.98 in the 328 at 360; never under the clock floor', () => {
    expect(maxFontScale.clockHero).toBe(1);
    expect(layout.clockFloor).toBe(0.85);
    expect(faceRoom(320)).toBe(288);
    expect((faceRoom(320) / clockWidth('120+15:00')).toFixed(2)).toBe('0.86');
    expect(faceRoom(360)).toBe(328);
    expect((faceRoom(360) / clockWidth('120+15:00')).toFixed(2)).toBe('0.98');
    for (const width of WIDTHS)
      expect(
        Math.min(1, faceRoom(width) / clockWidth('120+15:00')),
        `@${width}`,
      ).toBeGreaterThanOrEqual(layout.clockFloor);
  });

  it('the readings a match shows fit at the full size at 320, bar the longest extra-time ones, which shrink above the floor', () => {
    for (const reading of ['0:00', '45+2:30', '90+2:30', '105:00'])
      expect(clockWidth(reading), reading).toBeLessThanOrEqual(faceRoom(320));
    for (const reading of ['90+15:00', '120+15:00'])
      expect(faceRoom(320) / clockWidth(reading), reading).toBeGreaterThanOrEqual(
        layout.clockFloor,
      );
  });

  // Ruling 150: a tall phone's spare height grows the digits; the widest reading must still fit the face at the floor.
  it('the clock grows from 80 to at most 110, never past what 120+15:00 needs at the floor in the face: 80 at 320, 91 at 360, 106 at 412', () => {
    expect(layout.clockHeroMax).toBe(110);
    // The token is at least the measured width per dp of size (335.9 / 80 = 4.199).
    expect(layout.clockWidestEm).toBeGreaterThanOrEqual(clockWidth('120+15:00') / 80);
    const widest = (width: number) =>
      Math.floor(faceRoom(width) / (layout.clockWidestEm * layout.clockFloor));
    expect([320, 360, 412].map(widest)).toEqual([80, 91, 106]);
    for (const width of [320, 360, 412]) {
      const size = Math.min(layout.clockHeroMax, widest(width));
      expect(
        faceRoom(width) / (clockWidth('120+15:00') * (size / 80)),
        `@${width}`,
      ).toBeGreaterThanOrEqual(layout.clockFloor);
    }
    // A very tall board still stops at those, and a short one keeps 80.
    expect(
      [320, 360, 412].map((width) => clockHeroSize({ width: faceRoom(width), height: 2000 })),
    ).toEqual([80, 91, 106]);
    expect(clockHeroSize({ width: faceRoom(412), height: BOARD_FULL_HEIGHT })).toBe(80);
    expect(clockHeroLine(80)).toBe(typeScale.clockHero.lineHeight);
  });

  it('the compact board’s time, 30 dp, holds 120+15:00 in the face at both widths', () => {
    const time = digitsWidth('120+15:00', typeScale.tallyCompact.fontSize);
    expect(time.toFixed(1)).toBe('126.0');
    for (const width of WIDTHS) expect(time).toBeLessThanOrEqual(faceRoom(width));
  });

  // The period's line has the face's width, with its PAUSED tag (a word of its own, in a pill) beside it.
  it.each(LANGUAGES)(
    '%s: every period and break word takes one line beside the PAUSED tag, and Start, Pause and Resume fit their plate',
    (_lang, dictionary: Dictionary) => {
      const keys = Object.keys(dictionary).filter((key) =>
        /^scoring\.football\.(period|break)\./.test(key),
      );
      expect(keys.length).toBeGreaterThanOrEqual(13);
      const tag =
        pausedWidth(said(dictionary, 'scoring.football.clock.paused')) +
        2 * layout.pausedTagPadX +
        2 * layout.iconBorder;
      for (const key of keys)
        for (const width of WIDTHS)
          expect(
            linesOf(said(dictionary, key), faceRoom(width) - space.sm - tag, periodWidth),
            `${key} @${width}`,
          ).toBe(1);
      // The plate is the whole column: its word and glyph (14 wide, a gap) fit with the padding either side.
      for (const word of ['start', 'pause', 'resume'])
        for (const width of WIDTHS)
          expect(
            actionWidth(said(dictionary, `scoring.football.clock.${word}`)) + 14 + 2 * space.sm,
            `${word} @${width}`,
          ).toBeLessThanOrEqual(column(width));
    },
  );
});

describe('the column buttons at 320 and 360 in four languages', () => {
  it.each(LANGUAGES)(
    '%s: Missed on its one line in the full-width row, and the Goal and Scored words under the numeral',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS) {
        const label = said(dictionary, 'scoring.football.column.missed');
        expect(actionWidth(label), `${label} @${width}`).toBeLessThanOrEqual(buttonText(width));
      }
      for (const word of ['goal', 'scored'])
        for (const width of WIDTHS) {
          const label = said(dictionary, `scoring.football.column.${word}`);
          expect(goalWordWidth(label), `${label} @${width}`).toBeLessThanOrEqual(squareText(width));
        }
    },
  );

  // Ruling 144: three squares share the column's text, a third each less the gaps. The word's size is computed from the
  // square (`smallLabelFit`), tested with its literal widths in smallLabelFit.test.ts for every word, language and width.

  // Owner ruling 163: Yellow and Red are the card alone. A portrait 3:4 card, as large as the square holds inside the outline
  // (1 a side) and the inset (3 a side), on a 4 dp grid: the square is 38.7 wide and 48 tall at 320, 45.3 square at 360, 54 at
  // 412 (literal sums, not the function's own).
  it('the card in a small square is 30 by 40 at 320, 27 by 36 at 360 and 33 by 44 at 412', () => {
    expect(layout.padSquareLabelInset).toBe(SMALL_LABEL_INSET);
    expect(cardSwatchSize({ width: 38.7, height: 48 })).toEqual({ width: 30, height: 40 });
    expect(cardSwatchSize({ width: 45.3, height: 45.3 })).toEqual({ width: 27, height: 36 });
    expect(cardSwatchSize({ width: 54, height: 54 })).toEqual({ width: 33, height: 44 });
    expect(cardSwatchSize({ width: 0, height: 0 })).toEqual({ width: 27, height: 36 });
  });

  it('every card fits its square inside the outline and the inset, and is 3:4', () => {
    for (const [width, height] of [
      [38.7, 48],
      [45.3, 45.3],
      [54, 54],
    ] as const) {
      const card = cardSwatchSize({ width, height });
      expect(card.width * 4).toBe(card.height * 3);
      expect(card.width).toBeLessThanOrEqual(width - 2 - 6);
      expect(card.height).toBeLessThanOrEqual(height - 2 - 6);
    }
  });

  // A note is too long for a square, even in two lines (a word of fr "Plus de remplacement" is wider than the square), so
  // it takes the one line under the three, the column's whole text, shrunk to its floor; the square keeps its short word.
  it.each(LANGUAGES)(
    '%s: a disabled Sub’s note (No subs left, No team sheet) takes the one line under the squares, above the note floor',
    (_lang, dictionary: Dictionary) => {
      expect(layout.noteFloor).toBe(0.75);
      for (const word of ['noSubs', 'noSheet'])
        for (const width of WIDTHS) {
          const note = said(dictionary, `scoring.football.column.${word}`);
          expect(
            Math.min(1, teamText(width) / noteWidth(note)),
            `${note} @${width}`,
          ).toBeGreaterThanOrEqual(layout.noteFloor);
        }
    },
  );

  it('the small row is never under a touch target: the squares’ side at 320 and 360 is under 48, so the row keeps 48 (ruling 145)', () => {
    expect(smallText(320)).toBeLessThan(layout.touch);
    expect(smallText(360)).toBeLessThan(layout.touch);
    // 412 is wide enough for squares over 48: the row is as tall as they are wide.
    expect(smallText(412)).toBeGreaterThan(layout.touch);
  });
});

describe('the tool row at 320 and 360 in four languages', () => {
  it.each(LANGUAGES)(
    '%s: every End of period word and More in a row of two cells, in the tool’s lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const keys = [
        ...Object.keys(dictionary).filter((key) => key.startsWith('scoring.football.end.')),
        'scoring.football.tool.more',
      ];
      expect(keys.length).toBe(7);
      for (const key of keys)
        for (const width of WIDTHS) {
          const label = said(dictionary, key);
          expect(wordsFit(label, toolText(width), actionWidth), `${label} @${width}`).toBe(true);
          expect(
            linesOf(label, toolText(width), actionWidth),
            `${label} @${width}`,
          ).toBeLessThanOrEqual(layout.padToolLines);
        }
    },
  );
});

// Ruling 160's hold cue is the fill and the screen-reader name, not a line: the End of period cell is one height in every
// phase (H1, H2, ET1, ET2) and language. A cell is its lines (19 each, `actionSecondary`) plus the cell's padding (space.xs
// a side) and outline (1 a side), never under a touch target (48): two lines is 48, a third would be 67.
const PHASE_KEYS = ['HT', 'FT', 'ET_HT', 'ET_FT'] as const;
const cellHeight = (lines: number) =>
  Math.max(
    layout.touch,
    lines * typeScale.actionSecondary.lineHeight + 2 * space.xs + 2 * layout.iconBorder,
  );

// Owner, 2026-11-11: the board sits 5 dp up into the pad's gap under the top bar (`layout.footballBoardLift`), so the gap
// is 8 - 5 = 3 and the board is 5 dp taller; the clock's growth (ruling 150) takes it, then whatever is left sits below
// the cards. The columns' own sums are unchanged.
describe('the board 5 dp higher (owner, 2026-11-11)', () => {
  it('the gap under the top bar is 3 dp and the board gains the 5', () => {
    expect(layout.footballBoardLift).toBe(5);
    expect(space.sm - layout.footballBoardLift).toBe(3);
    const board = { width: 412, height: 600 };
    const before = clockHeroSize(board);
    const after = clockHeroSize({ width: 412, height: board.height + layout.footballBoardLift });
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after - before).toBeLessThanOrEqual(Math.ceil(layout.footballBoardLift / 1.06) + 1);
  });
});

// Owner ruling 164: the Adjust clock floor line names the minute and the way out. It is the sheet's `status` line (Geist 400
// at 13.5), the screen less the sheet's padding (space.md a side) wide, two lines allowed; the longest minute is "45+12'".
const geist400 = loadFont('geist-400');
const statusWidth = (text: string) => geist400.width(text, typeScale.status.fontSize);

describe('the Adjust clock floor line at 320 and 360 in four languages (ruling 164)', () => {
  const room = (width: number) => width - 2 * space.md;
  const LITERAL = {
    en: "Can't go before the last event (12'). Undo it first, or the organiser can fix it.",
    es: "No se puede antes del último evento (12'). Deshazlo o lo corrige el organizador.",
    fr: "Pas avant le dernier événement (12'). Annulez-le, ou l'organisateur le corrige.",
    nl: "Niet vóór de laatste gebeurtenis (12'). Maak die ongedaan, of vraag de organisator.",
  } as const;

  it.each(LANGUAGES)(
    '%s: names the minute, fills it literally, takes at most two lines',
    (lang, dictionary) => {
      const template = said(dictionary, 'scoring.football.correct.floor');
      expect(template).toContain('{minute}');
      expect(template.replace('{minute}', "12'")).toBe(LITERAL[lang]);
      for (const width of WIDTHS)
        for (const minute of ["12'", "45+2'", "90+12'"]) {
          const text = template.replace('{minute}', minute);
          expect(linesOf(text, room(width), statusWidth), `${text} @${width}`).toBeLessThanOrEqual(
            2,
          );
        }
    },
  );
});

describe('the End of period cell’s height at 320 and 360 (ruling 160)', () => {
  it('is 48 dp with two lines and 67 with three, from the tokens', () => {
    expect(typeScale.actionSecondary.lineHeight).toBe(19);
    expect(cellHeight(1)).toBe(48);
    expect(cellHeight(2)).toBe(48);
    expect(cellHeight(3)).toBe(67);
  });

  it.each(LANGUAGES)('%s: the cell is 48 dp in every phase', (_lang, dictionary: Dictionary) => {
    for (const marker of PHASE_KEYS)
      for (const width of WIDTHS) {
        const label = said(dictionary, `scoring.football.end.${marker}`);
        const lines = linesOf(label, toolText(width), actionWidth);
        expect(cellHeight(lines), `${label} @${width}`).toBe(48);
      }
  });
});

describe('the sheets’ rows at 320 and 360 in four languages (design §6.3)', () => {
  const PLAYERS = [...LONG_NAMES, 'Northampton Town Reserve'].map((name) => `#99 ${name}`);

  it('a player’s row, #99 and a name of 24 characters, takes one line', () => {
    for (const width of WIDTHS)
      for (const row of PLAYERS)
        expect(linesOf(row, rowText(width), rowWidth), `${row} @${width}`).toBe(1);
  });

  // A row has no line limit and is at least a touch target tall: two lines of 18 sit inside its 48 without growing it.
  it.each(LANGUAGES)(
    '%s: every row naming a team or a player, and every reason, in two lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const team = LONG_NAMES[0];
      const player = PLAYERS[0]!;
      const rows = [
        fill(said(dictionary, 'scoring.football.sheet.ownGoal'), { team }),
        fill(said(dictionary, 'scoring.football.more.penalty'), { team }),
        fill(said(dictionary, 'scoring.football.more.sinBin'), { team }),
        fill(said(dictionary, 'scoring.football.more.shot'), { team }),
        fill(said(dictionary, 'scoring.football.more.sinBinEnd'), { player }),
        // The concussion step (ruling 155): its title names the team, its two rows are words alone.
        fill(said(dictionary, 'scoring.football.sheet.whichSub'), { team }),
        // The shootout's More rows (ruling 156) are the card sheets' titles.
        fill(said(dictionary, 'scoring.football.sheet.yellow'), { team }),
        fill(said(dictionary, 'scoring.football.sheet.red'), { team }),
        ...Object.keys(dictionary)
          .filter((key) =>
            /^scoring\.football\.(reason|card|outcome)\.|^scoring\.football\.sheet\.(dontKnow|penalty|noAssist|noReason|normalSub|concussionSub)$/.test(
              key,
            ),
          )
          .map((key) => said(dictionary, key)),
      ];
      expect(rows.length).toBeGreaterThanOrEqual(30);
      expect(2 * typeScale.controlInk.lineHeight).toBeLessThanOrEqual(layout.touch);
      for (const row of rows)
        for (const width of WIDTHS) {
          expect(wordsFit(row, rowText(width), rowWidth), `${row} @${width}`).toBe(true);
          expect(linesOf(row, rowText(width), rowWidth), `${row} @${width}`).toBeLessThanOrEqual(2);
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: the “2nd yellow · sent off”, “None left” and “No subs left” notes take one line under a row, and the Yellow and Red titles keep their team',
    (_lang, dictionary: Dictionary) => {
      // The concussion step's notes (ruling 155) sit under a row the same way.
      const notes = ['sheet.secondYellow', 'sheet.noneLeft', 'column.noSubs'].map((key) =>
        said(dictionary, `scoring.football.${key}`),
      );
      for (const note of notes)
        for (const width of WIDTHS)
          expect(noteWidth(note), `${note} @${width}`).toBeLessThanOrEqual(rowText(width));
      for (const key of ['yellow', 'red'])
        expect(said(dictionary, `scoring.football.sheet.${key}`)).toContain('{team}');
    },
  );
});

/** A team's numeral in the Goal square: Barlow Condensed 700, tabular digits, at `scoreCompact` (64, full) or `tallyCompact` (30). */
const scoreWidth = (text: string, role: 'scoreCompact' | 'tallyCompact') =>
  digitsWidth(text, typeScale[role].fontSize);

/** The widest Goal or Scored word in any language, uppercase caps: what a compact square sets beside its numeral. */
const widestWord = (word: 'goal' | 'scored') =>
  Math.max(
    ...LANGUAGES.map(([, dictionary]) =>
      goalWordWidth(said(dictionary, `scoring.football.column.${word}`)),
    ),
  );
const widestSquareWord = Math.max(widestWord('goal'), widestWord('scored'));
// The controller's fix-round ruling (f): the numeral shrinks to fit its line and is never cut. "G (K)" in the shootout;
// two figures each is the widest a youth or mini match makes (ruling 104). The full square has the numeral over its word
// in the square's whole text; the compact one has it beside the word.
describe('a team’s numeral in the Goal square (ruling f)', () => {
  it('full: “10 (4)” is 148.2 dp, over the 136 at 360 less nothing: it needs 0.92; “10 (10)” is 180.1 and needs 0.64 at 320', () => {
    expect(squareText(320)).toBe(116);
    expect(squareText(360)).toBe(136);
    expect(scoreWidth('10 (4)', 'scoreCompact').toFixed(1)).toBe('148.2');
    expect((squareText(360) / scoreWidth('10 (4)', 'scoreCompact')).toFixed(2)).toBe('0.92');
    expect(scoreWidth('10 (10)', 'scoreCompact').toFixed(1)).toBe('180.1');
    expect((squareText(320) / scoreWidth('10 (10)', 'scoreCompact')).toFixed(2)).toBe('0.64');
  });

  it('every score to two figures each, full, at 320 and 360, needs no less than the floor of 0.6', () => {
    expect(layout.scoreFloor).toBe(0.6);
    for (const width of WIDTHS)
      for (const score of ['0', '5 (4)', '10 (4)', '5 (10)', '10 (10)'])
        expect(
          Math.min(1, squareText(width) / scoreWidth(score, 'scoreCompact')),
          `${score} @${width}`,
        ).toBeGreaterThanOrEqual(layout.scoreFloor);
  });

  // Compact: the numeral stands over the word in a square as wide as its room and as tall as the board leaves it (ruling
  // 144), never wider than the column's text; its size is the ratio of the square's side, 30 to 64. A goal count to two
  // figures fits whole at the size; a shootout score to 10 (10) needs the floor or more. From the 80 dp the phones of 560
  // dp get: a window under 560 can make the square 48, where "10 (4)" needs 0.58 and iOS cuts it (device-only; no brief phone).
  it('compact: every score to two figures each, in the squares the phones get, needs no less than the floor', () => {
    for (const width of WIDTHS)
      for (const side of [80, 100, 120, 140]) {
        const room = Math.min(squareText(width), side - 2 * space.xs);
        if (side > teamText(width)) continue;
        const size = goalNumeralSize('compact', side);
        const widths = (text: string) => digitsWidth(text, size);
        for (const score of ['0', '10', '5 (4)', '10 (4)', '5 (10)', '10 (10)'])
          expect(
            Math.min(1, room / widths(score)),
            `${score} @${width} side ${side}`,
          ).toBeGreaterThanOrEqual(layout.scoreFloor);
      }
  });

  it('compact: the numeral over its word fits the square’s height, from the 80 dp the phones of 560 dp get (the 48 dp least only occurs in windows under 518, where the 18 dp word needs 50)', () => {
    for (const side of [80, 100, 120, 140, 166]) {
      const size = goalNumeralSize('compact', side);
      const line = Math.round(size * 1.06);
      expect(line + typeScale.goalWord.lineHeight, `side ${side}`).toBeLessThanOrEqual(side);
    }
  });
});

// The controller's fix-round ruling (b): the marks' row is one line of fixed height. A sin-bin tag that is wider than
// the column ends in an ellipsis; it never wraps, so the buttons never move.
describe('the marks’ row (ruling b)', () => {
  const tagWidth = (text: string) => barlow700.width(text, typeScale.periodScore.fontSize);

  it('is one line of the count’s role, 16 dp, and holds a card icon', () => {
    expect(typeScale.periodScore.lineHeight).toBe(16);
    expect(layout.padCardHeight).toBeLessThanOrEqual(typeScale.periodScore.lineHeight);
  });

  it('“#99 · Sin-bin over” fits at 320 in en and nl; in es and fr it is wider, and is cut, not wrapped', () => {
    const tag = (dictionary: Dictionary) =>
      `#99 · ${said(dictionary, 'scoring.football.mark.sinBinOver')}`;
    expect(
      LANGUAGES.map(([lang, dictionary]) => [lang, tagWidth(tag(dictionary)) <= teamText(320)]),
    ).toEqual([
      ['en', true],
      ['es', false],
      ['fr', false],
      ['nl', true],
    ]);
  });
});

/**
 * The pad's height, portrait (rulings 130, 132, 144 and 145). Around the board sits the frame, 206 dp: the screen's padding
 * (2 × 16), the top bar (48), the last-tap line (three lines of 18, 54), the tool row (48) and three gaps of 8: football has
 * no strip (owner ruling 146), so the clock sits directly under the top bar. In the board: the clock hero over two columns. A column is its padding (2 × 8), the head, the Goal square's room, the
 * row of three small squares (a third of the text width a side, never under 48), the note line (16, reserved) and a gap
 * before each of the three under the head.
 *
 * Full (a Goal square room of at least 100 dp, so the 64 numeral stands over its word with air): the hero is the time's 82
 * and the period's 16 in a panel with 8 of padding above and below (114), 8, the 48 plate and 8; a head of the name's two lines (60), 8
 * and the marks' 16 (84); three gaps of 8. Compact: a 56 panel (a 48 face and 4 above and below), 4, the 48 plate and 8 (108); a head of one name line (30), 4
 * and the marks' 16 (50); three gaps of 4, and a Goal room of 48 at the least. The Goal square takes the room's width, or
 * its height when that is less, and is centred.
 */
describe('the pad’s height, portrait', () => {
  const LINE = layout.padLineLines * typeScale.control.lineHeight;
  const TOOLS = Math.max(
    layout.touch,
    2 * space.xs +
      2 * layout.iconBorder +
      layout.padToolLines * typeScale.actionSecondary.lineHeight,
  );
  const AROUND = 2 * space.md + layout.touch + LINE + TOOLS + 3 * space.sm;
  const NAME = typeScale.matchName.lineHeight;
  const MARKS = typeScale.periodScore.lineHeight;
  const PERIOD = typeScale.diagSection.lineHeight;
  const NOTE = typeScale.metricUnit.lineHeight;

  type Tier = { face: number; gap: number; head: number; goal: number };
  const FULL: Tier = {
    face: typeScale.clockHero.lineHeight + PERIOD + 2 * space.sm + layout.clockHairline,
    gap: space.sm,
    head: layout.padNameLines * NAME + space.sm + MARKS,
    goal: typeScale.scoreCompact.lineHeight + PERIOD + 2 * space.sm,
  };
  const COMPACT: Tier = {
    face:
      Math.max(layout.touch, typeScale.tallyCompact.lineHeight + PERIOD) +
      2 * space.xs +
      layout.clockHairline,
    gap: space.xs,
    head: NAME + space.xs + MARKS,
    goal: layout.touch,
  };
  const heroOf = (tier: Tier) => tier.face + tier.gap + layout.touch + space.sm;
  /** The small row's height in a phone `width` wide: a square's side, never under a touch target. */
  const rowOf = (width: number) => Math.max(layout.touch, smallText(width));
  /** Everything in a column but its Goal square's room, which takes what is left. */
  const fixedOf = (tier: Tier, width: number) =>
    2 * space.sm + layout.padSideBar + tier.head + 3 * tier.gap + rowOf(width) + NOTE;
  /** The least board of a tier: its hero over a column of its least Goal room, at the least row (a touch target). */
  const leastBoard = (tier: Tier) => heroOf(tier) + fixedOf(tier, 0) + tier.goal;
  const FULL_BOARD = leastBoard(FULL);

  /**
   * The tier, the clock's size, the Goal room and the square's side in a window `width` × `height`: the screen's rule,
   * written out. In the full tier the height the Goal square cannot use (it is as wide as the column, no wider: ruling
   * 144) goes to the clock digits (ruling 150): up to `clockHeroMax`, and never wider than "120+15:00" at the clock floor.
   */
  function laidOut(width: number, height: number) {
    const board = height - AROUND;
    const compact = board < FULL_BOARD;
    const tier = compact ? COMPACT : FULL;
    const text = teamText(width);
    const column = board - heroOf(tier);
    const room0 = column - fixedOf(tier, width);
    const ratio = typeScale.clockHero.lineHeight / typeScale.clockHero.fontSize;
    const budget = typeScale.clockHero.lineHeight + Math.max(0, room0 - text);
    const size = compact
      ? typeScale.clockHero.fontSize
      : Math.max(
          typeScale.clockHero.fontSize,
          Math.min(
            Math.floor(budget / ratio),
            layout.clockHeroMax,
            Math.floor(faceRoom(width) / (layout.clockWidestEm * layout.clockFloor)),
          ),
        );
    const grown = compact ? 0 : Math.floor(size * ratio + 1e-9) - typeScale.clockHero.lineHeight;
    const room = room0 - grown;
    const side = Math.min(text, room);
    return {
      compact,
      column: column - grown,
      room,
      side,
      size,
      board,
      hero: heroOf(tier) + grown,
      fixed: fixedOf(tier, width),
    };
  }

  it('reserves 206 dp around the board: 24 less than with the strip', () => {
    expect(AROUND).toBe(206);
  });

  it('the full tier: a 180 hero over a 292 column, 472 dp of board, full from a 678 window', () => {
    expect(NOTE).toBe(NOTE_HEIGHT);
    expect([heroOf(FULL), fixedOf(FULL, 0) + FULL.goal, FULL_BOARD]).toEqual([180, 292, 472]);
    expect(BOARD_FULL_HEIGHT).toBe(FULL_BOARD);
    expect(laidOut(360, 678).compact).toBe(false);
    expect(laidOut(360, 677).compact).toBe(true);
  });

  it('compact: a 118 hero over a 194 column of a 48 square, the 48 row and the note line: it holds from a 518 window, not under', () => {
    expect([heroOf(COMPACT), fixedOf(COMPACT, 0) + COMPACT.goal]).toEqual([118, 194]);
    expect(laidOut(320, 518).room).toBe(layout.touch);
    expect(laidOut(320, 517).room).toBeLessThan(layout.touch);
  });

  // The five phones of the brief; 412 × 870 is the owner's NE2211 (1080 × 2412 at 480 dp is 412 wide, about 870 left after
  // the system bars) and 412 × 915 the whole screen. Each: the tier, the Goal room and the squares' sides, no scroll, every
  // control at least a touch target.
  it.each([
    [360, 560, true, 90, 90, 45.3, 80],
    [320, 560, true, 90, 90, 38.7, 80],
    [320, 640, true, 170, 124, 38.7, 80],
    [360, 724, false, 145, 144, 45.3, 81],
    [412, 870, false, 260, 170, 54, 106],
    [412, 915, false, 305, 170, 54, 106],
  ] as const)(
    'a %i × %i window: compact %s, the Goal room %f, the Goal square %i dp, the three small squares %f dp wide, the clock %i dp, the pad inside the window',
    (width, height, compact, room, side, small, size) => {
      const laid = laidOut(width, height);
      expect(laid.compact).toBe(compact);
      expect(laid.room).toBeCloseTo(room, 1);
      expect(laid.side).toBe(side);
      expect(laid.size).toBe(size);
      // The screen's own rule gives the same clock (the compact board keeps its own faces).
      if (!compact)
        expect(clockHeroSize({ width: faceRoom(width), height: laid.board })).toBe(size);
      expect(Number(smallText(width).toFixed(1))).toBe(small);
      // Every control a touch target at least: the Goal square (its room's least), the row, Missed.
      expect(laid.room).toBeGreaterThanOrEqual(layout.touch);
      expect(rowOf(width)).toBeGreaterThanOrEqual(layout.touch);
      // No scroll: the frame, the hero and the column sum to the window.
      expect(AROUND + laid.hero + laid.column).toBe(height);
      expect(laid.room + laid.fixed).toBeCloseTo(laid.column, 6);
    },
  );

  // The screen's own rule, not a copy: the board's height is the window less the 206 around it.
  it('the real boardTier: compact at 517 and 677, full at 678', () => {
    const tierAt = (window: number) => boardTier(window - AROUND);
    expect([517, 518, 560, 640, 677, 678, 724].map(tierAt)).toEqual([
      'compact',
      'compact',
      'compact',
      'compact',
      'compact',
      'full',
      'full',
    ]);
  });

  // The shootout: the Goal square (Scored) and one 48 dp row (Missed), no squares row and no note line, so its column
  // is shorter than play's at every size and fits wherever play does.
  it.each([
    [360, 560],
    [320, 560],
    [320, 640],
    [360, 724],
    [412, 870],
  ] as const)(
    'the shootout at %i × %i: Scored’s room and Missed’s 48 dp row fit in the column',
    (width, height) => {
      const laid = laidOut(width, height);
      const tier = laid.compact ? COMPACT : FULL;
      const shootout = 2 * space.sm + layout.padSideBar + tier.head + 2 * tier.gap + layout.touch;
      expect(laid.column - shootout).toBeGreaterThanOrEqual(laid.room);
      expect(laid.column - shootout).toBeGreaterThanOrEqual(layout.touch);
    },
  );

  // Ruling 138: the numeral follows the square's side, 0.4375 of it, between 30 (what a 48 dp square holds over its word)
  // and the full tier's 64. The full tier is the full size at its own least square.
  it('the numeral: 30 at 48, 56 at 128, 64 at the cap and in the full tier at its 100 dp square', () => {
    expect(layout.goalNumeralRatio).toBe(0.4375);
    expect(goalNumeralSize('compact', 48)).toBe(30);
    expect(goalNumeralSize('compact', 128)).toBe(56);
    expect(goalNumeralSize('compact', 201)).toBe(64);
    expect(goalNumeralSize('full', FULL.goal)).toBe(64);
    expect(FULL.goal).toBe(100);
  });

  it('the Goal square is as wide as the column or as tall as its room, whichever is less', () => {
    expect(goalSide({ width: 140, height: 142 })).toBe(140);
    expect(goalSide({ width: 140, height: 80 })).toBe(80);
  });
});
