import { describe, expect, it } from 'vitest';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { withPick } from '@/domain/scoring/cricketPicks';
import { playersBowler, playersView, yetMoved } from '@/domain/scoring/cricketPlayers';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY_BOWLERS,
  DOT,
  FOUR,
  KO_2,
  LEAGUE_2,
  MATCH,
  TIED_KO,
  TWO_INNINGS,
  ONE,
  OPENING,
  OUT,
  T20,
  inningsOf,
  ledgerOf,
  player,
  retire,
  superOverOf,
  times,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// The Players sheet (S2-4 spec §4.8a; rulings 77 and 78; plan Task 14). Figures are the engine scorecard's: every number
// here is the scripted over's, written out by hand, never derived with `deriveCricketScorecard` (preflight D3).

function displayOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = withCfg(MATCH, T20),
  picks: PendingPicks = NO_PICKS,
) {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);

/**
 * One over by A-p11: H-p1 4, 4, 1; H-p2 bowled first ball; H-p3 dot, dot. 9 runs, one wicket: 1.0-0-9-1. The over's end
 * puts H-p1 (9 off 3) on strike.
 */
const SCRIPTED: readonly Spec[] = [
  ...OPENING,
  ...inningsOf('H', AWAY_BOWLERS, [FOUR, FOUR, ONE, OUT, DOT, DOT]),
];

describe('playersView: batting', () => {
  it('in batting order: out with how and runs (balls), in with runs (balls) and the striker, yet to bat', () => {
    const { batting } = playersView(displayOf(SCRIPTED));
    expect(batting.slice(0, 4)).toEqual([
      {
        id: H(1),
        name: 'Home Player 1',
        state: 'in',
        striker: true,
        note: { key: 'scoring.cricket.players.in', vars: { runs: 9, balls: 3 } },
        up: false,
        down: false,
      },
      {
        id: H(2),
        name: 'Home Player 2',
        state: 'out',
        striker: false,
        note: {
          key: 'scoring.cricket.players.out',
          vars: { how: { key: 'scoring.cricket.out.kind.bowled' }, runs: 0, balls: 1 },
        },
        up: false,
        down: false,
      },
      {
        id: H(3),
        name: 'Home Player 3',
        state: 'in',
        striker: false,
        note: { key: 'scoring.cricket.players.in', vars: { runs: 0, balls: 2 } },
        up: false,
        down: false,
      },
      {
        id: H(4),
        name: 'Home Player 4',
        state: 'yet',
        striker: false,
        note: { key: 'scoring.cricket.players.yet' },
        up: false,
        down: true,
      },
    ]);
    expect(batting).toHaveLength(11);
    expect(batting.at(-1)).toMatchObject({ id: H(11), up: true, down: false });
  });

  it('those who have batted come first, in the order, then those yet to bat: a batter in out of turn', () => {
    const display = displayOf(SCRIPTED);
    const reordered = [H(1), H(2), H(4), H(3), ...[5, 6, 7, 8, 9, 10, 11].map(H)];
    const held = displayOf(
      SCRIPTED,
      undefined,
      withPick(NO_PICKS, display, { kind: 'order', side: 'first', ids: reordered }),
    );
    expect(held.battingOrder).toEqual(reordered);
    const { batting } = playersView(held);
    expect(batting.map((one) => one.id).slice(0, 5)).toEqual([H(1), H(2), H(3), H(4), H(5)]);
    expect(batting[3]).toMatchObject({ state: 'yet', up: false, down: true });
  });

  it('a dismissal the scorecard does not name (a line ledger’s "out") reads Out, with runs (balls)', () => {
    const display = displayOf(SCRIPTED);
    const [card] = display.scorecard.innings;
    if (card === undefined) throw new Error('no innings card');
    const batting = card.batting.map((line) =>
      line.person === H(2) ? { ...line, dismissal: { kind: 'out_unknown' as const } } : line,
    );
    const crafted = {
      ...display,
      scorecard: { ...display.scorecard, innings: [{ ...card, batting }] },
    };
    expect(playersView(crafted).batting[1]?.note).toEqual({
      key: 'scoring.cricket.players.outPlain',
      vars: { runs: 0, balls: 1 },
    });
  });

  it('a retired batter reads Retired not out, with runs (balls)', () => {
    const { batting } = playersView(
      displayOf([...SCRIPTED.slice(0, 4), retire(H(1), 'hurt', H(3))]),
    );
    expect(batting[0]).toMatchObject({
      id: H(1),
      state: 'retired',
      note: { key: 'scoring.cricket.players.retired', vars: { runs: 8, balls: 2 } },
    });
  });
});

