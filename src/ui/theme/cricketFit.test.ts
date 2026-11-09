import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { isOneWord } from '@/ui/components/nameFit';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesIn, linesOf } from '../../../test/textFit';

// S2-4 plan Task 8: what the cricket board draws fits at 320 and 360 dp in four languages (the pattern of padFit.test.ts,
// whose rooms are copied here from the token and type declarations and the board's styles, never read from the
// components): the score line, the innings line's words before the side's name, the chase line, a crease row with the
// longest names and figures, and a full over of chips. Cricket names are long: a name gives way to an ellipsis, the
// numbers never do (spec §5). Whether real text stays inside on a phone is the device check's.

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
const geist400 = loadFont('geist-400');
const mono = loadFont('geist-mono-400');

/** Every key a fit case reads, in any language: the sweep at the end of the file asks that no cricket key is missing here. */
const swept = new Set<string>();
const said = (dictionary: Dictionary, key: string): string => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  swept.add(key);
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string | number>>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );

/** `scoreCompact`: Barlow Condensed 700 at 64, tabular digits (`zero.tf`); the slash at its own advance. */
const scoreWidth = (text: string) =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        typeScale.scoreCompact.fontSize,
    0,
  );
/** `label`: Barlow Condensed 600 at 20, as typed. The overs beside the score, a batter's and the bowler's names. */
const labelWidth = (text: string) => barlow600.width(text, typeScale.label.fontSize);
/** `control`: Geist 500 at 14. The innings line and the chase line. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `metricValue`: Geist Mono 400 at 16. A batter's runs (balls) and the bowler's O-M-R-W. */
const figuresWidth = (text: string) => mono.width(text, typeScale.metricValue.fontSize);
/** `metricUnit`: Geist 500 at 12. The over's label and a free hit beside it. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `controlSmall`: Geist 500 at 12. A chip's word. */
const chipWidth = (text: string) => geist500.width(text, typeScale.controlSmall.fontSize);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** A crease row: the striker's mark, then the name, then the figures, `space.xs` apart. */
const nameRoom = (width: number, figures: string) =>
  column(width) - space.md - 2 * space.xs - figuresWidth(figures);

/** The longest numbers a board can show: an unlimited innings' score and overs, a long chase, a long spell. */
const SCORE = '999/10';
const OVERS = '189.5';
const CHASE = { runs: 999, count: 120 };
const BATTER = '199 (120)';
const SPELL = '35.4-10-120-10';
/** The longest name a crease row must show at least a part of: the room must hold its first word. */
const LONG_NAME = 'Wolstenholme-Fitzgerald';

describe.each(WIDTHS)('the cricket board at %i dp', (width) => {
  it.each(LANGUAGES)(
    'the score line holds the longest score and its overs: %s',
    (_, dictionary) => {
      const overs = fill(said(dictionary, 'scoring.cricket.board.overs'), { overs: OVERS });
      expect(scoreWidth(SCORE) + space.sm + labelWidth(overs)).toBeLessThanOrEqual(column(width));
    },
  );

  it.each(LANGUAGES)(
    'the innings line holds its words and number before the side’s name: %s',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.history.innings', 'scoring.cricket.history.superOver']) {
        const before = fill(said(dictionary, key), { number: 12, side: '' });
        expect(controlWidth(before), key).toBeLessThanOrEqual(column(width));
      }
    },
  );

  it.each(LANGUAGES)('the chase line holds the longest chase on one line: %s', (_, dictionary) => {
    for (const key of ['scoring.cricket.board.chase.other', 'scoring.cricket.board.need']) {
      const chase = fill(said(dictionary, key), CHASE);
      expect(controlWidth(chase), key).toBeLessThanOrEqual(column(width));
    }
  });

  it('a crease row keeps the figures whole and room for a long name’s first word', () => {
    expect(nameRoom(width, BATTER)).toBeGreaterThanOrEqual(labelWidth(LONG_NAME));
    expect(nameRoom(width, SPELL)).toBeGreaterThanOrEqual(labelWidth('W. Fitzgerald'));
  });

  it('eight chips (six balls and two extras) fit the column on one row', () => {
    expect(8 * layout.overChip + 7 * space.xs).toBeLessThanOrEqual(column(width));
  });

  it.each(LANGUAGES)(
    'the over’s label and a free hit share the strip’s head: %s',
    (_, dictionary) => {
      const label = fill(said(dictionary, 'scoring.cricket.board.over'), { number: 50 });
      const status = said(dictionary, 'scoring.cricket.board.freeHit');
      expect(unitWidth(label) + space.sm + unitWidth(status)).toBeLessThanOrEqual(column(width));
    },
  );
});

describe('a chip', () => {
  // At `control`'s 14, "5wd" was 29.1 dp: the chip's word is `controlSmall`'s 12 (24.9, 3.5 dp a side in 32). Eight chips
  // must still fit 320's column, so the chip cannot grow (above).
  it('holds the widest delivery a chip can say, with room each side', () => {
    for (const text of ['7nb', '11p', '5wd', '4lb', 'W', '·']) {
      expect(chipWidth(text), text).toBeLessThanOrEqual(layout.overChip - space.xs);
    }
  });
});

describe('the board’s regions', () => {
  it('the score panel holds the score, the innings line and the chase line', () => {
    expect(
      typeScale.scoreCompact.lineHeight + 2 * typeScale.control.lineHeight + 2 * space.xs,
    ).toBeLessThanOrEqual(layout.scorePanel);
  });

  it('a crease row holds a line of names and of figures', () => {
    expect(typeScale.label.lineHeight).toBeLessThanOrEqual(layout.creaseRow);
    expect(typeScale.metricValue.lineHeight).toBeLessThanOrEqual(layout.creaseRow);
  });

  it('the over strip holds its label and a chip of usable height', () => {
    const chip = layout.overStrip - typeScale.metricUnit.lineHeight - space.xs;
    expect(chip).toBeGreaterThanOrEqual(typeScale.controlSmall.lineHeight + 2 * space.xs);
  });
});

// S2-4 plan Task 10 (owner ruling 83): the two-half toss and the setup in the pad's column. The toss's question is
// `title` caps (Batch 3 fix round 1, M7: the preview's size), kept to `padTossAskLines` lines in its half whatever it
// says, so a long team's name must still fit in them; a side's button holds a team name at `label` wrapped at its gaps,
// and Bat and Bowl at `tally` on one line, a word too wide shrunk (`NameText`, never broken). The order row's name keeps
// the room left by its place and the two ▲▼ targets, and the Opener plate under it.
describe.each(WIDTHS)('the toss and the setup at %i dp', (width) => {
  /** `state`: Barlow Condensed 700 at 15, uppercase, letterspaced. The Opener plate. */
  const stateWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;
  /** `title`: Barlow Condensed 700 at 26, uppercase, letterspaced. The toss's two questions. */
  const titleWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
    typeScale.title.letterSpacing * [...text].length;
  /** `tally`: Barlow Condensed 700 at 46, as typed. Bat and Bowl. */
  const tallyWidth = (text: string) => barlow700.width(text, typeScale.tally.fontSize);
  /** A side's button: half the row less its gap, less its padding (`space.sm` a side) and its border (TossPicker). */
  const tossText = (column(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
  /** An order row: the place (`space.lg`), the name, two 48 dp targets, `space.sm` between each (CricketOrderList). */
  const orderName = column(width) - space.lg - 2 * layout.touch - 3 * space.sm;
  /** A thirty-character club's name, and a name with one long word. */
  const LONG_TEAM = 'Bishops Stortford Cricket Club';
  const ONE_WORD_TEAM = 'Wolverhampton CC';

  it('the thirty-character name is thirty characters (anti-vacuity)', () => {
    expect(LONG_TEAM).toHaveLength(30);
  });

  it.each(LANGUAGES)(
    '%s: both questions keep to their lines with a thirty-character name',
    (_, dictionary) => {
      const ask = said(dictionary, 'scoring.cricket.toss.ask');
      const chose = said(dictionary, 'scoring.cricket.toss.chose');
      const team = said(dictionary, 'scoring.cricket.toss.team');
      for (const text of [ask, fill(chose, { team }), fill(chose, { team: LONG_TEAM })]) {
        expect(linesOf(text, column(width), titleWidth), text).toBeLessThanOrEqual(
          layout.padTossAskLines,
        );
        for (const line of linesIn(text, column(width), titleWidth)) {
          expect(titleWidth(line), line).toBeLessThanOrEqual(column(width));
        }
      }
    },
  );

  it('a thirty-character name takes the question’s second line, the short question one (anti-vacuity)', () => {
    const chose = fill(said(en, 'scoring.cricket.toss.chose'), { team: LONG_TEAM });
    expect(linesOf(chose, column(width), titleWidth)).toBe(2);
    expect(linesOf(said(en, 'scoring.cricket.toss.ask'), column(width), titleWidth)).toBe(1);
  });

  it.each(LANGUAGES)(
    '%s: Bat and Bowl are one word each, on one line in a side’s button, shrunk no further than the name floor',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.toss.bat', 'scoring.cricket.toss.bowl']) {
        const word = said(dictionary, key);
        expect(isOneWord(word), word).toBe(true);
        expect(tallyWidth(word) * layout.nameFloor, word).toBeLessThanOrEqual(tossText);
      }
    },
  );

  it('the words shrunk to fit at tally are French Frapper at 320, and none at 360 (anti-vacuity)', () => {
    const words = LANGUAGES.flatMap(([, dictionary]) =>
      ['scoring.cricket.toss.bat', 'scoring.cricket.toss.bowl'].map((key) => said(dictionary, key)),
    );
    expect(words.filter((word) => tallyWidth(word) > tossText)).toEqual(
      width === 320 ? ['Frapper'] : [],
    );
  });

  it('a club’s word is wider than a side’s button at tally, so the names stay at label (M7)', () => {
    expect(tallyWidth('Riverside')).toBeGreaterThan(tossText);
    expect(labelWidth('Riverside')).toBeLessThanOrEqual(tossText);
  });

  it('a team’s name wraps at its gaps in a side’s button, every word whole', () => {
    for (const name of [LONG_TEAM, ONE_WORD_TEAM]) {
      for (const word of name.split(' ')) {
        expect(labelWidth(word), word).toBeLessThanOrEqual(tossText);
      }
    }
    // Anti-vacuity: the long name needs more than one line, and the button (filling its half) grows for it.
    expect(linesOf(LONG_TEAM, tossText, labelWidth)).toBeGreaterThan(1);
  });

  it.each(LANGUAGES)('%s: an order row holds a long name and the Opener plate', (_, dictionary) => {
    const opener = said(dictionary, 'scoring.cricket.setup.opener');
    expect(stateWidth(opener) + 2 * space.sm).toBeLessThanOrEqual(orderName);
    expect(labelWidth('M. Wolstenholme')).toBeLessThanOrEqual(orderName);
  });
});

