import { describe, expect, it } from 'vitest';
import { cricketPad } from '@/domain/scoring/cricketPad';
import { cricketSport } from '@/domain/scoring/cricketSport';
import type { CricketTap } from '@/domain/scoring/cricketTypes';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import { sportFor } from '@/domain/scoring/sports';
import { translatePad } from '@/i18n/padText';
import type { Bootstrap } from '@/domain/scoring/wire';
import { createTranslator } from '@/i18n/translate';
import {
  ALL_OUT_FIRST,
  AWAY_BOWLERS,
  FIRST_INNINGS_8,
  HOME_BOWLERS,
  MATCH,
  ONE,
  OPENING,
  OUT,
  OVER_ONE_DONE,
  TIED_KO,
  TWO_INNINGS,
  ball,
  declare,
  eventId,
  inningsOf,
  ledgerOf,
  player,
  retire,
  summary,
  times,
  toss,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// Cricket as the match runtime scores it (S2-4 plan Task 7): the sport's table row, its stages as the runtime asks them,
// Home's result line and the pad's halves. Every expected value is written out from the spec, never read from the fold.

/** A status line's words in a language, or null for a line with none (T19 D13: a break's line has no words). */
const wordsIn = (
  translator: ReturnType<typeof createTranslator>,
  text: Parameters<typeof translatePad>[1] | null,
) => (text === null ? null : translatePad(translator, text));

function displayOf(
  specs: readonly Spec[],
  own: readonly number[] = [],
  picks: PendingPicks = NO_PICKS,
  bootstrap: Bootstrap = MATCH,
) {
  const folded = cricketSport.fold({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: own.map(eventId),
    toss: null,
    picks,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

/** The home side all out for 1, then the away side's two singles off the first two balls: away wins by 10 wickets. */
const DECIDED: readonly Spec[] = [...ALL_OUT_FIRST, ...inningsOf('A', HOME_BOWLERS, [ONE, ONE])];

const en = createTranslator('en');

/** A single off ball `ballInOver` of the first over, the openers in, `A-p11` bowling. */
const single = (ballInOver: number) =>
  ball({
    over: 0,
    ballInOver,
    striker: player('H', 1),
    nonStriker: player('H', 2),
    bowler: player('A', 11),
    bat: 1,
  });

/** The single as its tap. */
const ONE_RUN = { bat: 1, extra: null, boundary: null, wicket: null } as const;

describe('cricketSport', () => {
  it('sportFor(cricket) is the module', () => {
    expect(sportFor('cricket')).toBe(cricketSport);
    expect(cricketSport.key).toBe('cricket');
  });

  it('notStarted at setup and at the toss; not after Start', () => {
    expect(cricketSport.notStarted(displayOf([]))).toBe(true);
    expect(cricketSport.notStarted(displayOf([toss('H', 'bat')]))).toBe(true);
    expect(cricketSport.notStarted(displayOf(OPENING))).toBe(false);
    expect(cricketSport.notStarted(displayOf(OVER_ONE_DONE))).toBe(false);
  });

  it('a live match is not decided: an innings under way, a break, a super over due', () => {
    expect(cricketSport.decided(displayOf([]))).toBe(false);
    expect(cricketSport.decided(displayOf(OVER_ONE_DONE))).toBe(false);
    expect(cricketSport.decided(displayOf(FIRST_INNINGS_8))).toBe(false);
    expect(cricketSport.decided(displayOf(TIED_KO))).toBe(false);
    expect(cricketSport.decided(displayOf(DECIDED))).toBe(true);
  });

  it('the result line is each innings’ runs/wickets, joined: numbers only', () => {
    expect(cricketSport.resultLine(displayOf(DECIDED))).toBe('1/10 · 2/0');
    expect(cricketSport.resultLine(displayOf(TIED_KO))).toBe('8/0 · 8/0');
    expect(cricketSport.resultLine(displayOf(OPENING))).toBe('');
  });

  it('holds no serve pick, waits on no ending, and refuses a tap as not now', () => {
    expect(cricketSport.tossOf({ kind: 'start' })).toBeNull();
    expect(cricketSport.tossOf({ kind: 'toss', wonBy: 'first', elected: 'bat' })).toBeNull();
    expect(cricketSport.awaitingEnding(displayOf(OVER_ONE_DONE))).toBe(false);
    expect(cricketSport.refusalFor({ kind: 'start' })).toBe('notNow');
  });

  it('Undo names the last tap, and shows it taken back; the toss and the start are never named', () => {
    const display = displayOf([...OPENING, single(1)], [3]);
    const tap: CricketTap = { kind: 'ball', ball: ONE_RUN };
    expect(cricketSport.undoneOf(display)).toStrictEqual(tap);
    expect(cricketSport.undoneOf(displayOf(OPENING, [1, 2]))).toBeNull();
    const shown = cricketSport.showUndone(display, { kind: 'ball', ball: tap.ball });
    expect(shown.lastTap).toStrictEqual({ kind: 'undone', tap });
    expect(cricketSport.undoneOf(shown)).toBeNull();
  });
});

describe('cricketPad', () => {
  // T20 fix 12: the result is the card's title, and no other fact comes and goes above the board, so there is no strip.
  it('has no strip, in play and decided', () => {
    expect(cricketPad(displayOf(OVER_ONE_DONE)).strip).toEqual([]);
    expect(cricketPad(displayOf(ALL_OUT_FIRST)).strip).toEqual([]);
  });

  it('the halves carry the side names, with no tap; the side batting is lit', () => {
    const view = cricketPad(displayOf(OVER_ONE_DONE));
    expect(
      view.halves.map((half) => [half.label, half.value, half.bar, half.tappable]),
    ).toStrictEqual([
      ['Home CC', '6/0', 'lit', false],
      ['Away CC', '', 'dim', false],
    ]);
    expect(view.start).toBeNull();
    expect(view.tools).toStrictEqual([]);
    expect(view.card).toBeNull();
  });

  it('the last tap in words, with Undo while this phone’s own tap stands', () => {
    const own = cricketPad(displayOf([...OPENING, single(1)], [3])).lastTap;
    expect(own === null ? null : [wordsIn(en, own.text), own.undo]).toStrictEqual(['1 run', true]);
    const theirs = cricketPad(displayOf([...OPENING, single(1)])).lastTap;
    expect(theirs === null ? null : [wordsIn(en, theirs.text), theirs.undo]).toStrictEqual([
      '1 run',
      false,
    ]);
  });

  // T19 D8 (the controller's ruling, 2026-11-09): Undo chains through this phone's own consecutive balls, one at a
  // time, like every other sport's pad. The line after an Undo names what was undone, and its Undo follows the display:
  // lit while the current last ledger event is this phone's own ball, dim when it is not.
  describe('Undo chains through this phone’s own balls (T19 D8)', () => {
    const lineAt = (display: ReturnType<typeof displayOf>) => {
      const line = cricketPad(display).lastTap;
      return line === null ? null : [wordsIn(en, line.text), line.undo];
    };

    it('a tap Undo took back is said as undone, and a first own ball under it keeps Undo lit', () => {
      // ev-3 and ev-4 are this phone's balls, ev-5 its void of ev-4: ball 1 is the last ball standing.
      const voided = displayOf([...OPENING, single(1), single(2), voiding(4)], [3, 4, 5]);
      expect(lineAt(voided)).toStrictEqual(['Undone — 1 run', true]);
    });

    it('the second Undo has a ball to take back, and after it nothing of this phone’s stands: dim', () => {
      const bothVoided = displayOf(
        [...OPENING, single(1), single(2), voiding(4), voiding(3)],
        [3, 4, 5, 6],
      );
      expect(lineAt(bothVoided)).toStrictEqual(['Undone — 1 run', false]);
    });

    it('a tap Undo just took back while a first own ball stands keeps Undo lit through the runtime’s own line', () => {
      const display = displayOf([...OPENING, single(1)], [3]);
      const shown = cricketSport.showUndone(display, { kind: 'ball', ball: ONE_RUN });
      expect(lineAt(shown)).toStrictEqual(['Undone — 1 run', true]);
    });

    it('nothing of this phone’s under an Undo (the console’s balls only): dim', () => {
      const display = displayOf([...OPENING, single(1), single(2), voiding(4)], [5]);
      expect(lineAt(display)).toStrictEqual(['Undone — 1 run', false]);
    });

    it('an own ball with another scorer’s ball after it: Undo is dim, the ball is the organiser’s', () => {
      expect(lineAt(displayOf([...OPENING, single(1), single(2)], [3]))).toStrictEqual([
        '1 run',
        false,
      ]);
    });

    // DECIDED is 15 events: the toss, the start, eleven balls of the home innings, then the away side's two singles
    // (ev-14 and ev-15). This phone scored the deciding ball; the organiser's finalize (ev-16) closes the ledger over
    // it.
    it('after the organiser finalizes, the deciding ball under it is out of reach too', () => {
      const finalized: Spec = { type: 'core.finalize', payload: {} };
      expect(lineAt(displayOf(DECIDED, [15]))).toStrictEqual(['1 run', true]);
      expect(lineAt(displayOf([...DECIDED, finalized], [15]))).toStrictEqual(['1 run', false]);
    });
  });

  it('a screen reader hears the innings now, or that there is no score yet', () => {
    expect(translatePad(en, cricketPad(displayOf(OVER_ONE_DONE)).tally.said)).toBe('Score: 6/0');
    expect(translatePad(en, cricketPad(displayOf([])).tally.said)).toBe('No score yet');
  });

  it('a decided match: the result in words is the recorded card’s title, and the strip says nothing of it', () => {
    const view = cricketPad(displayOf(DECIDED));
    expect(view.strip).toStrictEqual([]);
    expect(view.card).toStrictEqual({
      kind: 'resultRecorded',
      undoLeft: null,
      title: { key: 'scoring.cricket.result.wickets.other', count: 10, vars: { name: 'Away CC' } },
    });
    expect(cricketPad(displayOf(TIED_KO)).strip).toStrictEqual([]);
  });

  it('Match details carry the rules of the format', () => {
    const rules = cricketPad(displayOf(OPENING)).details.rules;
    expect(rules.map((row) => translatePad(en, row.value))).toStrictEqual([
      '2 an innings',
      '6 balls',
      '11 a side',
      'Up to 1 over',
      'On',
    ]);
  });
});

// T19 device run D2/D3: a pick records nothing until the next ball carries it, so the line said the tap before it (the
// leg-bye after a hand swap, "Dot ball" after the next over's bowler, innings 1's last wicket once innings 2 had
// begun). The line now says the pick. Expected words are the dictionary's English, written out.
describe('the last-tap line says a pick made since the last tap', () => {
  const lineOf = (display: ReturnType<typeof displayOf>) => {
    const line = cricketPad(display).lastTap;
    return line === null ? null : [wordsIn(en, line.text), line.undo];
  };
  /** Innings 2's openers and first bowler (the home side bowls): what Start innings waits on. */
  const SECOND_SET = {
    'openers.i2': [player('A', 1), player('A', 2)],
    'bowler.i2.0': [player('H', 11)],
  };
  const rain: Spec = { type: 'cricket.interruption', payload: { kind: 'rain' } };

  it('the next over’s bowler, picked after the over’s last ball', () => {
    const picks = { 'bowler.i1.1': [player('A', 10)] };
    expect(lineOf(displayOf(OVER_ONE_DONE, [8], picks))).toStrictEqual([
      'New bowler: Away Player 10',
      true,
    ]);
    // Not picked yet: the ball's own words.
    expect(lineOf(displayOf(OVER_ONE_DONE, [8]))).toStrictEqual(['1 run', true]);
  });

  it('a hand swap after a ball names who is on strike; a second swap names the other', () => {
    // After the single the batters crossed: Home Player 2 faces, so the swap puts Home Player 1 on strike.
    const once = { 'swap.i1.1': [player('H', 1), player('H', 2)] };
    expect(lineOf(displayOf([...OPENING, single(1)], [], once))).toStrictEqual([
      'Strike swapped: Home Player 1 on strike',
      false,
    ]);
    const twice = { 'swap.i1.1': [player('H', 2), player('H', 1)] };
    expect(lineOf(displayOf([...OPENING, single(1)], [], twice))).toStrictEqual([
      'Strike swapped: Home Player 2 on strike',
      false,
    ]);
  });

  it('at an over’s end with both picked, the line says both: the bowler, then who is on strike', () => {
    // The over's sixth single and the change of ends leave Home Player 2 on strike; the swap puts Home Player 1 there.
    const picks = {
      'bowler.i1.1': [player('A', 10)],
      'swap.i1.6': [player('H', 1), player('H', 2)],
    };
    expect(lineOf(displayOf(OVER_ONE_DONE, [], picks))).toStrictEqual([
      'New bowler: Away Player 10, Strike swapped: Home Player 1 on strike',
      false,
    ]);
  });

  it('the over’s bowler, once the over is under way, is the ball’s, not a pick: the ball’s words', () => {
    const second = ball({
      over: 1,
      ballInOver: 1,
      striker: player('H', 2),
      nonStriker: player('H', 1),
      bowler: player('A', 10),
    });
    const picks = { 'bowler.i1.1': [player('A', 10)] };
    expect(lineOf(displayOf([...OVER_ONE_DONE, second], [], picks))).toStrictEqual([
      'Dot ball',
      false,
    ]);
  });

  // T19 D13 (device run 6): before Start innings the break stands, and the closing ball's words are stale there: no words.
  it('Start innings after the innings before closed: "Innings 2 started"; before it, no words', () => {
    const begun = { ...SECOND_SET, 'begin.i2': ['second'] };
    expect(lineOf(displayOf(FIRST_INNINGS_8, [], begun))).toStrictEqual([
      'Innings 2 started',
      false,
    ]);
    expect(lineOf(displayOf(FIRST_INNINGS_8, [], SECOND_SET))).toStrictEqual([null, false]);
  });

  // Every tap that closes an innings, or sets the next (the follow-on), is older than a Start innings standing after
  // it.
  it('Start innings after over totals, a retirement that ends the innings, a close or a declaration', () => {
    const begun = { ...SECOND_SET, 'begin.i2': ['second'] };
    const totals = displayOf([...OPENING, summary(8, 0, 12)], [], begun);
    expect(lineOf(totals)).toStrictEqual(['Innings 2 started', false]);
    // Nine bowled off balls 2 to 10 leave Home Player 11 and Home Player 7 in; Home Player 7 retiring out is the tenth.
    const nine = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, ...times(9, OUT)])];
    const retired = displayOf([...nine, retire(player('H', 7), 'out')], [], begun);
    expect(lineOf(retired)).toStrictEqual(['Innings 2 started', false]);
    const close: Spec = { type: 'cricket.innings.close', payload: { reason: 'weather' } };
    const closed = displayOf([...OPENING, single(1), close], [], begun);
    expect(lineOf(closed)).toStrictEqual(['Innings 2 started', false]);
    const twoInnings = withCfg(MATCH, TWO_INNINGS);
    const declared = displayOf([...OPENING, single(1), declare()], [], begun, twoInnings);
    expect(lineOf(declared)).toStrictEqual(['Innings 2 started', false]);
  });

  it('Start innings after the follow-on enforced: "Innings 3 started"', () => {
    const followed: Spec[] = [
      ...OPENING,
      summary(300, 10, 300),
      summary(50, 10, 120),
      { type: 'cricket.followon', payload: {} },
    ];
    const picks = {
      'openers.i3': [player('A', 1), player('A', 2)],
      'bowler.i3.0': [player('H', 11)],
      'begin.i3': ['second'],
    };
    const display = displayOf(followed, [], picks, withCfg(MATCH, TWO_INNINGS));
    expect(lineOf(display)).toStrictEqual(['Innings 3 started', false]);
  });

  it('a More tap after a ball says itself over a swap that stands', () => {
    const picks = { 'swap.i1.1': [player('H', 1), player('H', 2)] };
    expect(lineOf(displayOf([...OPENING, single(1), rain], [], picks))).toStrictEqual([
      'Interruption recorded',
      false,
    ]);
  });

  it('in another language: the swap, the bowler and the start in Dutch', () => {
    const nl = createTranslator('nl');
    const said = (display: ReturnType<typeof displayOf>) => {
      const line = cricketPad(display).lastTap;
      return line === null ? null : wordsIn(nl, line.text);
    };
    const swap = { 'swap.i1.1': [player('H', 1), player('H', 2)] };
    expect(said(displayOf([...OPENING, single(1)], [], swap))).toBe('Nu aan slag: Home Player 1');
    const bowler = { 'bowler.i1.1': [player('A', 10)] };
    expect(said(displayOf(OVER_ONE_DONE, [], bowler))).toBe('Nieuwe bowler: Away Player 10');
    const begun = { ...SECOND_SET, 'begin.i2': ['second'] };
    expect(said(displayOf(FIRST_INNINGS_8, [], begun))).toBe('Innings 2 gestart');
  });

  it('Start innings of a super over: "Super over 1 started"', () => {
    const begun = {
      'openers.s1': [player('A', 1), player('A', 2)],
      'bowler.s1.0': [player('H', 11)],
      'begin.s1': ['second'],
    };
    expect(lineOf(displayOf(TIED_KO, [], begun))).toStrictEqual(['Super over 1 started', false]);
  });

  it('a tap after Start innings says itself: Rain recorded before the first ball', () => {
    const begun = { ...SECOND_SET, 'begin.i2': ['second'] };
    expect(lineOf(displayOf([...FIRST_INNINGS_8, rain], [], begun))).toStrictEqual([
      'Interruption recorded',
      false,
    ]);
  });

  it('the first innings has no Start innings line: the match’s start stays', () => {
    const picks = {
      'openers.i1': [player('H', 1), player('H', 2)],
      'bowler.i1.0': [player('A', 11)],
    };
    expect(lineOf(displayOf(OPENING, [], picks))).toStrictEqual(['Match started', false]);
  });

  it('an Undo’s line stays over a pick that stands again: a swap made before the ball Undo took back', () => {
    // Ball 2 (ev-4) is voided by ev-5: the swap picked before it stands for the next ball again, but the Undo is newer.
    const picks = { 'swap.i1.1': [player('H', 1), player('H', 2)] };
    const voided = displayOf([...OPENING, single(1), single(2), voiding(4)], [4, 5], picks);
    expect(lineOf(voided)).toStrictEqual(['Undone — 1 run', false]);
    const shown = cricketSport.showUndone(displayOf([...OPENING, single(1)], [3], picks), {
      kind: 'ball',
      ball: ONE_RUN,
    });
    // This phone's ball 1 (ev-3) still stands, so the line after the Undo keeps its Undo (T19 D8).
    expect(lineOf(shown)).toStrictEqual(['Undone — 1 run', true]);
  });
});
