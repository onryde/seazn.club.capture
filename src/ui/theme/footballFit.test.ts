import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
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
});