/**
 * S2-4 plan Task 11: the keys under the board and the extras sheets, at 320 and 360 dp in four languages. The rooms are
 * written out from the keys' styles (`CricketKeys.tsx`): a row's cells share the column less the gaps (`space.sm`), and a
 * cell's text has the cell less its padding (`space.xs` a side) and its border (Out's the heavier). Every label is one
 * line (`numberOfLines` 1), so each must be no wider than its room: caps and letter-spacing as `actionSecondary` sets them.
 */
const keyLabelWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
const cellText = (cells: number, border: number) => (width: number) =>
  (column(width) - (cells - 1) * space.sm) / cells - 2 * space.xs - 2 * border;
const extraRoom = cellText(4, layout.iconBorder);
const actionRoom = cellText(3, layout.iconBorderOn);

const EXTRA_KEYS = [
  'scoring.cricket.key.wide',
  'scoring.cricket.key.noBall',
  'scoring.cricket.key.bye',
  'scoring.cricket.key.legBye',
] as const;
const ACTION_KEYS = [
  'scoring.cricket.key.out',
  'scoring.pad.undo',
  'scoring.cricket.key.more',
] as const;

describe('the keys’ rooms', () => {
  it('an extra’s text has 56 and 66 dp, an action’s 78.67 and 92', () => {
    expect(WIDTHS.map(extraRoom)).toEqual([56, 66]);
    expect(WIDTHS.map((width) => actionRoom(width).toFixed(2))).toEqual(['78.67', '92.00']);
  });

  it('each row holds its label: a run’s number at tally, an extra’s and an action’s one line', () => {
    expect(typeScale.tally.lineHeight + 2 * layout.iconBorder).toBeLessThanOrEqual(
      layout.cricketRunKey,
    );
    expect(typeScale.actionSecondary.lineHeight + 2 * layout.iconBorder).toBeLessThanOrEqual(
      layout.cricketExtraKey,
    );
    expect(2 * typeScale.actionSecondary.lineHeight + 2 * layout.iconBorderOn).toBeLessThanOrEqual(
      layout.cricketActionKey,
    );
    expect(layout.cricketExtraKey).toBeGreaterThanOrEqual(layout.touch);
    expect(layout.cricketActionKey).toBeGreaterThanOrEqual(layout.touch);
  });

  /**
   * The pad's height, portrait: the screen's padding (2 × 16), the header (48), the strip (16), the board (the score
   * panel, three crease rows and the over strip, `space.sm` apart: 266), the keys (two run rows, the extras, the actions,
   * `space.sm` apart: 256), the last-tap line (3 lines of 18: 54), the tool row (none: 0), and the pad's five gaps (8).
   */
  it('the board, the keys and the line fit the owner’s phone, about 360 × 724, with 12 dp to spare', () => {
    const board = layout.scorePanel + 3 * layout.creaseRow + layout.overStrip + 2 * space.sm;
    const keys =
      2 * layout.cricketRunKey + layout.cricketExtraKey + layout.cricketActionKey + 3 * space.sm;
    const line = layout.padLineLines * typeScale.control.lineHeight;
    const pad =
      2 * space.md +
      layout.touch +
      typeScale.metricUnit.lineHeight +
      board +
      space.sm +
      keys +
      line +
      4 * space.sm;
    expect([board, keys, line]).toEqual([266, 256, 54]);
    expect(724 - pad).toBe(12);
  });
});

describe.each(WIDTHS)('the keys at %i dp', (width) => {
  it.each(LANGUAGES)('%s: every extra’s key holds its word on one line', (_, dictionary) => {
    for (const key of EXTRA_KEYS) {
      expect(keyLabelWidth(said(dictionary, key)), key).toBeLessThanOrEqual(extraRoom(width));
    }
  });

  // Two lines at most (`numberOfLines` 2 in the 56 dp row: 2 × 19 and the heavier border), never a word broken: Dutch
  // "Ongedaan maken" takes two at both widths.
  it.each(LANGUAGES)(
    '%s: Out, Undo and More each hold their words, two lines at most',
    (_, dictionary) => {
      for (const key of ACTION_KEYS) {
        const text = said(dictionary, key);
        expect(linesOf(text, actionRoom(width), keyLabelWidth), key).toBeLessThanOrEqual(2);
        for (const word of text.split(' ')) {
          expect(keyLabelWidth(word), word).toBeLessThanOrEqual(actionRoom(width));
        }
      }
    },
  );

  it('Dutch Undo takes two lines (anti-vacuity)', () => {
    expect(linesOf(nl['scoring.pad.undo'], actionRoom(width), keyLabelWidth)).toBe(2);
  });

  it('the widest extra’s word is No-ball, in every language (anti-vacuity: it is measured)', () => {
    const widest = Math.max(
      ...LANGUAGES.flatMap(([, dictionary]) =>
        EXTRA_KEYS.map((key) => keyLabelWidth(said(dictionary, key))),
      ),
    );
    expect(widest).toBe(keyLabelWidth('No-ball'));
    expect(widest).toBeGreaterThan(40);
  });
});

describe.each(WIDTHS)('the extras sheets at %i dp', (width) => {
  /** The sheet's text: the screen less the sheet's padding (`space.md` a side). */
  const sheetText = width - 2 * space.md;
  /** A run key in the no-ball's widest row, six keys: the row less its gaps, shared. */
  const runKey = (sheetText - 5 * space.sm) / 6;

  it.each(LANGUAGES)(
    '%s: each group’s name is one line, and + Out’s row one line',
    (_, dictionary) => {
      for (const key of [
        'scoring.cricket.extras.ran',
        'scoring.cricket.extras.bat',
        'scoring.cricket.extras.runs',
      ]) {
        expect(linesOf(said(dictionary, key), sheetText, unitWidth), key).toBe(1);
      }
      const out = said(dictionary, 'scoring.cricket.extras.out');
      expect(geist500.width(out, typeScale.controlInk.fontSize)).toBeLessThanOrEqual(
        sheetText - 2 * space.md,
      );
    },
  );

  it('the widest run’s number (6) fits a key of a six-key row, at action', () => {
    expect(barlow700.width('6', typeScale.action.fontSize)).toBeLessThan(runKey);
    expect(runKey).toBeGreaterThanOrEqual(layout.touch - 8);
  });

  it.each(LANGUAGES)('%s: How out? is one line in the title', (_, dictionary) => {
    const title = said(dictionary, 'scoring.cricket.wicket.how');
    expect(linesOf(title, sheetText, sheetTitleWidth)).toBe(1);
  });
});

/** A sheet's title: `title`, uppercase and letterspaced. */
const sheetTitleWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  text.length * (typeScale.title.letterSpacing ?? 0);

/**
 * S2-4 plan Task 12: the wicket steps' words, at 320 and 360 dp in four languages. Each title one line; each row's label
 * one line at `controlInk` inside the row's padding; each row's note one line at `metricUnit`.
 */
