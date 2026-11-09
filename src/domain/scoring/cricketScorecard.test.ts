import type { BattingLine, CricketInningsCard } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { scorecardView } from '@/domain/scoring/cricketScorecard';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  ALL_OUT_FIRST,
  AWAY_BOWLERS,
  DOT,
  FOUR,
  MATCH,
  NO_AWAY_PLAYERS,
  NO_BALL,
  ONE,
  OPENING,
  OUT,
  TWO,
  WIDE,
  inningsOf,
  ledgerOf,
  player,
  summary,
  superOverOf,
  TIED_KO,
  type Spec,
} from '../../../test/cricketLedger';

// The scorecard under Match details (S2-4 spec §6; plan Task 18): each innings' batting, bowling, extras and fall of
// wickets, off the engine's `deriveCricketScorecard` through the fold. Every figure below is the scripted innings',
// written out by hand from the Laws (a wide is not a ball faced, a no-ball is; a bowler is charged the wides and
// no-balls), never read back from the fold.

function displayOf(specs: readonly Spec[], bootstrap: Bootstrap = MATCH) {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks: NO_PICKS,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

const H = (n: number) => player('H', n);

/** One delivery of the script, with its dismissal made a catch by `fielder` (the script's helpers only bowl them). */
function caught(spec: Spec, fielder: string): Spec {
  const payload = spec.payload as { wicket: Record<string, unknown> };
  return {
    ...spec,
    payload: { ...payload, wicket: { ...payload.wicket, kind: 'caught', fielder } },
  };
}

/**
 * Two overs, Home batting, Away bowling (A-p11 the first over, A-p10 the second). Over 1 (A-p11): H-p1 1, H-p2 4, a
 * wide, H-p2 caught by A-p5, H-p3 1, H-p1 dot, dot. Over 2 (A-p10): H-p3 bowled, H-p4 2, 1, H-p1 dot, a no-ball, H-p1
 * 1, H-p4 dot. 12/2 off 2.0 overs. H-p1 2 (6), H-p2 4 (2), H-p3 1 (2), H-p4 3 (3); extras 2 (a wide and a no-ball);
 * A-p11 1.0-0-7-1 (the wide is his), A-p10 1.0-0-5-1. Fall: 1-6 (H-p2, 0.3), 2-7 (H-p3, 1.1).
 */
function twoOvers(): readonly Spec[] {
  const balls = inningsOf('H', AWAY_BOWLERS, [
    ONE,
    FOUR,
    WIDE,
    OUT,
    ONE,
    DOT,
    DOT,
    OUT,
    TWO,
    ONE,
    DOT,
    NO_BALL,
    ONE,
    DOT,
  ]);
  return [...OPENING, ...balls.map((spec, i) => (i === 3 ? caught(spec, player('A', 5)) : spec))];
}

describe('the scorecard under Match details', () => {
  it('the scorecard shows fall of wickets', () => {
    const [first] = scorecardView(displayOf(twoOvers()));
    expect(first?.fall).toEqual([
      {
        key: 'scoring.cricket.card.fall',
        vars: { wicket: 1, runs: 6, batter: 'Home Player 2', over: '0.3' },
      },
      {
        key: 'scoring.cricket.card.fall',
        vars: { wicket: 2, runs: 7, batter: 'Home Player 3', over: '1.1' },
      },
    ]);
  });

  it('shows the innings as the sides played it: its title, its total, its batting in the order they came in', () => {
    const [first, second] = scorecardView(displayOf(twoOvers()));
    expect(second).toBeUndefined();
    expect(first?.title).toEqual({
      key: 'scoring.cricket.history.innings',
      vars: { number: 1, side: 'Home CC' },
    });
    expect(first?.total).toEqual({
      key: 'scoring.cricket.card.total',
      vars: { runs: 12, wickets: 2, overs: '2.0' },
    });
    expect(first?.batting.map((one) => one.name)).toEqual([
      'Home Player 1',
      'Home Player 2',
      'Home Player 3',
      'Home Player 4',
    ]);
    expect(first?.batting.map((one) => one.score)).toEqual([
      { key: 'scoring.cricket.card.score', vars: { runs: 2, balls: 6 } },
      { key: 'scoring.cricket.card.score', vars: { runs: 4, balls: 2 } },
      { key: 'scoring.cricket.card.score', vars: { runs: 1, balls: 2 } },
      { key: 'scoring.cricket.card.score', vars: { runs: 3, balls: 3 } },
    ]);
  });

  it('says how each batter is out: not out, a catch with the fielder and the bowler, bowled by the bowler', () => {
    const [first] = scorecardView(displayOf(twoOvers()));
    expect(first?.batting.map((one) => one.how)).toEqual([
      { key: 'scoring.cricket.card.notOut' },
      {
        key: 'scoring.cricket.card.bowledBy',
        vars: {
          how: {
            key: 'scoring.cricket.out.fielder',
            vars: { how: { key: 'scoring.cricket.out.kind.caught' }, fielder: 'Away Player 5' },
          },
          bowler: 'Away Player 11',
        },
      },
      {
        key: 'scoring.cricket.card.bowledBy',
        vars: { how: { key: 'scoring.cricket.out.kind.bowled' }, bowler: 'Away Player 10' },
      },
      { key: 'scoring.cricket.card.notOut' },
    ]);
  });

  it('lists who has not batted, by name, and nothing once everyone has', () => {
    const [first] = scorecardView(displayOf(twoOvers()));
    expect(first?.didNotBat).toEqual({
      key: 'scoring.cricket.card.didNotBat',
      vars: {
        names:
          'Home Player 5, Home Player 6, Home Player 7, Home Player 8, ' +
          'Home Player 9, Home Player 10, Home Player 11',
      },
    });
    // All out: the eleventh batter is in, so nobody is left.
    expect(scorecardView(displayOf(ALL_OUT_FIRST))[0]?.didNotBat).toBeNull();
  });

  it('bowling is each bowler’s overs, maidens, runs and wickets, in the order they bowled', () => {
    const [first] = scorecardView(displayOf(twoOvers()));
    expect(first?.bowling).toEqual([
      { name: 'Away Player 11', figures: '1.0-0-7-1' },
      { name: 'Away Player 10', figures: '1.0-0-5-1' },
    ]);
  });

  it('extras say the total and its kinds; penalty runs only when there are some', () => {
    const [first] = scorecardView(displayOf(twoOvers()));
    expect(first?.extras).toEqual({
      key: 'scoring.cricket.card.extras',
      vars: { total: 2, wides: 1, noBalls: 1, byes: 0, legByes: 0 },
    });
  });

  it('an innings with no dismissal has no fall of wickets, and a bowler with no wicket still has a line', () => {
    const [first] = scorecardView(
      displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, ONE, DOT])]),
    );
    expect(first?.fall).toEqual([]);
    expect(first?.bowling).toEqual([{ name: 'Away Player 11', figures: '0.3-0-2-0' }]);
  });

  it('a penalty is named in the extras only when one was awarded', () => {
    const penalty = { extras: { kind: 'penalty', runs: 5 } } as const;
    const [first] = scorecardView(
      displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, penalty])]),
    );
    expect(first?.extras).toEqual({
      key: 'scoring.cricket.card.extrasPen',
      vars: { total: 5, wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 5 },
    });
  });

  // The engine's other shapes (a declared innings, a line ledger's bare "out", a run out with two fielders and no bowler
  // credited, an innings with no extras line) cannot be reached by one fixture: the card is crafted from a played one.
  describe('the engine’s other shapes', () => {
    const crafted = (edit: (card: CricketInningsCard) => CricketInningsCard) => {
      const display = displayOf(twoOvers());
      const [card] = display.scorecard.innings;
      if (card === undefined) throw new Error('no innings card');
      return scorecardView({
        ...display,
        scorecard: { ...display.scorecard, innings: [edit(card)] },
      })[0];
    };
    const dismissed = (dismissal: BattingLine['dismissal']) => (card: CricketInningsCard) => ({
      ...card,
      batting: card.batting.map((line, i) => (i === 1 ? { ...line, dismissal } : line)),
    });

    it('a declared innings is its total with "declared"', () => {
      expect(crafted((card) => ({ ...card, declared: true }))?.total).toEqual({
        key: 'scoring.cricket.card.declared',
        vars: { runs: 12, wickets: 2, overs: '2.0' },
      });
    });

    it('a dismissal the scorecard does not name reads Out', () => {
      const card = crafted(dismissed({ kind: 'out_unknown' }));
      expect(card?.batting[1]?.how).toEqual({ key: 'scoring.cricket.card.out' });
    });

    it('a run out names both fielders, thrower first, and no bowler', () => {
      const runout = {
        kind: 'runout',
        bowler: null,
        fielder: player('A', 3),
        fielderAssist: player('A', 4),
      } as const;
      expect(crafted(dismissed(runout))?.batting[1]?.how).toEqual({
        key: 'scoring.cricket.out.fielders',
        vars: {
          how: { key: 'scoring.cricket.out.kind.runout' },
          assist: 'Away Player 4',
          fielder: 'Away Player 3',
        },
      });
    });

    it('a retirement names no one but the batter', () => {
      const retired = {
        kind: 'retired',
        bowler: null,
        fielder: null,
        fielderAssist: null,
      } as const;
      expect(crafted(dismissed(retired))?.batting[1]?.how).toEqual({
        key: 'scoring.cricket.out.kind.retired',
      });
    });

    it('an innings with no extras line has none', () => {
      expect(crafted((card) => ({ ...card, extras: null }))?.extras).toBeNull();
    });

    it('a name the team sheets lack is the id itself', () => {
      const stranger = {
        kind: 'bowled',
        bowler: 'X-unknown',
        fielder: null,
        fielderAssist: null,
      } as const;
      expect(crafted(dismissed(stranger))?.batting[1]?.how).toEqual({
        key: 'scoring.cricket.card.bowledBy',
        vars: { how: { key: 'scoring.cricket.out.kind.bowled' }, bowler: 'X-unknown' },
      });
    });
  });

  // The four questions, an empty input: nothing played, and an innings scored in over totals (no players).
  it('has nothing before an innings is played', () => {
    expect(scorecardView(displayOf(OPENING))).toEqual([]);
    expect(scorecardView(displayOf([]))).toEqual([]);
  });

  it('an innings scored in over totals has its total and none of the player lines', () => {
    const [first] = scorecardView(
      displayOf([...OPENING, summary(8, 0, 6), summary(15, 1, 12)], NO_AWAY_PLAYERS),
    );
    expect(first?.total).toEqual({
      key: 'scoring.cricket.card.total',
      vars: { runs: 15, wickets: 1, overs: '2.0' },
    });
    expect(first?.batting).toEqual([]);
    expect(first?.bowling).toEqual([]);
    expect(first?.fall).toEqual([]);
    expect(first?.didNotBat).toBeNull();
  });

  // After the first innings: the second innings is the chase, with its own side and number.
  it('the second innings is listed after the first, under the other side’s name', () => {
    const cards = scorecardView(displayOf(TIED_KO));
    expect(cards.map((one) => one.title)).toEqual([
      { key: 'scoring.cricket.history.innings', vars: { number: 1, side: 'Home CC' } },
      { key: 'scoring.cricket.history.innings', vars: { number: 2, side: 'Away CC' } },
    ]);
    expect(cards.map((one) => one.total)).toEqual([
      { key: 'scoring.cricket.card.total', vars: { runs: 8, wickets: 0, overs: '2.0' } },
      { key: 'scoring.cricket.card.total', vars: { runs: 8, wickets: 0, overs: '2.0' } },
    ]);
  });

  it('a super over is titled as one, after the main innings', () => {
    const ledger = [...TIED_KO, ...superOverOf('A', H(11), [ONE, ONE, DOT])];
    const cards = scorecardView(displayOf(ledger));
    expect(cards.at(-1)?.title).toEqual({
      key: 'scoring.cricket.history.superOver',
      vars: { number: 1, side: 'Away CC' },
    });
    expect(cards).toHaveLength(3);
  });
});
