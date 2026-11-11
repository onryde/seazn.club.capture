import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { BOARD_FULL_HEIGHT, boardTier, goalNumeralSize } from '@/ui/theme/columnBoard';
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
 * (space.sm a side) and its side bar (`padSideBar`).
 */
const teamText = (width: number) =>
  (column(width) - space.sm) / 2 - 2 * space.sm - layout.padSideBar;
/** A column button's text: the column's text less the button's own padding (space.sm a side; it has no border). */
const buttonText = (width: number) => teamText(width) - 2 * space.sm;
/** The Goal square's text: the column's text less its padding (space.xs a side). */
const squareText = (width: number) => teamText(width) - 2 * space.xs;
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

describe('the rooms at 320 and 360', () => {
  it('a team’s text is 120 and 140, a button’s 104 and 124, a tool’s 122 and 142, a sheet row’s 254 and 294', () => {
    expect(WIDTHS.map(teamText)).toEqual([120, 140]);
    expect(WIDTHS.map(buttonText)).toEqual([104, 124]);
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

  it('at 360 each needs no less than the floor: 0.96, 0.85 and 1, all at least 0.75', () => {
    expect(layout.teamNameFloor).toBe(0.75);
    const scales = BROKEN.map((lines) => scaleFor(lines, teamText(360)));
    expect(scales.map((scale) => scale.toFixed(2))).toEqual(['0.96', '0.85', '1.00']);
    for (const scale of scales) expect(scale).toBeGreaterThanOrEqual(layout.teamNameFloor);
  });

  it('at 320 Wolverhampton needs 0.83 and Bournemouth 0.97; Mönchengladbach 0.72, under the floor: cut on iOS', () => {
    expect(BROKEN.map((lines) => scaleFor(lines, teamText(320)).toFixed(2))).toEqual([
      '0.83',
      '0.72',
      '0.97',
    ]);
  });
});

// The controller's fix-round 2 ruling (R1): on a compact board each name is one line, shrunk to fit. The fake's two
// names fit above the floor; a name of 23 or more characters needs about half its size, under the floor: iOS ends it in
// an ellipsis at 0.75, Android (no floor but 4 dp) shrinks it to about 12.5 dp at 320. A device check judges it.
describe('a team’s name on one line, on a compact board (ruling R1)', () => {
  const oneLine = (name: string, width: number) =>
    Math.min(1, teamText(width) / nameWidth(name)).toFixed(2);

  it('the fake’s names need 1 and 0.77 at 320, 1 and 0.89 at 360: at least the floor', () => {
    expect(FAKE_NAMES.map((name) => oneLine(name, 320))).toEqual(['1.00', '0.77']);
    expect(FAKE_NAMES.map((name) => oneLine(name, 360))).toEqual(['1.00', '0.89']);
  });

  it('a long name needs about half: 0.48 at 320 and 0.56 at 360, under the floor', () => {
    expect(['Wolverhampton Wanderers', ...LONG_NAMES].map((name) => oneLine(name, 320))).toEqual([
      '0.48',
      '0.47',
      '0.48',
    ]);
    expect(oneLine('Wolverhampton Wanderers', 360)).toBe('0.56');
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
      const tag = periodWidth(said(dictionary, 'scoring.football.clock.paused')) + 2 * space.xs + 2;
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

/**
 * Yellow and Red, a row of two in the column's text: the gap between them (space.xs), a hairline border either side, the
 * swatch (`padSwatch`) and the gap before the word (space.xs). The word shrinks to fit its one line down to
 * `cardLabelFloor`.
 */
const cardWord = (width: number) =>
  (teamText(width) - space.xs) / 2 - 2 * layout.iconBorder - layout.padSwatch - space.xs;

describe('the column buttons at 320 and 360 in four languages', () => {
  it.each(LANGUAGES)(
    '%s: Sub and Missed each on their one line, and the Goal and Scored words under the numeral',
    (_lang, dictionary: Dictionary) => {
      for (const word of ['sub', 'missed'])
        for (const width of WIDTHS) {
          const label = said(dictionary, `scoring.football.column.${word}`);
          expect(actionWidth(label), `${label} @${width}`).toBeLessThanOrEqual(buttonText(width));
        }
      for (const word of ['goal', 'scored'])
        for (const width of WIDTHS) {
          const label = said(dictionary, `scoring.football.column.${word}`);
          expect(periodWidth(label), `${label} @${width}`).toBeLessThanOrEqual(squareText(width));
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: Yellow and Red, side by side with their swatches, shrink to fit one line, never under the card label floor',
    (_lang, dictionary: Dictionary) => {
      expect(layout.cardLabelFloor).toBe(0.75);
      for (const word of ['yellow', 'red'])
        for (const width of WIDTHS) {
          const label = said(dictionary, `scoring.football.column.${word}`);
          expect(
            Math.min(1, cardWord(width) / periodWidth(label)),
            `${label} @${width}`,
          ).toBeGreaterThanOrEqual(layout.cardLabelFloor);
        }
    },
  );

  it('the room Yellow and Red have: 44 dp at 320 and 54 at 360; Amarilla, the widest, needs 0.84 and 1', () => {
    expect(WIDTHS.map(cardWord)).toEqual([44, 54]);
    const widest = periodWidth('Amarilla');
    expect(widest.toFixed(1)).toBe('52.7');
    expect((cardWord(320) / widest).toFixed(2)).toBe('0.84');
    expect(cardWord(360) / widest).toBeGreaterThan(1);
  });

  it.each(LANGUAGES)(
    '%s: a disabled button’s note (No subs left, No team sheet) on its one line, shrunk to fit above the note floor',
    (_lang, dictionary: Dictionary) => {
      expect(layout.noteFloor).toBe(0.75);
      for (const word of ['noSubs', 'noSheet'])
        for (const width of WIDTHS) {
          const note = said(dictionary, `scoring.football.column.${word}`);
          expect(
            Math.min(1, buttonText(width) / noteWidth(note)),
            `${note} @${width}`,
          ).toBeGreaterThanOrEqual(layout.noteFloor);
        }
    },
  );
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
        ...Object.keys(dictionary)
          .filter((key) =>
            /^scoring\.football\.(reason|card|outcome)\.|^scoring\.football\.sheet\.(dontKnow|penalty|noAssist|noReason)$/.test(
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
    '%s: the “2nd yellow · sent off” note takes one line under a player’s row, and the Yellow and Red titles keep their team',
    (_lang, dictionary: Dictionary) => {
      const note = said(dictionary, 'scoring.football.sheet.secondYellow');
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
      periodWidth(said(dictionary, `scoring.football.column.${word}`)),
    ),
  );
const widestSquareWord = Math.max(widestWord('goal'), widestWord('scored'));
/** What the numeral has beside the word in a compact square: the square's text less the word and the gap (space.sm). */
const compactNumeralRoom = (width: number, word: number) => squareText(width) - word - space.sm;

// The controller's fix-round ruling (f): the numeral shrinks to fit its line and is never cut. "G (K)" in the shootout;
// two figures each is the widest a youth or mini match makes (ruling 104). The full square has the numeral over its word
// in the square's whole text; the compact one has it beside the word.
describe('a team’s numeral in the Goal square (ruling f)', () => {
  it('full: “10 (4)” is 148.2 dp, over the 132 at 360 less nothing: it needs 0.89; “10 (10)” is 180.1 and needs 0.62 at 320', () => {
    expect(squareText(320)).toBe(112);
    expect(squareText(360)).toBe(132);
    expect(scoreWidth('10 (4)', 'scoreCompact').toFixed(1)).toBe('148.2');
    expect((squareText(360) / scoreWidth('10 (4)', 'scoreCompact')).toFixed(2)).toBe('0.89');
    expect(scoreWidth('10 (10)', 'scoreCompact').toFixed(1)).toBe('180.1');
    expect((squareText(320) / scoreWidth('10 (10)', 'scoreCompact')).toFixed(2)).toBe('0.62');
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

  // In play the word is Goal, in the shootout Scored: each has its own widest word, so each is measured with its own.
  it('compact: a goal count to two figures fits whole beside the widest Goal word; a shootout score to 10 (10) needs the floor or more beside the widest Scored word', () => {
    for (const width of WIDTHS) {
      const goalRoom = compactNumeralRoom(width, widestWord('goal'));
      expect(scoreWidth('10', 'tallyCompact'), `10 @${width}`).toBeLessThanOrEqual(goalRoom);
      const room = compactNumeralRoom(width, widestWord('scored'));
      for (const score of ['5 (4)', '10 (4)', '5 (10)', '10 (10)'])
        expect(
          Math.min(1, room / scoreWidth(score, 'tallyCompact')),
          `${score} @${width}`,
        ).toBeGreaterThanOrEqual(layout.scoreFloor);
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
 * The pad's height, portrait (rulings 130 and 132). Around the board sits the frame, 230 dp: the screen's padding (2 × 16),
 * the top bar (48), the strip (16), the last-tap line (three lines of 18, 54), the tool row (48) and four gaps of 8. In the
 * board: the clock hero over two columns, each every row a touch target at least, and the Goal square taking the rest.
 *
 * Full (a Goal square of at least 100 dp, so the 64 numeral stands over its word with air): the hero is the time's 84 and
 * the period's 16 (100), 8, the 48 plate and 8: 164. A column is 2 × 8 of padding, a head of the name's two lines (60), 8
 * and the marks' 16 (84), the Goal square (100), three gaps of 8 and two 48 rows (Yellow and Red, Sub): 320. 484 dp of
 * board, a 714 window.
 *
 * Compact: the hero is a 48 face (the time's 32 and the period's 16), 4, the 48 plate and 8: 108. A column is 16, a head
 * of one name line (30), 4 and the marks' 16 (50), a 48 Goal square, three gaps of 4 and the two 48 rows: 222. 330 dp of
 * board, a 560 window: the phone the owner named, 360 × 640 laid out about 560 tall.
 */
describe('the pad’s height, portrait', () => {
  const STRIP = layout.padStripLines * typeScale.metricUnit.lineHeight;
  const LINE = layout.padLineLines * typeScale.control.lineHeight;
  const TOOLS = Math.max(
    layout.touch,
    2 * space.xs +
      2 * layout.iconBorder +
      layout.padToolLines * typeScale.actionSecondary.lineHeight,
  );
  const AROUND = 2 * space.md + layout.touch + STRIP + LINE + TOOLS + 4 * space.sm;
  const NAME = typeScale.matchName.lineHeight;
  const MARKS = typeScale.periodScore.lineHeight;
  const PERIOD = typeScale.diagSection.lineHeight;

  type Tier = { face: number; gap: number; head: number; goal: number };
  const FULL: Tier = {
    face: typeScale.clockHero.lineHeight + PERIOD,
    gap: space.sm,
    head: layout.padNameLines * NAME + space.sm + MARKS,
    goal: typeScale.scoreCompact.lineHeight + PERIOD + 2 * space.sm,
  };
  const COMPACT: Tier = {
    face: Math.max(layout.touch, typeScale.tallyCompact.lineHeight + PERIOD),
    gap: space.xs,
    head: NAME + space.xs + MARKS,
    goal: layout.touch,
  };
  const heroOf = (tier: Tier) => tier.face + tier.gap + layout.touch + space.sm;
  /** Everything in a column but its Goal square, which takes what is left. */
  const fixedOf = (tier: Tier) => 2 * space.sm + tier.head + 3 * tier.gap + 2 * layout.touch;
  const FULL_BOARD = heroOf(FULL) + fixedOf(FULL) + FULL.goal;

  /** The tier, the Goal square's height and the column's, in a window `height` tall: the screen's rule, written out. */
  function laidOut(height: number) {
    const board = height - AROUND;
    const compact = board < FULL_BOARD;
    const tier = compact ? COMPACT : FULL;
    const column = board - heroOf(tier);
    return { compact, column, goal: column - fixedOf(tier) };
  }

  it('reserves 230 dp around the board', () => {
    expect(AROUND).toBe(230);
  });

  it('the full tier: a 164 hero over a 320 column, 484 dp of board, full from a 714 window', () => {
    expect([heroOf(FULL), fixedOf(FULL) + FULL.goal, FULL_BOARD]).toEqual([164, 320, 484]);
    expect(BOARD_FULL_HEIGHT).toBe(FULL_BOARD);
    expect(laidOut(714).compact).toBe(false);
    expect(laidOut(713).compact).toBe(true);
  });

  it('compact: a 108 hero over a 222 column of three 48 rows and a 48 square: it holds from a 560 window, not under', () => {
    expect([heroOf(COMPACT), fixedOf(COMPACT) + COMPACT.goal]).toEqual([108, 222]);
    expect(laidOut(560).goal).toBe(layout.touch);
    expect(laidOut(559).goal).toBeLessThan(layout.touch);
  });

  it.each([
    [560, true, 48],
    [600, true, 88],
    [640, true, 128],
    [713, true, 201],
    [714, false, 100],
    [724, false, 110],
  ] as const)(
    'a window %i tall: compact %s, the Goal square %i dp, every other row 48, and the pad inside the window',
    (height, compact, goal) => {
      const laid = laidOut(height);
      expect(laid.compact).toBe(compact);
      expect(laid.goal).toBe(goal);
      expect(laid.goal).toBeGreaterThanOrEqual(layout.touch);
      expect(AROUND + heroOf(compact ? COMPACT : FULL) + laid.column).toBe(height);
    },
  );

  // The ruling's two phones: 360 and 320 dp wide, 560 tall as laid out, and 640 tall at 320. The heights do not depend
  // on the width (every reserve above is fixed); what does is that the compact faces fit their rooms there.
  it.each(WIDTHS)(
    'at %i × 560 and %i × 640: compact, no scroll, the time and the numerals in their rooms',
    (width) => {
      for (const height of [560, 640]) {
        const laid = laidOut(height);
        expect(laid.compact).toBe(true);
        expect(laid.goal, `${width} × ${height}`).toBeGreaterThanOrEqual(layout.touch);
      }
      const time = digitsWidth('120+15:00', typeScale.tallyCompact.fontSize);
      expect(time).toBeLessThanOrEqual(faceRoom(width));
      expect(
        scoreWidth('10', 'tallyCompact') + space.sm + widestSquareWord + 2 * space.xs,
      ).toBeLessThanOrEqual(teamText(width));
    },
  );

  // The screen's own rule, not a copy: the board's height is the window less the 230 around it.
  it('the real boardTier: compact at 559 and 560, compact at 713, full at 714', () => {
    const tierAt = (window: number) => boardTier(window - AROUND);
    expect([559, 560, 713, 714].map(tierAt)).toEqual(['compact', 'compact', 'compact', 'full']);
  });

  // Ruling 138: the numeral follows the square's measured height, 0.4375 of it, between 30 (what a 48 dp square holds
  // beside its word) and the full tier's 64. The full tier is the full size at its own least square.
  it('the numeral: 30 at 48, 56 at 128, 64 at the cap and in the full tier at its 100 dp square', () => {
    expect(layout.goalNumeralRatio).toBe(0.4375);
    expect(goalNumeralSize('compact', 48)).toBe(30);
    expect(goalNumeralSize('compact', 128)).toBe(56);
    expect(goalNumeralSize('compact', 201)).toBe(64);
    expect(goalNumeralSize('full', FULL.goal)).toBe(64);
    expect(FULL.goal).toBe(100);
  });

  // A bigger numeral beside the word shrinks to its room (scoreFloor); the widest goal count, two figures, at 128 dp.
  it('at 128 dp the two-figure goal count, 56 dp, still needs at least the floor beside the widest Goal word', () => {
    const size = goalNumeralSize('compact', 128);
    for (const width of WIDTHS)
      expect(
        Math.min(1, compactNumeralRoom(width, widestWord('goal')) / digitsWidth('10', size)),
        `@${width}`,
      ).toBeGreaterThanOrEqual(layout.scoreFloor);
  });
});