const WICKET_TITLES = ['how', 'who', 'fielder', 'assist', 'completed', 'incoming'].map(
  (step) => `scoring.cricket.wicket.${step}`,
);
const WICKET_ROWS = [
  ...[
    'bowled',
    'caught',
    'lbw',
    'runout',
    'stumped',
    'hitwicket',
    'obstructed',
    'hitballtwice',
  ].map((kind) => `scoring.cricket.wicket.kind.${kind}`),
  'scoring.cricket.wicket.noFielder',
  'scoring.cricket.wicket.noAssist',
];
const WICKET_NOTES = [
  'scoring.cricket.board.onStrike',
  'scoring.cricket.wicket.nonStriker',
  'scoring.cricket.wicket.isFielder',
  'scoring.cricket.wicket.retired',
  'scoring.cricket.wicket.nextInOrder',
];

describe.each(WIDTHS)('the wicket steps at %i dp', (width) => {
  const sheetText = width - 2 * space.md;
  const rowText = sheetText - 2 * space.md;
  const rowWidth = (text: string) => geist500.width(text, typeScale.controlInk.fontSize);

  it.each(LANGUAGES)(
    '%s: every title is one line, every row and note one line',
    (_, dictionary) => {
      for (const key of WICKET_TITLES) {
        expect(linesOf(said(dictionary, key), sheetText, sheetTitleWidth), key).toBe(1);
      }
      for (const key of WICKET_ROWS) {
        expect(rowWidth(said(dictionary, key)), key).toBeLessThanOrEqual(rowText);
      }
      for (const key of WICKET_NOTES) {
        expect(unitWidth(said(dictionary, key)), key).toBeLessThanOrEqual(rowText);
      }
    },
  );
});

it('the widest wicket title is wider than half the sheet at 320 (anti-vacuity: titles are measured uppercase)', () => {
  const widest = Math.max(
    ...LANGUAGES.flatMap(([, dictionary]) =>
      WICKET_TITLES.map((key) => sheetTitleWidth(said(dictionary, key))),
    ),
  );
  expect(widest).toBeGreaterThan((320 - 2 * space.md) / 2);
});

/**
 * S2-4 plan Task 13: the over-end sheet, More, and the change's steps, at 320 and 360 dp in four languages. Titles one
 * line (the title with the widest over number a format has, 50); each row's label and note one line; the sheet's own way
 * back ("Undo", the kit's word) one line at `control`, and the standing sheet's Players and More, each half the sheet's row
 * less the gap, its padding and its border, one line at `control`; the line under the title (`body`) at most two.
 */
const BOWLING_TITLES = ['scoring.cricket.change.title', 'scoring.cricket.change.why'];
const BOWLING_ROWS = [
  'scoring.cricket.more.change',
  'scoring.cricket.more.swap',
  'scoring.cricket.change.reason.incapacitated',
  'scoring.cricket.change.reason.suspended',
  'scoring.cricket.change.reason.other',
];
const LONG_CLUB = 'Bishops Stortford Cricket Club';

describe.each(WIDTHS)('the next bowler and More at %i dp', (width) => {
  const sheetText = width - 2 * space.md;
  const rowText = sheetText - 2 * space.md;
  const halfButton = (sheetText - space.sm) / 2 - 2 * space.md - 2 * layout.iconBorder;
  const rowWidth = (text: string) => geist500.width(text, typeScale.controlInk.fontSize);
  const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);

  it.each(LANGUAGES)(
    '%s: titles one line, rows and notes one line, Undo, Players and More one line',
    (_, dictionary) => {
      const over = fill(said(dictionary, 'scoring.cricket.bowling.title'), { number: 50 });
      for (const title of [over, ...BOWLING_TITLES.map((key) => said(dictionary, key))]) {
        expect(linesOf(title, sheetText, sheetTitleWidth), title).toBe(1);
      }
      for (const key of BOWLING_ROWS) {
        expect(rowWidth(said(dictionary, key)), key).toBeLessThanOrEqual(rowText);
      }
      const notes = [
        said(dictionary, 'scoring.cricket.bowling.lastOver'),
        fill(said(dictionary, 'scoring.cricket.bowling.outOfOvers'), { max: 10 }),
        '10.0-10-100-10',
      ];
      for (const note of notes) expect(unitWidth(note), note).toBeLessThanOrEqual(rowText);
      const undo = said(dictionary, 'scoring.pad.undo');
      expect(geist500.width(undo, typeScale.control.fontSize)).toBeLessThanOrEqual(rowText);
      for (const key of ['scoring.cricket.players.title', 'scoring.cricket.key.more']) {
        const word = geist500.width(said(dictionary, key), typeScale.control.fontSize);
        expect(word, key).toBeLessThanOrEqual(halfButton);
      }
    },
  );

  it.each(LANGUAGES)('%s: the line under the title is at most two lines', (_, dictionary) => {
    const body = fill(said(dictionary, 'scoring.cricket.bowling.body'), { team: LONG_CLUB });
    const none = said(dictionary, 'scoring.cricket.bowling.none');
    for (const text of [body, none])
      expect(linesOf(text, sheetText, bodyWidth), text).toBeLessThanOrEqual(2);
  });
});

it('the thirty-character club takes the bowling line’s second line at 320 (anti-vacuity)', () => {
  const body = fill(said(en, 'scoring.cricket.bowling.body'), { team: LONG_CLUB });
  const width = (text: string) => geist400.width(text, typeScale.body.fontSize);
  expect(linesOf(body, 320 - 2 * space.md, width)).toBe(2);
});

/**
 * S2-4 plan Task 14: the Players sheet, at 320 and 360 dp in four languages. The title one line; each tab's word one line
 * in half the sheet less the gap, its padding and the chosen border; a batter's name column is the row less the place
 * (`space.lg`), the striker's mark (`space.md`) and their gaps, and, yet to bat, less ▲▼ (48 dp each, a gap before
 * each). How a batter stands, at the longest numbers, is one line, but out with the longest dismissal's words at most two
 * (es "Eliminado, obstructing the field"); a bowler's note is one line in a row's text width (the kit's step row, or the
 * read-only line, both `space.md` in from the sheet's).
 */
const DISMISSALS = [
  'bowled',
  'caught',
  'lbw',
  'runout',
  'stumped',
  'hitwicket',
  'retired',
  'obstructed',
  'timedout',
  'hitballtwice',
].map((kind) => `scoring.cricket.out.kind.${kind}`);
const INNINGS_FIGURES = { runs: 199, balls: 120 };

