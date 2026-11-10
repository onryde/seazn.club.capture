import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { isOneWord } from '@/ui/components/nameFit';
import { typeScale } from '@/ui/theme/type';
import {
  BOARD_RUNGS,
  boardNeeds,
  chipsShown,
  chipsPerRow,
  fitBoard,
  stripHeight,
  type BoardFit,
} from '@/ui/screens/cricketBoardFit';
import { linesIn, linesOf } from '../../../test/textFit';
import en from '@/i18n/en.json';
import {
  BATTER,
  CHASE,
  LANGUAGES,
  LONG_NAME,
  OVERS,
  SCORE,
  SPELL,
  TEAM_LONGEST,
  TEAM_TWELVE,
  WIDEST_OVERS,
  WIDTHS,
  barlow700,
  column,
  controlWidth,
  cricketKeys,
  figuresWidth,
  fill,
  labelWidth,
  nameRoom,
  ownsKey,
  reader,
  scoreWidth,
  unitWidth,
  unmeasured,
} from './cricketFitKit';

// S2-4 fit tests, the board: what the cricket board draws fits at 320 and 360 dp in four languages (the pattern of padFit.test.ts,
// rooms copied from the token and type declarations and the board's styles, never read from the components), the toss and
// setup under it, the result summary and the height budget. Whether real text stays inside on a phone is the device check's.

const { said, swept } = reader();

