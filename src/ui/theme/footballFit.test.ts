import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { BOARD_FULL_HEIGHT } from '@/ui/theme/columnBoard';
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
/** `tally`: Barlow Condensed 700 at 46, tabular digits (`zero.tf`); every other glyph at its own advance. */
const clockWidth = (text: string) =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        typeScale.tally.fontSize,
    0,
  );

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
/** A tool's text in a row of two (End of period and More): as padFit's `toolTextOf(2)`. */
const toolText = (width: number) =>
  (column(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
/** A sheet row's text: the screen less the sheet's padding and the row's (space.md a side each), less its border. */
const rowText = (width: number) => width - 4 * space.md - 2 * layout.iconBorder;
/** The clock bar's Start or Pause, whichever is wider in the language: its word, padding (space.sm a side) and border. */
const clockButton = (dictionary: Dictionary) =>
  Math.max(
    ...['start', 'pause'].map((word) =>
      actionWidth(said(dictionary, `scoring.football.clock.${word}`)),
    ),
  ) +
  2 * space.sm +
  2 * layout.iconBorder;
/** The time's room: the bar less the button and the gap before it (the period has a line of its own under both). */
const faceRoom = (width: number, dictionary: Dictionary) =>
  column(width) - space.sm - clockButton(dictionary);

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

describe('the clock bar at 320 and 360 in four languages (ruling 109; the controller’s ruling 7)', () => {
  it('the longest reading, 120+15:00, is 193.2 dp of tabular digits', () => {
    expect(clockWidth('120+15:00').toFixed(1)).toBe('193.2');
  });

  it.each(LANGUAGES)(
    '%s: 120+15:00 fits on its one line beside Start or Pause, whichever is wider',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(clockWidth('120+15:00'), `@${width}`).toBeLessThanOrEqual(
          faceRoom(width, dictionary),
        );
    },
  );

  // The controller's fix-round ruling (d): at the 1.15 font-scale cap (`maxFontScale.tally`) the time shrinks to fit its
  // one line, the clock alone, down to `clockFloor`.
  it('at the 1.15 cap 120+15:00 is 222.1 dp: en fits at 320, nl needs 0.93 there, and none goes under 0.85', () => {
    expect(maxFontScale.tally).toBe(1.15);
    const grown = clockWidth('120+15:00') * 1.15;
    expect(grown.toFixed(1)).toBe('222.1');
    expect(layout.clockFloor).toBe(0.85);
    expect((faceRoom(320, nl) / grown).toFixed(2)).toBe('0.93');
    expect(faceRoom(320, en) / grown).toBeGreaterThan(1);
    for (const [lang, dictionary] of LANGUAGES)
      for (const width of WIDTHS)
        expect(
          Math.min(1, faceRoom(width, dictionary) / grown),
          `${lang} @${width}`,
        ).toBeGreaterThanOrEqual(layout.clockFloor);
  });

  // The period's line is as wide as the bar, under the time and the button; even in the time's room beside the button,
  // the longest period or break word of each language takes one line.
  it.each(LANGUAGES)(
    '%s: every period and break word takes one line, even beside Start or Pause',
    (_lang, dictionary: Dictionary) => {
      const keys = Object.keys(dictionary).filter((key) =>
        /^scoring\.football\.(period|break)\./.test(key),
      );
      expect(keys.length).toBeGreaterThanOrEqual(13);
      for (const key of keys)
        for (const width of WIDTHS)
          expect(
            linesOf(said(dictionary, key), faceRoom(width, dictionary), periodWidth),
            `${key} @${width}`,
          ).toBe(1);
    },
  );
});

describe('the column buttons at 320 and 360 in four languages', () => {
  it.each(LANGUAGES)(
    '%s: Goal, Card, Sub, Scored and Missed each on its one line',
    (_lang, dictionary: Dictionary) => {
      for (const word of ['goal', 'card', 'sub', 'scored', 'missed'])
        for (const width of WIDTHS) {
          const label = said(dictionary, `scoring.football.column.${word}`);
          expect(actionWidth(label), `${label} @${width}`).toBeLessThanOrEqual(buttonText(width));
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: a disabled button’s note (No subs left, No team sheet) in its two lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const word of ['noSubs', 'noSheet'])
        for (const width of WIDTHS) {
          const note = said(dictionary, `scoring.football.column.${word}`);
          expect(wordsFit(note, buttonText(width), noteWidth), `${note} @${width}`).toBe(true);
          expect(
            linesOf(note, buttonText(width), noteWidth),
            `${note} @${width}`,
          ).toBeLessThanOrEqual(2);
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
});

/** `scoreCompact` (64) or, on a compact board, `tallyCompact` (30): Barlow Condensed 700, tabular digits. A team's score. */
const scoreWidth = (text: string, role: 'scoreCompact' | 'tallyCompact') =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        typeScale[role].fontSize,
    0,
  );

// The controller's fix-round ruling (f): the score shrinks to fit its line and is never cut. "G (K)" in the shootout;
// two figures each is the widest a youth or mini match makes (ruling 104).
describe('a team’s score in the shootout (ruling f)', () => {
  it('“10 (4)” is 148.2 dp, over the 140 at 360: it needs 0.94; “10 (10)” is 180.1 and needs 0.67 at 320', () => {
    expect(scoreWidth('10 (4)', 'scoreCompact').toFixed(1)).toBe('148.2');
    expect((teamText(360) / scoreWidth('10 (4)', 'scoreCompact')).toFixed(2)).toBe('0.94');
    expect(scoreWidth('10 (10)', 'scoreCompact').toFixed(1)).toBe('180.1');
    expect((teamText(320) / scoreWidth('10 (10)', 'scoreCompact')).toFixed(2)).toBe('0.67');
  });

  it('every score to two figures each, full or compact, at 320 and 360, needs no less than the floor of 0.6', () => {
    expect(layout.scoreFloor).toBe(0.6);
    for (const width of WIDTHS)
      for (const score of ['5 (4)', '10 (4)', '5 (10)', '10 (10)'])
        for (const role of ['scoreCompact', 'tallyCompact'] as const)
          expect(
            Math.min(1, teamText(width) / scoreWidth(score, role)),
            `${score} ${role} @${width}`,
          ).toBeGreaterThanOrEqual(layout.scoreFloor);
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
 * The team columns' height, portrait (ruling 105; `pad-layout-c-v3.html` option 2, "Goal shrunk to 3/4 of its size";
 * the controller's ruling 7). The split: the buttons share what the column leaves them by weight, Goal 0.75 and Card
 * and Sub 0.5 each (`layout.columnPrimary`, `layout.columnAction`; flex-basis 0), so they stand 3 : 2 : 2 while Card
 * and Sub are at least a touch target; below that each is held at 48 and the ratio gives way, never a target.
 */
describe('the team columns’ height, portrait', () => {
  /**
   * Around the board: the screen's padding (2 × 16), the top bar (touch, 48), the strip (one line, 16), the last-tap line
   * (three lines of 18, 54), the tool row (two lines of label in 2 × 4 + 2 × 1 + 2 × 19 = 48: football's tools carry no
   * side line), and the four gaps between the five (8).
   */
  const STRIP = layout.padStripLines * typeScale.metricUnit.lineHeight;
  const LINE = layout.padLineLines * typeScale.control.lineHeight;
  const TOOLS = Math.max(
    layout.touch,
    2 * space.xs +
      2 * layout.iconBorder +
      layout.padToolLines * typeScale.actionSecondary.lineHeight,
  );
  const AROUND = 2 * space.md + layout.touch + STRIP + LINE + TOOLS + 4 * space.sm;
  /** The clock bar: the time's row (touch: the button, the face, the 48 dp digits) and the period's line, then a gap. */
  const CLOCK = layout.touch + typeScale.diagSection.lineHeight + space.sm;
  /** A column's head: the name's two lines, the score, and the marks' row (a card icon and its count, a sin-bin tag). */
  const HEAD =
    layout.padNameLines * typeScale.matchName.lineHeight +
    space.xs +
    typeScale.scoreCompact.lineHeight +
    space.xs +
    typeScale.periodScore.lineHeight;
  /** What the buttons share: the column less its padding (space.sm a side), the head and the three gaps under it. */
  const buttons = (height: number) => height - AROUND - CLOCK - 2 * space.sm - HEAD - 3 * space.sm;
  const WEIGHTS = [layout.columnPrimary, layout.columnAction, layout.columnAction] as const;
  const split = (height: number) => {
    const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    return WEIGHTS.map((weight) => (buttons(height) * weight) / total);
  };

  it('weighs Goal, Card and Sub 0.75, 0.5 and 0.5', () => {
    expect(WEIGHTS).toEqual([0.75, 0.5, 0.5]);
  });

  it('reserves 230 dp around the board, 72 for the clock bar and the gap under it, and 152 for a column’s head', () => {
    expect([AROUND, CLOCK, HEAD]).toEqual([230, 72, 152]);
  });

  // The owner's phone, 360 × 804, has about 724 for the app in portrait (padFit.test.ts's estimate; a device check
  // settles it).
  it('on the owner’s phone, about 724 tall: Goal 98.6, Card and Sub 65.7 each, 3 : 2 : 2, every one at least 48', () => {
    const [goal, card, sub] = split(724);
    expect([goal, card, sub].map((height) => height!.toFixed(1))).toEqual(['98.6', '65.7', '65.7']);
    expect(goal! / card!).toBeCloseTo(3 / 2, 10);
    expect(card).toBe(sub);
    for (const height of [goal, card, sub]) expect(height).toBeGreaterThanOrEqual(layout.touch);
  });

  it('holds 3 : 2 : 2 with every button at least 48 from 662 tall; at 661 Card and Sub would be under 48', () => {
    expect(split(662)[1]).toBe(layout.touch);
    expect(split(661)[1]).toBeLessThan(layout.touch);
  });

  /*
   * The controller's fix-round ruling (c): below 3 : 2 : 2, Card and Sub hold 48 and Goal takes the rest, never less
   * than 48. Its fix-round 2 ruling (R1, superseding round 1's compact head): the board's tier. The full tier needs the
   * clock bar (72) over a column of three (336): 408 dp of board, a 638 window, the named threshold
   * (`BOARD_FULL_HEIGHT`). Below it, compact: the clock bar is one row of a touch target (the time in `tallyCompact`, 32,
   * over the period's 16) and the gap under it, 56; a column's head is the name on one line (30), the score in
   * `tallyCompact` (32) and the marks' row (16), with two gaps of 4: 86; a column of three needs 2 × 8 + 86 +
   * 3 × (8 + 48) = 270. The compact board needs 326, so it holds from a 556 window. The heights are the app's, after
   * the insets: a 360 × 640 phone with three-button navigation lays the app out about 560 tall (the re-review's
   * estimate; the owner's 360 × 804 is about 724), which a device check settles.
   */
  const COMPACT_CLOCK =
    Math.max(layout.touch, typeScale.tallyCompact.lineHeight + typeScale.diagSection.lineHeight) +
    space.sm;
  const COMPACT_HEAD =
    typeScale.matchName.lineHeight +
    space.xs +
    typeScale.tallyCompact.lineHeight +
    space.xs +
    typeScale.periodScore.lineHeight;
  const columnOf = (head: number) => 2 * space.sm + head + 3 * (space.sm + layout.touch);
  const FULL_BOARD = CLOCK + columnOf(HEAD);
  /** The tier, the column's height and the buttons' heights in a window `height` tall: the screen's rule, written out. */
  function laidOut(height: number) {
    const board = height - AROUND;
    const compact = board < FULL_BOARD;
    const column = board - (compact ? COMPACT_CLOCK : CLOCK);
    const room = column - 2 * space.sm - (compact ? COMPACT_HEAD : HEAD) - 3 * space.sm;
    const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    const [goal, card] = WEIGHTS.map((weight) => (room * weight) / total);
    const buttons =
      card! < layout.touch
        ? [room - 2 * layout.touch, layout.touch, layout.touch]
        : [goal!, card!, card!];
    return { compact, column, room, buttons };
  }
  const heights = (buttons: readonly number[]) => buttons.map((each) => each.toFixed(1));

  it('the full tier needs 408 dp of board, the named threshold: full from a 638 window, compact under it', () => {
    expect([CLOCK, columnOf(HEAD), FULL_BOARD]).toEqual([72, 336, 408]);
    expect(BOARD_FULL_HEIGHT).toBe(FULL_BOARD);
    expect(laidOut(638).compact).toBe(false);
    expect(laidOut(637).compact).toBe(true);
  });

  it('compact: a 56 clock bar and a 270 column of three, so three targets hold from a 556 window, not under', () => {
    expect([COMPACT_CLOCK, COMPACT_HEAD, columnOf(COMPACT_HEAD)]).toEqual([56, 86, 270]);
    expect(Math.min(...laidOut(556).buttons)).toBe(layout.touch);
    expect(Math.min(...laidOut(555).buttons)).toBeLessThan(layout.touch);
  });

  it.each([
    [560, true, ['52.0', '48.0', '48.0']],
    [600, true, ['80.6', '53.7', '53.7']],
    [637, true, ['96.4', '64.3', '64.3']],
    [638, false, ['48.0', '48.0', '48.0']],
    [640, false, ['50.0', '48.0', '48.0']],
    [724, false, ['98.6', '65.7', '65.7']],
  ] as const)(
    'a window %i tall: compact %s; Goal, Card and Sub %s, each at least 48, and nothing past the column',
    (height, compact, expected) => {
      const laid = laidOut(height);
      expect(laid.compact).toBe(compact);
      expect(heights(laid.buttons)).toEqual(expected);
      for (const each of laid.buttons) expect(each).toBeGreaterThanOrEqual(layout.touch);
      expect(laid.buttons.reduce((sum, each) => sum + each, 0)).toBeCloseTo(laid.room, 10);
    },
  );

  // The ruling's two phones: 360 and 320 dp wide, 560 tall as laid out. The heights do not depend on the width (every
  // reserve above is fixed); what does is that the compact faces fit their rooms there.
  it.each(WIDTHS)(
    'at %i × 560: compact, the board inside the window, the time and the scores in their rooms',
    (width) => {
      const laid = laidOut(560);
      expect(laid.compact).toBe(true);
      expect(AROUND + COMPACT_CLOCK + laid.column).toBe(560);
      expect(laid.column).toBeGreaterThanOrEqual(columnOf(COMPACT_HEAD));
      const time =
        (clockWidth('120+15:00') * typeScale.tallyCompact.fontSize) / typeScale.tally.fontSize;
      for (const [lang, dictionary] of LANGUAGES)
        expect(time, `${lang} @${width}`).toBeLessThanOrEqual(faceRoom(width, dictionary));
      expect(scoreWidth('10 (10)', 'tallyCompact')).toBeLessThanOrEqual(teamText(width));
    },
  );
});