describe.each(WIDTHS)('the Players sheet at %i dp', (width) => {
  const sheetText = width - 2 * space.md;
  const rowText = sheetText - 2 * space.md;
  const nameColumn = sheetText - space.lg - space.md - 2 * space.sm;
  const yetColumn = nameColumn - 2 * (space.sm + layout.touch);
  const tabText = (sheetText - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorderOn;
  const tabWidth = (text: string) => geist500.width(text, typeScale.controlInk.fontSize);

  it.each(LANGUAGES)(
    '%s: title and tabs one line; batters and bowlers in their rooms',
    (_, dictionary) => {
      const title = said(dictionary, 'scoring.cricket.players.title');
      expect(linesOf(title, sheetText, sheetTitleWidth), title).toBe(1);
      for (const tab of ['batting', 'bowling']) {
        const word = said(dictionary, `scoring.cricket.players.${tab}`);
        expect(tabWidth(word), word).toBeLessThanOrEqual(tabText);
      }
      for (const key of ['in', 'outPlain', 'retired']) {
        const note = fill(said(dictionary, `scoring.cricket.players.${key}`), INNINGS_FIGURES);
        expect(unitWidth(note), note).toBeLessThanOrEqual(nameColumn);
      }
      for (const how of DISMISSALS) {
        const out = said(dictionary, 'scoring.cricket.players.out');
        const note = fill(out, { ...INNINGS_FIGURES, how: said(dictionary, how) });
        expect(linesOf(note, nameColumn, unitWidth), note).toBeLessThanOrEqual(2);
      }
      const yet = said(dictionary, 'scoring.cricket.players.yet');
      expect(unitWidth(yet), yet).toBeLessThanOrEqual(yetColumn);
      const cannot = said(dictionary, 'scoring.cricket.players.cannot');
      const why = [
        said(dictionary, 'scoring.cricket.bowling.lastOver'),
        fill(said(dictionary, 'scoring.cricket.bowling.outOfOvers'), { max: 10 }),
      ];
      const bowling = [
        ...why.map((reason) => fill(cannot, { figures: SPELL, why: reason })),
        fill(said(dictionary, 'scoring.cricket.players.figures.other'), {
          figures: SPELL,
          count: 10,
        }),
        fill(said(dictionary, 'scoring.cricket.players.figures.one'), { figures: SPELL, count: 1 }),
      ];
      for (const note of bowling) expect(unitWidth(note), note).toBeLessThanOrEqual(rowText);
    },
  );
});

it('Players’ out note takes its second line in es at 320 (anti-vacuity: the two-line allowance is used)', () => {
  const note = fill(said(es, 'scoring.cricket.players.out'), {
    ...INNINGS_FIGURES,
    how: said(es, 'scoring.cricket.out.kind.obstructed'),
  });
  const column = 320 - 2 * space.md - space.lg - space.md - 2 * space.sm;
  expect(linesOf(note, column, unitWidth)).toBe(2);
});

/**
 * S2-4 plan Task 15: More's rows and their steps, at 320 and 360 dp in four languages. Each row's label one line at
 * `controlInk` inside the row's padding, as Task 13's; each step's title one line (with the penalty's five runs); a greyed
 * review's note one line; a typed number's label at most two lines beside its field (the kit's `PointsField`: the label
 * flexes beside a field two touch targets wide, `space.sm` apart).
 */
const MORE_ROWS = [
  'otherRuns',
  'retire',
  'review',
  'newBall',
  'powerplay',
  'powerplayEnd',
  'interruption',
  'revise',
  'declare',
  'close',
  'followOn',
  'matchClose',
].map((row) => `scoring.cricket.more.${row}`);
const MORE_STEP_ROWS = [
  'scoring.cricket.retire.reason.hurt',
  'scoring.cricket.retire.reason.out',
  'scoring.cricket.retire.reason.other',
  'scoring.cricket.review.kind.player',
  'scoring.cricket.review.kind.umpire',
  'scoring.cricket.review.outcome.upheld',
  'scoring.cricket.review.outcome.struck_down',
  'scoring.cricket.review.outcome.umpires_call',
  'scoring.cricket.confirm.declare.do',
  'scoring.cricket.confirm.newBall.do',
  'scoring.cricket.confirm.followOn.do',
  'scoring.cricket.confirm.matchClose.do',
  'scoring.cricket.closing.reason.time',
  'scoring.cricket.closing.reason.weather',
  'scoring.cricket.closing.reason.other',
  'scoring.cricket.powerplay.end',
  'scoring.cricket.powerplay.kind.mandatory',
  'scoring.cricket.powerplay.kind.batting',
  'scoring.cricket.powerplay.kind.bowling',
  'scoring.cricket.interruption.kind.rain',
  'scoring.cricket.interruption.kind.light',
  'scoring.cricket.interruption.kind.other',
  'scoring.cricket.other.title',
];
const MORE_TITLES = [
  'scoring.cricket.other.title',
  'scoring.cricket.retire.who',
  'scoring.cricket.retire.why',
  'scoring.cricket.review.by',
  'scoring.cricket.review.kind',
  'scoring.cricket.review.outcome',
  'scoring.cricket.confirm.declare.title',
  'scoring.cricket.confirm.newBall.title',
  'scoring.cricket.confirm.followOn.title',
  'scoring.cricket.confirm.matchClose.title',
  'scoring.cricket.closing.title',
  'scoring.cricket.powerplay.title',
  'scoring.cricket.powerplay.endTitle',
  'scoring.cricket.interruption.title',
  'scoring.cricket.interruption.lostTitle',
  'scoring.cricket.revise.title',
];
const ENTRY_LABELS = [
  'scoring.cricket.interruption.lost',
  'scoring.cricket.revise.overs',
  'scoring.cricket.revise.target',
];

describe.each(WIDTHS)('More’s rows and steps at %i dp', (width) => {
  const sheetText = width - 2 * space.md;
  const rowText = sheetText - 2 * space.md;
  const rowWidth = (text: string) => geist500.width(text, typeScale.controlInk.fontSize);
  const fieldLabel = sheetText - 2 * layout.touch - space.sm;

  it.each(LANGUAGES)('%s: rows one line, titles one line, field labels two', (_, dictionary) => {
    const ran = fill(said(dictionary, 'scoring.cricket.other.ran'), { runs: 6 });
    const penalty = fill(said(dictionary, 'scoring.cricket.other.penalty'), { runs: 5 });
    for (const row of [...MORE_ROWS, ...MORE_STEP_ROWS].map((key) => said(dictionary, key))) {
      expect(rowWidth(row), row).toBeLessThanOrEqual(rowText);
    }
    for (const row of [ran, penalty]) expect(rowWidth(row), row).toBeLessThanOrEqual(rowText);
    for (const title of [penalty, ...MORE_TITLES.map((key) => said(dictionary, key))]) {
      expect(linesOf(title, sheetText, sheetTitleWidth), title).toBe(1);
    }
    for (const key of ['scoring.cricket.review.noneLeft', 'scoring.cricket.retire.nobody']) {
      const note = said(dictionary, key);
      expect(unitWidth(note), note).toBeLessThanOrEqual(rowText);
    }
    for (const label of ENTRY_LABELS.map((key) => said(dictionary, key))) {
      expect(linesOf(label, fieldLabel, rowWidth), label).toBeLessThanOrEqual(2);
    }
  });
});

it('a typed number’s label takes its second line in nl at 320 (anti-vacuity: the two-line allowance is used)', () => {
  const label = said(nl, 'scoring.cricket.interruption.lost');
  const room = 320 - 2 * space.md - 2 * layout.touch - space.sm;
  const width = (text: string) => geist500.width(text, typeScale.controlInk.fontSize);
  expect(linesOf(label, room, width)).toBe(2);
});

it('More’s widest step title is within a tenth of the sheet at 320 (anti-vacuity: titles are measured uppercase)', () => {
  const widest = Math.max(
    ...LANGUAGES.flatMap(([, dictionary]) =>
      MORE_TITLES.map((key) => sheetTitleWidth(said(dictionary, key))),
    ),
  );
  expect(widest).toBeGreaterThan(0.9 * (320 - 2 * space.md));
});

/**
 * S2-4 plan Task 16: the innings break's card, its Start innings and the result's words. The card stands at the top of
 * the setup's scroll, so its line may wrap (no line limit): what can fail is a word wider than the column, or a title
 * that takes a second line. Start innings is a `Button` (`action` caps, `space.xl` a side). The result is the strip's one
 * slot, the whole column, one line for a fixture's names (`layout.padStripLines`, `metricUnit`); two lines since Task 18.
 */
const BREAK_TITLES = ['title', 'tied', 'superOver'].map((key) => `scoring.cricket.break.${key}`);
const RESULT_KEYS = [
  'runs.other',
  'wickets.other',
  'innings_and_runs.other',
  'super_over',
  'boundary_count',
  'win',
  'award',
  'tie',
  'draw',
  'no_result',
  'double_walkover',
].map((key) => `scoring.cricket.result.${key}`);
/** The fixtures' side names are twelve characters; a thirty-character club's is the long case. */
const TWELVE = 'Hillcrest CC';
const THIRTY = 'Bishops Stortford Cricket Club';

describe.each(WIDTHS)('the innings break and the result at %i dp', (width) => {
  const capsWidth = (role: 'panelTitle' | 'action') => (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
    typeScale[role].letterSpacing * [...text].length;
  const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
  /** A Button's label: the column less its padding, `space.xl` a side. */
  const startText = column(width) - 2 * space.xl;
  /** The break's line at its longest numbers: a 999/10 innings of 189.5 overs, then 999 off 120 balls. */
  const breakLine = (dictionary: Dictionary, team: string) =>
    fill(said(dictionary, 'scoring.cricket.break.line'), {
      closed: fill(said(dictionary, 'scoring.cricket.break.closed'), {
        team,
        score: SCORE,
        overs: OVERS,
      }),
      next: fill(said(dictionary, 'scoring.cricket.break.chase.other'), {
        team,
        target: CHASE.runs,
        count: CHASE.count,
      }),
    });

  it.each(LANGUAGES)('%s: each break title is one line in the column', (_, dictionary) => {
    for (const key of BREAK_TITLES) {
      const title = said(dictionary, key);
      expect(linesOf(title, column(width), capsWidth('panelTitle')), title).toBe(1);
    }
    // T19 D12: a repeated super over's tie names the next, at two digits.
    const again = fill(said(dictionary, 'scoring.cricket.break.tiedAgain'), { number: 12 });
    expect(wordsFit(again, column(width), capsWidth('panelTitle')), again).toBe(true);
    expect(linesOf(again, column(width), capsWidth('panelTitle')), again).toBeLessThanOrEqual(2);
  });

  it.each(LANGUAGES)('%s: Start innings is one line in its button', (_, dictionary) => {
    const label = said(dictionary, 'scoring.cricket.setup.startInnings');
    expect(linesOf(label, startText, capsWidth('action')), label).toBe(1);
  });

  it.each(LANGUAGES)(
    '%s: the break’s line keeps every word whole, two lines at most with the fixtures’ names',
    (_, dictionary) => {
      for (const team of [TWELVE, THIRTY]) {
        for (const word of breakLine(dictionary, team).split(' ')) {
          expect(bodyWidth(word), word).toBeLessThanOrEqual(column(width));
        }
      }
      expect(linesOf(breakLine(dictionary, TWELVE), column(width), bodyWidth)).toBeLessThanOrEqual(
        2,
      );
    },
  );

  it.each(LANGUAGES)(
    '%s: every result is one line in the strip with the fixtures’ names',
    (_, dictionary) => {
      for (const key of RESULT_KEYS) {
        const words = fill(said(dictionary, key), { name: TWELVE, count: CHASE.runs });
        expect(linesOf(words, column(width), unitWidth), words).toBe(layout.padStripLines);
      }
    },
  );
});

it('the widest Start innings fills nine tenths of its button at 320 (anti-vacuity: it is measured in caps)', () => {
  const room = 320 - 2 * space.md - 2 * space.xl;
  const caps = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.action.fontSize) +
    typeScale.action.letterSpacing * [...text].length;
  const widest = Math.max(
    ...LANGUAGES.map(([, dictionary]) =>
      caps(said(dictionary, 'scoring.cricket.setup.startInnings')),
    ),
  );
  expect(widest).toBeGreaterThan(0.9 * room);
});

// A thirty-character club's name takes the result past one line at 320 (the strip's one line is the kit's rule, and
// the cricket result asks the strip for two: `PadStripItem.lines`, Task 18). Pinned so a change to the strip or the words
// is seen; `the result and the break’s lines` below holds it to two.
it('a thirty-character name takes the strip past one line at 320 for an innings win in every language', () => {
  const room = 320 - 2 * space.md;
  for (const [, dictionary] of LANGUAGES) {
    const words = fill(said(dictionary, 'scoring.cricket.result.innings_and_runs.other'), {
      name: THIRTY,
      count: CHASE.runs,
    });
    expect(linesOf(words, room, unitWidth), words).toBe(2);
  }
});

// S2-4 plan Task 17: over totals (the entry in the keys' place) at 320 and 360 dp in four languages. The
// note is `body` text and may take three lines; the heading is one line (`panelTitle`);
// each field's name is one line in what a row leaves it beside two steppers and the figure; Record over is one line in its
// plate. The steppers' spoken labels are never drawn: they carry the field's name in the dictionary's own place for it.
const TOTALS_NOTES = ['noPlayers', 'stays', 'tied'].map((key) => `scoring.cricket.totals.${key}`);
const TOTALS_FIELDS = ['runs', 'wickets', 'balls'].map((key) => `scoring.cricket.totals.${key}`);
const TOTALS_SPOKEN = ['less', 'more'].map((key) => `scoring.cricket.totals.${key}`);
/** The longest over a format can number: two digits do for any overs but an unlimited match's, whose numbers stay small. */
const OVER_NUMBER = 99;

describe.each(WIDTHS)('over totals at %i dp', (width) => {
  const caps = (role: 'panelTitle' | 'action') => (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
    typeScale[role].letterSpacing * [...text].length;
  const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
  /** A field's row: its name, then − (a touch wide), the figure (a touch wide) and +, `space.sm` apart. */
  const nameRoom = column(width) - 3 * layout.touch - 3 * space.sm;

  it.each(LANGUAGES)(
    '%s: each note keeps its words whole, three lines at most',
    (_, dictionary) => {
      for (const key of TOTALS_NOTES) {
        const note = said(dictionary, key);
        for (const word of note.split(' ')) {
          expect(bodyWidth(word), word).toBeLessThanOrEqual(column(width));
        }
        expect(linesOf(note, column(width), bodyWidth), note).toBeLessThanOrEqual(3);
      }
    },
  );

  it.each(LANGUAGES)('%s: the heading is one line on the pad', (_, dictionary) => {
    const heading = fill(said(dictionary, 'scoring.cricket.totals.title'), {
      number: OVER_NUMBER,
    });
    expect(linesOf(heading, column(width), caps('panelTitle')), heading).toBe(1);
  });

  it.each(LANGUAGES)('%s: each field’s name is one line beside the steppers', (_, dictionary) => {
    for (const key of TOTALS_FIELDS) {
      const name = said(dictionary, key);
      expect(labelWidth(name), name).toBeLessThanOrEqual(nameRoom);
    }
  });

  it.each(LANGUAGES)('%s: Record over is one line in its button', (_, dictionary) => {
    const label = said(dictionary, 'scoring.cricket.totals.record');
    const room = column(width) - 2 * space.xl;
    expect(linesOf(label, room, caps('action')), label).toBe(1);
  });

  it.each(LANGUAGES)('%s: a stepper’s spoken label names its field', (_, dictionary) => {
    for (const key of TOTALS_SPOKEN) expect(said(dictionary, key), key).toContain('{field}');
  });
});

describe('over totals on the pad', () => {
  /**
   * The totals body is the score panel, the note (three lines at most), the heading, three rows of a touch and Record over
   * (a plate of 56), `space.sm` apart. The keys' body is the board and the keys: 266 and 256. It fits wherever those fit.
   */
  it('the score, the note, the entry and Record over are shorter than the board and the keys', () => {
    const rows = 3 * layout.touch + 2 * space.sm;
    const totals =
      layout.scorePanel +
      space.sm +
      3 * typeScale.body.lineHeight +
      space.sm +
      typeScale.panelTitle.lineHeight +
      space.sm +
      rows +
      space.sm +
      56;
    const keysBody = 266 + space.sm + 256;
    expect(totals).toBe(112 + 8 + 66 + 8 + 24 + 8 + 160 + 8 + 56);
    expect(totals).toBeLessThan(keysBody);
  });

  it('the longest note takes two lines at 320 in some language (anti-vacuity: it is measured)', () => {
    const most = Math.max(
      ...LANGUAGES.flatMap(([, dictionary]) =>
        TOTALS_NOTES.map((key) =>
          linesOf(said(dictionary, key), column(320), (text) =>
            geist400.width(text, typeScale.body.fontSize),
          ),
        ),
      ),
    );
    expect(most).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S2-4 plan Task 18: the rest of the strings, at 320 and 360 dp in four languages, then the sweep that asks for every key.
// Rooms are written out from the components' styles (never read from them). A text that wraps is held to the lines the
// design allows and to every word whole: a word wider than its room is the failure. What is cut with an ellipsis (the
// last-tap line at three lines, a History sentence at two) is cut on the phone, so each such sentence is measured and the
// ones that run over at 320 are listed literally.
// ---------------------------------------------------------------------------------------------------------------

/** A person with a long double-barrelled name, as a team sheet can hold one (26 characters). */
const PERSON = 'M. Wolstenholme-Fitzgerald';

/** `body`: Geist 400 at 15. Rules, hints, the scorecard's notes. */
const bodyOf = (text: string) => geist400.width(text, typeScale.body.fontSize);
/** `status`: Geist 400 at 13.5. A scorecard line's how-out. */
const statusOf = (text: string) => geist400.width(text, typeScale.status.fontSize);
/** Caps and letter-spacing as a display role sets them: `panelTitle`, `action`, `state`. */
const capsOf = (role: 'panelTitle' | 'action' | 'state') => (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
  typeScale[role].letterSpacing * [...text].length;
/** A ghost button's box: its word at `control`, `space.md` padding and the border a side. */
const ghostBox = (text: string) => controlWidth(text) + 2 * space.md + 2 * layout.iconBorder;
/** A `Button`'s box: its caps label and `space.xl` a side, at least 200. */
const buttonBox = (text: string) => Math.max(200, capsOf('action')(text) + 2 * space.xl);
/**
 * Every word of a text fits the room: what wraps is never broken mid-word, and nothing overflows. A word is what lies
 * between spaces and hyphens: the line breaker (UAX 14, on Android ICU) may break after a hyphen, which `linesOf` does
 * not model, so a hyphenated name is held to its halves. Whether a name really breaks there is the device check's.
 */
const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  text.split(/ |(?<=-)/).every((piece) => measure(piece) <= room);

describe.each(WIDTHS)('the setup steps and the bowler step’s foot at %i dp', (width) => {
  const read = (dictionary: Dictionary, key: string) =>
    said(dictionary, `scoring.cricket.setup.${key}`);
  const startKeys = ['scoring.cricket.setup.startInnings', 'scoring.start.confirm'] as const;

  // The order step's foot is More (a break) beside Next, the bowler step's Back (or More) beside the start button, in one
  // wrapping row (`styles.pair`): a button that does not fit beside the ghost goes under it and takes the row. With both
  // Back and More the two share a row above the start button (Task 16 concern 3). So each piece must fit a row alone.
  it.each(LANGUAGES)(
    '%s: each foot button fits a row alone, so a wrapped pair is two whole rows',
    (_, dictionary) => {
      const ghosts = [read(dictionary, 'back'), said(dictionary, 'scoring.cricket.key.more')];
      const buttons = [read(dictionary, 'next'), ...startKeys.map((key) => said(dictionary, key))];
      for (const ghost of ghosts) expect(ghostBox(ghost), ghost).toBeLessThanOrEqual(column(width));
      for (const button of buttons)
        expect(buttonBox(button), button).toBeLessThanOrEqual(column(width));
    },
  );

  it.each(LANGUAGES)(
    '%s: two ghost buttons side by side are a half-row each, the start button a row of its own',
    (_, dictionary) => {
      const half = (column(width) - space.sm) / 2;
      for (const word of [read(dictionary, 'back'), said(dictionary, 'scoring.cricket.key.more')])
        expect(ghostBox(word), word).toBeLessThanOrEqual(half);
      for (const key of startKeys)
        expect(buttonBox(said(dictionary, key)), key).toBeLessThanOrEqual(column(width));
    },
  );

  // Anti-vacuity: the three in one row did not fit, which is why the foot stacks them (English is the shortest).
  it('Back, More and Start innings in one row would not fit (English, the shortest words)', () => {
    const row =
      ghostBox(read(en, 'back')) +
      ghostBox(said(en, 'scoring.cricket.key.more')) +
      buttonBox(read(en, 'startInnings')) +
      2 * space.sm;
    expect(row).toBeGreaterThan(column(width));
  });

  it.each(LANGUAGES)(
    '%s: the order and bowler headings keep every word whole in three lines with a thirty-character club',
    (_, dictionary) => {
      for (const key of ['order', 'bowler']) {
        const heading = fill(read(dictionary, key), { team: THIRTY });
        expect(wordsFit(heading, column(width), capsOf('panelTitle')), heading).toBe(true);
        expect(linesOf(heading, column(width), capsOf('panelTitle')), heading).toBeLessThanOrEqual(
          3,
        );
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: the hint is two lines at most and the openers line keeps every word whole',
    (_, dictionary) => {
      const hint = read(dictionary, 'orderHint');
      expect(linesOf(hint, column(width), bodyOf), hint).toBeLessThanOrEqual(2);
      const openers = fill(read(dictionary, 'openers'), { striker: PERSON, nonStriker: PERSON });
      expect(wordsFit(openers, column(width), bodyOf), openers).toBe(true);
      expect(linesOf(openers, column(width), bodyOf), openers).toBeLessThanOrEqual(3);
    },
  );

  it.each(LANGUAGES)('%s: Record (a typed number) is one line in its button', (_, dictionary) => {
    const label = said(dictionary, 'scoring.cricket.entry.record');
    expect(linesOf(label, column(width) - 2 * space.xl, capsOf('action')), label).toBe(1);
  });

  // The ▲▼ names and the tally are read, never drawn: they carry their fill in the dictionary's own place.
  it.each(LANGUAGES)('%s: the spoken labels carry their fill', (_, dictionary) => {
    for (const key of ['up', 'down']) expect(read(dictionary, key)).toContain('{name}');
    expect(said(dictionary, 'scoring.cricket.tallySaid')).toContain('{score}');
    expect(said(dictionary, 'scoring.cricket.tallyNone')).not.toBe('');
  });
});

// Anti-vacuity: at 320 a ghost button and "Start innings" do not share a row in any language, so the wrap above is real.
it.each(LANGUAGES)(
  '%s: Back beside Start innings would not fit one row at 320',
  (_, dictionary) => {
    const pair =
      ghostBox(said(dictionary, 'scoring.cricket.setup.back')) +
      space.sm +
      buttonBox(said(dictionary, 'scoring.cricket.setup.startInnings'));
    expect(pair).toBeGreaterThan(column(320));
  },
);

it('the order step’s hint takes a second line in some language at 320 (anti-vacuity: two lines are used)', () => {
  const most = Math.max(
    ...LANGUAGES.map(([, dictionary]) =>
      linesOf(said(dictionary, 'scoring.cricket.setup.orderHint'), column(320), bodyOf),
    ),
  );
  expect(most).toBe(2);
});

// Match details' rules table (`MatchCard`, in the sheet): a label column, at most `padRuleLabelMax`, then the value in
// what is left, both at `body`, wrapping. Every word must fit; the label column is the widest label's.
const RULE_ROWS = [
  ['overs', { overs: '50' }, 'value'],
  ['over', { balls: '8' }, 'value'],
  ['players', { players: '11' }, 'value'],
  ['bowler', { count: '10' }, 'value.other'],
  ['superOver', {}, 'on'],
  ['followOn', { lead: '999' }, 'value'],
  ['reviews', { reviews: '3' }, 'value'],
] as const;

describe.each(WIDTHS)('Match details’ rules at %i dp', (width) => {
  const valueKeys = (dictionary: Dictionary) => [
    ...RULE_ROWS.map(([row, vars, value]) =>
      fill(said(dictionary, `scoring.cricket.rules.${row}.${value}`), vars),
    ),
    fill(said(dictionary, 'scoring.cricket.rules.bowler.value.one'), { count: '1' }),
    said(dictionary, 'scoring.cricket.rules.overs.unlimited'),
    said(dictionary, 'scoring.cricket.rules.bowler.none'),
    said(dictionary, 'scoring.cricket.rules.superOver.off'),
  ];
  const labelsOf = (dictionary: Dictionary) =>
    RULE_ROWS.map(([row]) => said(dictionary, `scoring.cricket.rules.${row}.label`));

  it.each(LANGUAGES)(
    '%s: every label and value keeps its words whole in the card’s columns',
    (_, dictionary) => {
      const labels = labelsOf(dictionary);
      const labelColumn = Math.min(
        Math.ceil(Math.max(...labels.map(bodyOf))),
        layout.padRuleLabelMax,
      );
      const valueRoom = column(width) - labelColumn - space.md;
      for (const label of labels) {
        expect(wordsFit(label, labelColumn, bodyOf), label).toBe(true);
        expect(linesOf(label, labelColumn, bodyOf), label).toBeLessThanOrEqual(2);
      }
      for (const value of valueKeys(dictionary)) {
        expect(wordsFit(value, valueRoom, bodyOf), value).toBe(true);
        expect(linesOf(value, valueRoom, bodyOf), value).toBeLessThanOrEqual(2);
      }
    },
  );
});

// The last-tap line (three lines of `control` beside Undo) and a History row's sentence (what the right column leaves).
// The last-tap line is cut with an ellipsis, the head kept (the pattern of padFit's last-tap case), so each sentence is
// measured at its widest realistic fill: a club of thirty characters at the toss, short names for the rest and a ball with
// every part. A History row is not cut (controller's ruling, 2026-11-09, S2-4 Task 18 fix round): cricket's rows wrap with
// no line cap (`MatchHistory` `uncapped`), so the tests below hold that every word of every sentence fits the room, whole,
// and pin what the kit's two-line cap would have cut, as anti-vacuity. A name of 26 characters is held to its own test.
describe('the last-tap line and History sentences', () => {
  const lineRoom = (width: number, dictionary: Dictionary) =>
    column(width) - ghostBox(said(dictionary, 'scoring.pad.undo')) - space.sm;
  const historyRoom = (width: number) => column(width) - space.sm - layout.padHistorySide;
  const BALL_KINDS = ['wide', 'noball', 'bye', 'legbye', 'penalty'] as const;

  type Who = {
    readonly batter: string;
    readonly person: string;
    readonly assist: string;
    readonly fielder: string;
  };
  /** The widest a roster usually goes: initial and surname. */
  const USUAL: Who = {
    batter: 'A. Sharma',
    person: 'A. Sharma',
    assist: 'R. Iyer',
    fielder: 'A. Sharma',
  };
  /** The longest name a team sheet can hold, as the batter and the one the sentence is about (the fielders stay usual). */
  const LONGEST: Who = { ...USUAL, batter: PERSON, person: PERSON };

  /** One text per key, each at its widest fill, keyed by what the sentence is. */
  const sentences = (dictionary: Dictionary, who: Who): readonly (readonly [string, string])[] => {
    const at = (key: string, vars: Readonly<Record<string, string | number>> = {}) =>
      fill(said(dictionary, key), vars);
    const how = said(dictionary, 'scoring.cricket.out.kind.runout');
    const caught = at('scoring.cricket.out.fielder', {
      how: said(dictionary, 'scoring.cricket.out.kind.caught'),
      fielder: who.fielder,
    });
    const runout = at('scoring.cricket.out.fielders', {
      how,
      assist: who.assist,
      fielder: who.fielder,
    });
    const dismissal = at('scoring.cricket.out', { batter: who.batter, how: runout });
    const extra = at('scoring.cricket.ball.noball.other', { count: 5 });
    const runs = at('scoring.cricket.ball.runs.other', { count: 6 });
    const and = (first: string, second: string) =>
      at('scoring.cricket.ball.and', { first, second });
    const ball = and(and(extra, runs), dismissal);
    return [
      ['toss bat', at('scoring.cricket.last.toss.bat', { name: THIRTY })],
      ['toss bowl', at('scoring.cricket.last.toss.bowl', { name: THIRTY })],
      ['start', at('scoring.cricket.last.start')],
      ['summary', at('scoring.cricket.last.summary', { runs: 999, wickets: 10, overs: '189.5' })],
      ['retire hurt', at('scoring.cricket.last.retire.hurt', { name: who.person })],
      ['retire out', at('scoring.cricket.last.retire.out', { name: who.person })],
      ['retire', at('scoring.cricket.last.retire.plain', { name: who.person })],
      ['bowler', at('scoring.cricket.last.bowlerChange', { name: who.person })],
      ['dot', at('scoring.cricket.ball.dot')],
      ['four', at('scoring.cricket.ball.four')],
      ['six', at('scoring.cricket.ball.six')],
      ['one run', at('scoring.cricket.ball.runs.one', { count: 1 })],
      ...BALL_KINDS.flatMap((kind): (readonly [string, string])[] => [
        [`${kind} one`, at(`scoring.cricket.ball.${kind}.one`, { count: 1 })],
        [`${kind} many`, at(`scoring.cricket.ball.${kind}.other`, { count: 5 })],
      ]),
      ['caught', at('scoring.cricket.out', { batter: who.batter, how: caught })],
      ['run out', dismissal],
      ['a whole ball', ball],
      ['undone ball', at('scoring.cricket.last.undone', { what: ball })],
      ...Object.keys(dictionary)
        .filter((key) => key.startsWith('scoring.cricket.event.'))
        .map((key): readonly [string, string] => [key, at(key)]),
    ];
  };

  // Eight at the toss, a retirement and a bowler's change, four runs-or-dot words, ten extras (five kinds, one and many),
  // four ball sentences and twenty-six events (`scoring.cricket.event.*`).
  it('reads fifty-two sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary, USUAL)).toHaveLength(52);
  });

  /** The two sentences that join every part of a ball; every other sentence is one clause. */
  const COMPOSITE = ['a whole ball', 'undone ball'];
  /** History shows a tap's own sentence; "Undone" is a word in the row's right column, so the undone wrapper is the last-tap line's alone. */
  const IN_HISTORY = (name: string) => name !== 'undone ball';

  const over = (
    limit: number,
    room: (width: number, dictionary: Dictionary) => number,
    width: number,
    only: (name: string) => boolean,
  ) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      sentences(dictionary, USUAL)
        .filter(
          ([name, text]) =>
            only(name) && linesOf(text, room(width, dictionary), controlWidth) > limit,
        )
        .map(([name]) => `${lang} ${name}`),
    );
  const single = (name: string) => !COMPOSITE.includes(name);
  const composite = (name: string) => COMPOSITE.includes(name);

  it('the last-tap line holds every one-clause sentence in its three lines at 360 and 320', () => {
    expect(over(layout.padLineLines, lineRoom, 360, single)).toEqual([]);
    expect(over(layout.padLineLines, lineRoom, 320, single)).toEqual([]);
  });

  // What the kit's two-line cap (`layout.padHistoryLines`, still the other sports' rule) would have cut in a History row.
  // Cricket's rows have no cap, so none of these is cut; the list says what the wrapping is doing. The toss with a club of
  // thirty characters: at 320 the English and Spanish sentences run to a third line (the row gives 192 dp beside the
  // score). Spanish and English are the owner's words and are not shortened here; French and Dutch were (Task 18).
  it('a History row would have cut, under the kit’s two-line cap, the toss at 320 and nothing else of one clause', () => {
    expect(over(layout.padHistoryLines, historyRoom, 360, single)).toEqual([]);
    expect(over(layout.padHistoryLines, historyRoom, 320, single)).toEqual([
      'en toss bat',
      'en toss bowl',
      'es toss bat',
      'es toss bowl',
    ]);
  });

  it('shows the whole club in a History row: the toss takes a third line at 320 rather than losing it', () => {
    for (const [, dictionary] of [LANGUAGES[0], LANGUAGES[1]]) {
      for (const [name, text] of sentences(dictionary, USUAL).filter(([n]) =>
        n.startsWith('toss'),
      )) {
        const lines = linesIn(text, historyRoom(320), controlWidth);
        expect(lines.length, name).toBeGreaterThan(layout.padHistoryLines);
        expect(lines.join(' '), name).toContain(THIRTY);
      }
    }
  });

  it('cuts only these ball sentences in the last-tap line: one at 360, three at 320', () => {
    expect(over(layout.padLineLines, lineRoom, 360, composite)).toEqual(['nl undone ball']);
    expect(over(layout.padLineLines, lineRoom, 320, composite)).toEqual([
      'es undone ball',
      'nl a whole ball',
      'nl undone ball',
    ]);
  });

  it('would have cut only the whole ball in a History row under the cap: two languages at 360, all four at 320', () => {
    const inHistory = (name: string) => composite(name) && IN_HISTORY(name);
    expect(over(layout.padHistoryLines, historyRoom, 360, inHistory)).toEqual([
      'es a whole ball',
      'fr a whole ball',
    ]);
    expect(over(layout.padHistoryLines, historyRoom, 320, inHistory)).toEqual([
      'en a whole ball',
      'es a whole ball',
      'fr a whole ball',
      'nl a whole ball',
    ]);
  });

  // What the ellipsis cuts is the end, and only in the last-tap line (a History row is not cut). The head of a cut ball
  // sentence is kept: "Undone" (or its word) and the extra, "5 no-balls". The dismissal is not always kept: where the kept
  // lines stop before the batter's " · " (the mark after "<batter> out") the wicket is cut too, and this pins where, so a
  // copy change that moves it is seen.
  type Cut = { readonly where: string; readonly kept: string; readonly head: string };
  const cuts = (): readonly Cut[] =>
    WIDTHS.flatMap((width) =>
      LANGUAGES.flatMap(([lang, dictionary]) =>
        sentences(dictionary, USUAL)
          .filter(([name]) => composite(name))
          .flatMap(([name, text]): Cut[] => {
            const lines = linesIn(text, lineRoom(width, dictionary), controlWidth);
            if (lines.length <= layout.padLineLines) return [];
            const undone = said(dictionary, 'scoring.cricket.last.undone').split('{what}')[0];
            const noBalls = fill(said(dictionary, 'scoring.cricket.ball.noball.other'), {
              count: 5,
            });
            return [
              {
                where: `line ${width} ${lang} ${name}`,
                kept: lines.slice(0, layout.padLineLines).join(' '),
                head: (name === 'undone ball' ? (undone ?? '') : '') + noBalls,
              },
            ];
          }),
      ),
    );

  it('keeps the head of every cut ball sentence in the last-tap line, and names where the wicket goes too', () => {
    const all = cuts();
    // One at 360 and three at 320 (the list above). A History row cuts none.
    expect(all).toHaveLength(4);
    expect(all.filter(({ kept, head }) => !kept.startsWith(head))).toEqual([]);
    expect(all.filter(({ kept }) => !kept.includes(' · ')).map(({ where }) => where)).toEqual([
      'line 320 nl undone ball',
    ]);
  });

  // Not cut at all in History: every word of every sentence (not only the one-clause ones) is no wider than the row's
  // room, so wrapping at the spaces shows the whole sentence, whatever the language, at 320 and 360. This and the
  // component's own check that the sentence carries no line limit (`HistoryCover.test.tsx`) are the two halves of it.
  it('shows every History sentence whole: no word is wider than the row’s room, whatever the name', () => {
    for (const who of [USUAL, LONGEST])
      for (const width of WIDTHS)
        for (const [lang, dictionary] of LANGUAGES)
          for (const [name, text] of sentences(dictionary, who).filter(([n]) => IN_HISTORY(n)))
            expect(
              wordsFit(text, historyRoom(width), controlWidth),
              `${lang} ${name} ${width}`,
            ).toBe(true);
  });

  it('keeps every word whole in both rooms, with the longest name as the batter and the one the sentence is about', () => {
    for (const width of WIDTHS)
      for (const [, dictionary] of LANGUAGES)
        for (const [name, text] of sentences(dictionary, LONGEST)) {
          expect(wordsFit(text, lineRoom(width, dictionary), controlWidth), name).toBe(true);
          expect(wordsFit(text, historyRoom(width), controlWidth), name).toBe(true);
        }
  });

  // T19 device run D2/D3: a pick's line (the last-tap line only; a pick is never a History row), measured as the ball
  // sentences are: three lines at most with the usual names, every word whole with the longest. The longest is the next
  // bowler and a hand swap together.
  const picksSaid = (dictionary: Dictionary, name: string): readonly string[] => {
    const at = (key: string, vars: Readonly<Record<string, string | number>>) =>
      fill(said(dictionary, key), vars);
    const bowler = at('scoring.cricket.last.bowlerChange', { name });
    const swap = at('scoring.cricket.last.swap', { name });
    return [
      swap,
      at('scoring.cricket.ball.and', { first: bowler, second: swap }),
      at('scoring.cricket.last.begin.innings', { number: 4 }),
      at('scoring.cricket.last.begin.superOver', { number: 12 }),
    ];
  };

  it.each(LANGUAGES)(
    '%s: a pick’s line holds its three lines, every word whole',
    (lang, dictionary) => {
      for (const width of WIDTHS) {
        const room = lineRoom(width, dictionary);
        for (const text of picksSaid(dictionary, USUAL.person))
          expect(linesOf(text, room, controlWidth), `${lang} ${width} ${text}`).toBeLessThanOrEqual(
            layout.padLineLines,
          );
        for (const text of picksSaid(dictionary, PERSON))
          expect(wordsFit(text, room, controlWidth), `${lang} ${width} ${text}`).toBe(true);
      }
      // Anti-vacuity: the joined line wraps at 320, so the cap is measured.
      const joined = picksSaid(dictionary, USUAL.person)[1] ?? '';
      expect(linesOf(joined, lineRoom(320, dictionary), controlWidth)).toBeGreaterThan(1);
    },
  );

  // Anti-vacuity: the whole ball is long enough to take more than one line at 320, so the limits above are measured.
  it('the whole ball takes more than one line at 320', () => {
    const [, ball] = sentences(en, USUAL).find(([name]) => name === 'a whole ball') ?? ['', ''];
    expect(linesOf(ball, historyRoom(320), controlWidth)).toBeGreaterThan(1);
  });

  it.each(LANGUAGES)(
    '%s: the heading Before play is one line in the column, in caps',
    (_, dictionary) => {
      const heading = said(dictionary, 'scoring.cricket.history.before');
      for (const width of WIDTHS)
        expect(linesOf(heading, column(width), capsOf('state')), heading).toBe(1);
    },
  );
});

// The result in the strip (`PadStripItem.lines`, Task 18): two lines of `metricUnit` in the whole column, so a club's
// whole name wraps rather than being cut (T16 concern 2). Every wording, in the singular as well, with a thirty-character
// club and the widest figures.
describe.each(WIDTHS)('the result and the break’s lines at %i dp', (width) => {
  const SINGULAR_RESULTS = ['runs.one', 'wickets.one', 'innings_and_runs.one'].map(
    (key) => `scoring.cricket.result.${key}`,
  );

  it.each(LANGUAGES)(
    '%s: every result takes two lines at most with a thirty-character club',
    (_, dictionary) => {
      for (const key of [...RESULT_KEYS, ...SINGULAR_RESULTS]) {
        const words = fill(said(dictionary, key), { name: THIRTY, count: CHASE.runs });
        expect(wordsFit(words, column(width), unitWidth), words).toBe(true);
        expect(linesOf(words, column(width), unitWidth), words).toBeLessThanOrEqual(2);
      }
    },
  );

  // The break's line: the closed innings and what the next needs, the lead or level scores, in `body`, no line limit.
  it.each(LANGUAGES)('%s: the other break lines keep every word whole', (_, dictionary) => {
    for (const key of [
      'scoring.cricket.break.chase.one',
      'scoring.cricket.break.need',
      'scoring.cricket.break.lead.one',
      'scoring.cricket.break.lead.other',
      'scoring.cricket.break.level',
      'scoring.cricket.board.chase.one',
    ]) {
      const words = fill(said(dictionary, key), {
        team: THIRTY,
        target: 999,
        count: 120,
        runs: 999,
      });
      expect(wordsFit(words, column(width), bodyOf), words).toBe(true);
    }
  });
});

// The scorecard under Match details (`CricketScorecard`): an innings' title and total, a batter's name and how out beside
// the figures, who has not batted, the extras, the bowling, the fall of wickets. Rooms as the component sets them: the
// sheet's text (the screen less `space.md` a side), a row's name column less the figures and a gap.
describe.each(WIDTHS)('the scorecard at %i dp', (width) => {
  const BAT = '199 (120)';
  /** A row's name column: the sheet's text less the figures (never cut) and the gap. */
  const nameColumn = (figures: string) => column(width) - figuresWidth(figures) - space.md;

  it.each(LANGUAGES)(
    '%s: title and total keep their words whole, the total in two lines',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.history.innings', 'scoring.cricket.history.superOver']) {
        const title = fill(said(dictionary, key), { number: 12, side: THIRTY });
        expect(wordsFit(title, column(width), labelWidth), title).toBe(true);
      }
      for (const key of ['total', 'declared']) {
        const total = fill(said(dictionary, `scoring.cricket.card.${key}`), {
          runs: 999,
          wickets: 10,
          overs: OVERS,
        });
        expect(wordsFit(total, column(width), figuresWidth), total).toBe(true);
        expect(linesOf(total, column(width), figuresWidth), total).toBeLessThanOrEqual(2);
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: how a batter is out keeps every word whole beside the figures, four lines at most',
    (_, dictionary) => {
      const how = said(dictionary, 'scoring.cricket.out.kind.hitballtwice');
      const fielders = fill(said(dictionary, 'scoring.cricket.out.fielders'), {
        how,
        assist: PERSON,
        fielder: PERSON,
      });
      const hows = [
        said(dictionary, 'scoring.cricket.card.notOut'),
        said(dictionary, 'scoring.cricket.card.out'),
        fill(said(dictionary, 'scoring.cricket.card.bowledBy'), { how: fielders, bowler: PERSON }),
      ];
      for (const text of hows) {
        expect(wordsFit(text, nameColumn(BAT), statusOf), text).toBe(true);
        expect(linesOf(text, nameColumn(BAT), statusOf), text).toBeLessThanOrEqual(4);
      }
      const score = fill(said(dictionary, 'scoring.cricket.card.score'), { runs: 199, balls: 120 });
      expect(figuresWidth(score), score).toBeLessThanOrEqual(figuresWidth(BAT));
    },
  );

  // A name is a `NameText`: one with gaps wraps at them, one without is one line, shrunk to `nameFloor` and cut beyond.
  it('a batter’s name keeps room for its first word beside the figures, a bowler’s beside the spell', () => {
    expect(nameColumn(BAT)).toBeGreaterThanOrEqual(
      bodyOf('Wolstenholme-Fitzgerald') * layout.nameFloor,
    );
    expect(nameColumn(SPELL)).toBeGreaterThanOrEqual(bodyOf('Fitzgerald'));
  });

  it.each(LANGUAGES)(
    '%s: the notes and the fall of wickets keep every word whole in the sheet’s column',
    (_, dictionary) => {
      const texts = [
        fill(said(dictionary, 'scoring.cricket.card.didNotBat'), {
          names: [PERSON, PERSON, PERSON].join(', '),
        }),
        fill(said(dictionary, 'scoring.cricket.card.extras'), {
          total: 999,
          wides: 99,
          noBalls: 99,
          byes: 99,
          legByes: 99,
        }),
        fill(said(dictionary, 'scoring.cricket.card.extrasPen'), {
          total: 999,
          wides: 99,
          noBalls: 99,
          byes: 99,
          legByes: 99,
          penalties: 25,
        }),
        fill(said(dictionary, 'scoring.cricket.card.fall'), {
          wicket: 10,
          runs: 999,
          batter: PERSON,
          over: OVERS,
        }),
      ];
      for (const text of texts) expect(wordsFit(text, column(width), bodyOf), text).toBe(true);
    },
  );

  it.each(LANGUAGES)('%s: the section heading is one line in caps', (_, dictionary) => {
    const title = said(dictionary, 'scoring.cricket.card.fallTitle');
    expect(linesOf(title, column(width), capsOf('state')), title).toBe(1);
  });
});

// The sweep (plan Task 18): every `scoring.cricket.` key in the dictionary has been read by a fit case above (`said` is the
// one reader, and the fit tests take a key's text only through it). A key added to the dictionaries without a fit case is
// a red test, listed by name. It runs last and relies on the file's order, so a run filtered by name (`-t`) fails it: run
// the file whole.
const CRICKET_PREFIX = 'scoring.cricket.';

/** The keys no fit case read. An empty dictionary is a failure, not an empty answer: a sweep of nothing proves nothing. */
function unmeasured(keys: readonly string[], read: ReadonlySet<string>): readonly string[] {
  if (keys.length === 0) throw new Error(`no ${CRICKET_PREFIX} keys to sweep`);
  return keys.filter((key) => !read.has(key));
}

describe('the sweep', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith(CRICKET_PREFIX));

  it('every scoring.cricket key has a fit case', () => {
    expect(keys.length).toBeGreaterThan(250);
    expect(unmeasured(keys, swept)).toEqual([]);
    expect(keys.filter((key) => swept.has(key))).toHaveLength(keys.length);
  });

  it.each(LANGUAGES)('%s has every cricket key English has, and none it lacks', (_, dictionary) => {
    const own = Object.keys(dictionary).filter((key) => key.startsWith(CRICKET_PREFIX));
    expect([...own].sort()).toEqual([...keys].sort());
  });

  it('a sweep of no keys is a failure, and one with a key unread names it', () => {
    expect(() => unmeasured([], new Set(['scoring.cricket.a']))).toThrow();
    expect(
      unmeasured(['scoring.cricket.a', 'scoring.cricket.b'], new Set(['scoring.cricket.a'])),
    ).toEqual(['scoring.cricket.b']);
  });
});
