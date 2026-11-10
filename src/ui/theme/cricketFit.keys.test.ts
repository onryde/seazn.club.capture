import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { linesOf } from '../../../test/textFit';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import nl from '@/i18n/nl.json';
import {
  CHASE,
  Dictionary,
  LANGUAGES,
  OVERS,
  SCORE,
  SPELL,
  THIRTY,
  TWELVE,
  WIDTHS,
  barlow600,
  barlow700,
  column,
  cricketKeys,
  fill,
  geist400,
  geist500,
  ownsKey,
  reader,
  unitWidth,
  unmeasured,
} from './cricketFit.testkit';

// S2-4 fit tests, the keys: the keys under the board, the extras and wicket sheets, the bowling step, Players, More, the innings
// break and the result. Rooms are written out from the components' styles, never read from them.

const { said, swept } = reader();

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
   * The pad's height, portrait: the screen's padding (2 × 16), the header (48), no strip (T20 fix 12: it was 16 and a gap of 8), the board (the score
   * panel with the team line, three crease rows and the over strip, `space.sm` apart: 285), the keys (two run rows, the extras, the actions,
   * `space.sm` apart: 256), the last-tap line (3 lines of 18: 54), the tool row (none: 0), and the pad's four gaps (8).
   * By hand: 32 + 48 + 285 + 8 + 256 + 54 + 24 = 707, so 724 leaves 17 (it was 731 and 7 short with the strip).
   */
  it('the board, the keys and the line fit the owner’s phone, about 360 × 724, have 17 dp to spare with the board as designed (the rung it takes is pinned below)', () => {
    const board = layout.scorePanel + 3 * layout.creaseRow + layout.overStrip + 2 * space.sm;
    const keys =
      2 * layout.cricketRunKey + layout.cricketExtraKey + layout.cricketActionKey + 3 * space.sm;
    const line = layout.padLineLines * typeScale.control.lineHeight;
    const pad = 2 * space.md + layout.touch + board + space.sm + keys + line + 3 * space.sm;
    expect([board, keys, line]).toEqual([285, 256, 54]);
    expect(724 - pad).toBe(17);
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
        'scoring.cricket.extras.byesRun',
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
 * that takes a second line. Start innings is a `Button` (`action` caps, `space.xl` a side). (The result's words moved to the recorded card's title
 * and cricket has no strip, T20 fix 12, so the old one-line-in-the-strip result test is gone.)
 */
const BREAK_TITLES = ['title', 'tied', 'superOver'].map((key) => `scoring.cricket.break.${key}`);

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
    // T19 D12 and M1: a repeated super over's tie names the next, one line like every other title, at one digit and
    // two.
    for (const number of [3, 12]) {
      const again = fill(said(dictionary, 'scoring.cricket.break.tiedAgain'), { number });
      expect(linesOf(again, column(width), capsWidth('panelTitle')), again).toBe(1);
    }
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

// The sweep (plan Task 18): every key this file owns (`OWNED.keys` in the kit) was read by a fit case above, through `said`.
// A key added to the dictionaries with no fit case is a red test, listed by name. It runs last and relies on the file's
// order, so a run filtered by name (`-t`) fails it: run the file whole.
describe('the sweep', () => {
  it('every scoring.cricket key this file owns has a fit case', () => {
    const owned = cricketKeys().filter((key) => ownsKey('keys', key));
    expect(owned.length).toBeGreaterThan(0);
    expect(unmeasured(owned, swept)).toEqual([]);
  });
});