describe.each(WIDTHS)('the cricket board at %i dp', (width) => {
  it.each(LANGUAGES)(
    'the score line holds the longest score and its overs: %s',
    (_, dictionary) => {
      const overs = fill(said(dictionary, 'scoring.cricket.board.overs'), { overs: OVERS });
      expect(labelWidth(overs)).toBeLessThanOrEqual(layout.boardOvers);
      expect(scoreWidth(SCORE) + space.sm + layout.boardOvers).toBeLessThanOrEqual(column(width));
    },
  );

  it.each(LANGUAGES)(
    'the innings line holds its words and number, with no side’s name (it heads the score now): %s',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.board.innings', 'scoring.cricket.board.superOver']) {
        const line = fill(said(dictionary, key), { number: 12 });
        expect(controlWidth(line), key).toBeLessThanOrEqual(column(width));
      }
    },
  );

  // T19 fix 5: the batting team's name heads the score, one line in `label` that shrinks to the floor, then is cut.
  it('the team line holds a twelve-character name at full size and the first word of the longest at the floor', () => {
    expect(labelWidth(TEAM_TWELVE)).toBeLessThanOrEqual(column(width));
    expect(labelWidth(TEAM_LONGEST) * layout.boardTeamMinScale).toBeGreaterThan(
      labelWidth('Southern'),
    );
    expect(labelWidth('Association') * layout.boardTeamMinScale).toBeLessThanOrEqual(column(width));
  });

  it('the longest fixture name just fits the column at full size, and a name up to 1.4 times wider fits at the floor', () => {
    expect(labelWidth(TEAM_LONGEST)).toBeLessThanOrEqual(column(320));
    expect(column(320) - labelWidth(TEAM_LONGEST)).toBeLessThan(2);
    expect(1.4 * labelWidth(TEAM_LONGEST) * layout.boardTeamMinScale).toBeLessThanOrEqual(
      column(320),
    );
  });

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

  // T19 fix 8: six chips (6 x 40 + 5 x 4 = 260) fit one row at every width; an over of ten shows its last six there.
  it('six chips fit the column on one row, and an over of ten shows its last six', () => {
    expect(chipsShown(6, column(width), false)).toBe(6);
    expect(chipsShown(10, column(width), false)).toBe(6);
    expect(6 * layout.overChip + 5 * space.xs).toBeLessThanOrEqual(column(width));
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

// T19 device run D1: the overs' box is a fixed width (CricketBoard's `overs`), so a whole over's shorter text is never
// laid out in a box measured a hair short of it on the phone. It holds the widest overs in every language, with no
// more than 2 dp to spare, so the box is the widest text's and not a guess.
describe('the over’s label when the strip shows only its last balls', () => {
  it.each(LANGUAGES)('is one line in the column at every width: %s', (_, dictionary) => {
    const label = fill(said(dictionary, 'scoring.cricket.board.overLast'), {
      number: 50,
      shown: 6,
      total: 12,
    });
    for (const width of WIDTHS) expect(unitWidth(label), label).toBeLessThanOrEqual(column(width));
  });
});

describe('the overs’ box', () => {
  it.each(LANGUAGES)(
    'holds three digits of overs at the widest digit, and is that wide: %s',
    (_, dictionary) => {
      const widest = labelWidth(
        fill(said(dictionary, 'scoring.cricket.board.overs'), { overs: WIDEST_OVERS }),
      );
      expect(widest).toBeLessThanOrEqual(layout.boardOvers);
      expect(layout.boardOvers - widest).toBeLessThan(2);
    },
  );
});

describe('a chip', () => {
  // T19 fix 5, Part 5: a 40 dp box, its word in `metricValue` (Geist Mono 16). Every delivery's word fits with the padding a
  // side; the strip is the label, a gap and one row of boxes.
  it('holds the widest delivery a chip can say, with room each side', () => {
    for (const text of ['7nb', '11p', '5wd', '4lb', 'W', '·']) {
      expect(figuresWidth(text), text).toBeLessThanOrEqual(layout.overChip - 2 * space.xs);
    }
  });

  it('is 40 dp and a row of them wraps at the board’s width: 6 a row at 320, 7 at 360', () => {
    expect(layout.overChip).toBe(40);
    expect(chipsPerRow(column(320))).toBe(6);
    expect(chipsPerRow(column(360))).toBe(7);
    // The seventh delivery of an over (a wide, then the sixth ball) is cut to the last six at 320 and not at 360.
    expect([chipsShown(7, column(320), false), chipsShown(7, column(360), false)]).toEqual([6, 7]);
    // A result's board has no keys, so its chips wrap: twelve at 320 are two rows.
    expect(chipsShown(12, column(320), true)).toBe(12);
  });
});

describe('the board’s regions', () => {
  it('the score panel holds the team line, the score, the innings line and the chase line', () => {
    expect(
      typeScale.label.lineHeight +
        typeScale.scoreCompact.lineHeight +
        2 * typeScale.control.lineHeight +
        2 * space.xs,
    ).toBeLessThanOrEqual(layout.scorePanel);
  });

  it('the result panel holds two rows of a crease row’s height', () => {
    expect(2 * layout.creaseRow + space.xs).toBeLessThanOrEqual(layout.resultPanel);
  });

  it('a crease row holds a line of names and of figures', () => {
    expect(typeScale.label.lineHeight).toBeLessThanOrEqual(layout.creaseRow);
    expect(typeScale.metricValue.lineHeight).toBeLessThanOrEqual(layout.creaseRow);
  });

  it('the over strip is its label, a gap and one row of chips; a wrapped over adds a row and its gap', () => {
    expect(typeScale.metricUnit.lineHeight + space.xs + layout.overChip).toBe(layout.overStrip);
    expect(layout.overChip).toBeGreaterThanOrEqual(typeScale.metricValue.lineHeight);
    expect(stripHeight(2)).toBe(layout.overStrip + layout.overChip + space.xs);
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

// ---------------------------------------------------------------------------------------------------------------
// T19 fix 5, Part 3: the board's height budget. The keys' block is fixed at the bottom and the board above it never
// overlaps it (device run 11: at 320 dp the bowler row and the chips were drawn over the 0/1/2 keys). What is left for the
// board is the screen's height less the frame, the keys and the last-tap line (the arithmetic of the owner's-phone test
// above, 446 dp); when the board's lines need more they give way in the ruling's order and only as far as they must:
// the gaps tighten, the chip strip hides, the chase joins the innings line. Never the score, the team line or the crease.
// ---------------------------------------------------------------------------------------------------------------
/**
 * The pad's own height round the board (arithmetic from the tokens: that it is the real layout's is the device check's;
 * heights do not vary with the language, the last-tap line being fixed at `padLineLines`, so the table has no language
 * column, and the break card stands in the board's place, so it has no row):
 */
/** The pad's own height round the board: padding, header, strip, a gap, the keys, the last-tap line and four gaps. */
const AROUND_THE_BOARD =
  2 * space.md +
  layout.touch +
  typeScale.metricUnit.lineHeight +
  space.sm +
  (2 * layout.cricketRunKey + layout.cricketExtraKey + layout.cricketActionKey + 3 * space.sm) +
  layout.padLineLines * typeScale.control.lineHeight +
  4 * space.sm;

/** The rung a size takes (T19 fix 6 order): 0 as designed, 1 gaps tight, 2 chase joined, 3 no strip, 4 compact score. */
const RUNG_AT: readonly (readonly [number, number, number])[] = [
  [320, 568, 4],
  [320, 626, 4],
  [320, 640, 3],
  [360, 640, 3],
  [360, 724, 1],
];

describe('the board’s height budget', () => {
  it('the frame, the keys and the last-tap line take 446 dp round the board', () => {
    expect(AROUND_THE_BOARD).toBe(446);
  });

  it.each(RUNG_AT)(
    '%i × %i dp takes rung %i of the ruling’s order with a six-ball over',
    (width, height, rung) => {
      const fit = fitBoard(height - AROUND_THE_BOARD);
      expect(BOARD_RUNGS.indexOf(fit)).toBe(rung);
    },
  );

  it('where a rung fits, the board and everything round it is within the height', () => {
    for (const [width, height, rung] of RUNG_AT) {
      const needs = boardNeeds(BOARD_RUNGS[rung] as BoardFit, 1);
      const room = height - AROUND_THE_BOARD;
      // 320 × 568: even the last rung asks 49 more than the room (it is clipped, never over the keys).
      if (height === 568) expect(needs - room).toBe(49);
      else expect(needs).toBeLessThanOrEqual(room);
    }
  });

  // T19 fix 8: the strip is one row whatever the over (an over of ten shows its last six), so it never hides for chips.
  it('the rung does not depend on how many deliveries the over has: 360 × 724 takes rung 1 for six or ten', () => {
    const room = 724 - AROUND_THE_BOARD;
    expect(BOARD_RUNGS.indexOf(fitBoard(room))).toBe(1);
  });

  it('a roomy phone keeps the board as designed, and an unmeasured board is drawn as designed', () => {
    expect(BOARD_RUNGS.indexOf(fitBoard(800 - AROUND_THE_BOARD))).toBe(0);
    expect(BOARD_RUNGS.indexOf(fitBoard(null))).toBe(0);
  });

  it('a free hit due is counted (a line of 16 and a gap) and never dropped: it can take the strip at 360 × 724', () => {
    const room = 724 - AROUND_THE_BOARD;
    // 255 + 16 + 4 = 275 for the joined rung with its strip: 278 keeps the strip, 274 loses it.
    expect(BOARD_RUNGS.indexOf(fitBoard(room, false, true))).toBe(2);
    expect(BOARD_RUNGS.indexOf(fitBoard(274, false, true))).toBe(3);
    expect(boardNeeds(BOARD_RUNGS[3] as BoardFit, 1, undefined, true)).toBe(191 + 16 + 4);
    expect(boardNeeds(BOARD_RUNGS[4] as BoardFit, 1, undefined, true)).toBe(171 + 16 + 4);
  });

  it('a result’s board is not given way: no keys stand under it', () => {
    expect(BOARD_RUNGS.indexOf(fitBoard(50, true))).toBe(0);
  });

  it('the rungs only ever ask for less, so the first that fits is the one that gives way least', () => {
    const asks = BOARD_RUNGS.map((fit) => boardNeeds(fit, 1));
    expect(asks).toEqual([285, 277, 255, 191, 171]);
  });

  describe.each(LANGUAGES)('%s, with the long names', (_, dictionary) => {
    it.each(WIDTHS)('the joined innings and chase line holds at the floor at %i dp', (width) => {
      const innings = fill(said(dictionary, 'scoring.cricket.board.superOver'), { number: 12 });
      const chase = fill(said(dictionary, 'scoring.cricket.board.chase.other'), CHASE);
      expect(
        controlWidth(fill(said(dictionary, 'scoring.cricket.board.joined'), { innings, chase })) *
          layout.boardTeamMinScale,
      ).toBeLessThanOrEqual(column(width));
    });

    it.each(WIDTHS)('the team line and a bowler’s first word fit at %i dp', (width) => {
      expect(labelWidth(TEAM_LONGEST) * layout.boardTeamMinScale).toBeLessThanOrEqual(
        column(width),
      );
      expect(nameRoom(width, SPELL)).toBeGreaterThanOrEqual(labelWidth('Christopher'));
      expect(said(dictionary, 'scoring.cricket.board.over')).not.toBe('');
    });
  });
});

// T19 fixes 10 and 11: a result's summary rows. A row is the tag (metricUnit, never shrinks), the name (label, one line) and
// the figures (metricValue), `space.xs` apart in the column; the room the name keeps must still hold a first word, and the
// extras line is one line of metricUnit. Measured at the worst figures a result shows.
describe.each(WIDTHS)('the result summary at %i dp', (width) => {
  const TOP = '199 (120)';
  const BEST = '10-120 (35.4)';
  const room = (tag: string, figures: string) =>
    column(width) - unitWidth(tag) - 2 * space.xs - figuresWidth(figures);

  it.each(LANGUAGES)('the top bat row keeps room for a name: %s', (_, dictionary) => {
    const tag = said(dictionary, 'scoring.cricket.board.summary.top');
    expect(room(tag, TOP), tag).toBeGreaterThanOrEqual(labelWidth('Christopher'));
  });

  it.each(LANGUAGES)('the best bowl row keeps room for a name: %s', (_, dictionary) => {
    const tag = said(dictionary, 'scoring.cricket.board.summary.best');
    expect(room(tag, BEST), tag).toBeGreaterThanOrEqual(labelWidth('Christopher'));
  });

  it.each(LANGUAGES)('all-zero extras are one line: %s', (_, dictionary) => {
    const line = fill(said(dictionary, 'scoring.cricket.board.summary.extrasNone'), {
      total: 0,
    });
    expect(unitWidth(line), line).toBeLessThanOrEqual(column(width));
  });
});

// The sweep (plan Task 18): every key this file owns (`OWNED.board` in the kit) was read by a fit case above, through `said`.
// A key added to the dictionaries with no fit case is a red test, listed by name. It runs last and relies on the file's
// order, so a run filtered by name (`-t`) fails it: run the file whole.
describe('the sweep', () => {
  it('every scoring.cricket key this file owns has a fit case', () => {
    const owned = cricketKeys().filter((key) => ownsKey('board', key));
    expect(owned.length).toBeGreaterThan(0);
    expect(unmeasured(owned, swept)).toEqual([]);
  });
});