describe('playersView: bowling', () => {
  it('a scripted over shows its bowler’s figures: 1.0-0-9-1, three overs left', () => {
    const row = playersView(displayOf(SCRIPTED)).bowling.find((one) => one.id === A(11));
    expect(row?.note).toEqual({
      key: 'scoring.cricket.players.cannot',
      vars: { figures: '1.0-0-9-1', why: { key: 'scoring.cricket.bowling.lastOver' } },
    });
  });

  it('between overs one out of overs says so, with the format’s quota; the last over’s bowler says that', () => {
    const three = withCfg(MATCH, { ...KO_2, ballsPerInnings: 18 });
    const two = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(12, DOT))], three);
    const { bowling } = playersView(two);
    expect(bowling.find((one) => one.id === A(11))?.note).toEqual({
      key: 'scoring.cricket.players.cannot',
      vars: {
        figures: '1.0-1-0-0',
        why: { key: 'scoring.cricket.bowling.outOfOvers', vars: { max: 1 } },
      },
    });
    expect(bowling.find((one) => one.id === A(10))?.note).toEqual({
      key: 'scoring.cricket.players.cannot',
      vars: { figures: '1.0-1-0-0', why: { key: 'scoring.cricket.bowling.lastOver' } },
    });
  });

  it('between overs, those who may bowl take a tap, with figures and overs left; the rest take none', () => {
    const { bowling } = playersView(displayOf(SCRIPTED));
    expect(bowling.find((one) => one.id === A(1))).toMatchObject({
      tappable: true,
      chosen: false,
      note: {
        key: 'scoring.cricket.players.figures.other',
        count: 4,
        vars: { figures: '0-0-0-0' },
      },
    });
    expect(bowling.find((one) => one.id === A(11))?.tappable).toBe(false);
  });

  it('mid-over the bowling tab takes no tap, and says no reason for the next over', () => {
    const mid = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, DOT])]);
    const { bowling } = playersView(mid);
    expect(bowling.map((one) => one.tappable)).toEqual(Array.from({ length: 11 }, () => false));
    expect(bowling.filter((one) => one.chosen)).toEqual([]);
    expect(playersView(mid).betweenOvers).toBe(false);
    expect(bowling.find((one) => one.id === A(11))?.note).toEqual({
      key: 'scoring.cricket.players.figures.other',
      count: 4,
      vars: { figures: '0.2-0-1-0' },
    });
  });

  it('mid-over the last over’s bowler reads figures and overs left, not why they may not bowl the next', () => {
    const second = displayOf([
      ...OPENING,
      ...inningsOf('H', AWAY_BOWLERS, [...times(6, DOT), ONE]),
    ]);
    expect(second.bowler?.id).toBe(A(10));
    expect(playersView(second).bowling.find((row) => row.id === A(11))?.note).toEqual({
      key: 'scoring.cricket.players.figures.other',
      count: 3,
      vars: { figures: '1.0-1-0-0' },
    });
  });

  it('with no quota a bowler’s note is the figures alone', () => {
    const unlimited = withCfg(MATCH, TWO_INNINGS);
    const one = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, DOT])], unlimited);
    expect(playersView(one).bowling.find((row) => row.id === A(11))?.note).toBe('0.2-0-1-0');
  });

  it('a super over set up, before its ball, is read-only: its bowler is the setup’s', () => {
    const picks = { 'openers.s1': [A(1), A(2)], 'bowler.s1.0': [H(11)] };
    const one = displayOf(TIED_KO, MATCH, picks);
    expect([one.stage, one.innings?.superOver, one.deliveries]).toEqual(['live', true, 0]);
    expect(playersView(one).betweenOvers).toBe(false);
    expect(playersBowler(one, H(10))).toBeNull();
  });

  it('between a super over’s two innings it is read-only', () => {
    const one = displayOf([...TIED_KO, ...superOverOf('A', H(11), times(6, DOT))], MATCH);
    expect(one.stage).toBe('superOverSetup');
    expect(playersView(one).betweenOvers).toBe(false);
  });

  it('once the match has ended the tab is read-only', () => {
    const tied = displayOf(TIED_KO, withCfg(MATCH, LEAGUE_2));
    expect(tied.stage).not.toBe('live');
    expect(playersView(tied).betweenOvers).toBe(false);
    expect(playersBowler(tied, H(10))).toBeNull();
  });

  it('a held pick is marked chosen', () => {
    const display = displayOf(SCRIPTED);
    const held = displayOf(
      SCRIPTED,
      undefined,
      withPick(NO_PICKS, display, { kind: 'bowler', bowler: A(9) }),
    );
    expect(playersView(held).bowling.find((one) => one.id === A(9))?.chosen).toBe(true);
  });
});

describe('playersBowler', () => {
  it('between overs a tap on one who may bowl is the over’s pick; on one who may not, nothing', () => {
    const display = displayOf(SCRIPTED);
    expect(playersBowler(display, A(9))).toEqual({ kind: 'bowler', bowler: A(9) });
    expect(playersBowler(display, A(11))).toBeNull();
  });

  it('mid-over nothing', () => {
    const mid = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, DOT])]);
    expect(playersBowler(mid, A(9))).toBeNull();
  });
});

describe('yetMoved (ruling 78)', () => {
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(H);

  it('moves a batter yet to bat among those yet to bat: the order pick, nothing recorded', () => {
    expect(yetMoved(displayOf(SCRIPTED), 4, 3)).toEqual({
      kind: 'order',
      side: 'first',
      ids: [order[0], order[1], order[2], order[4], order[3], ...order.slice(5)],
    });
  });

  it('swaps two yet to bat wherever those who have batted stand in the order', () => {
    const display = displayOf(SCRIPTED);
    const reordered = [H(1), H(2), H(4), H(3), ...[5, 6, 7, 8, 9, 10, 11].map(H)];
    const held = displayOf(
      SCRIPTED,
      undefined,
      withPick(NO_PICKS, display, { kind: 'order', side: 'first', ids: reordered }),
    );
    expect(yetMoved(held, 3, 4)).toEqual({
      kind: 'order',
      side: 'first',
      ids: [H(1), H(2), H(5), H(3), H(4), ...[6, 7, 8, 9, 10, 11].map(H)],
    });
  });

  it('never moves a batter in or out, nor one yet to bat above them', () => {
    const display = displayOf(SCRIPTED);
    expect(yetMoved(display, 3, 2)).toBeNull();
    expect(yetMoved(display, 2, 3)).toBeNull();
    expect(yetMoved(display, 0, 1)).toBeNull();
    expect(yetMoved(display, 10, 11)).toBeNull();
  });
});
