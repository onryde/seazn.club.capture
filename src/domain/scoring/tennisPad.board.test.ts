import { describe, expect, it } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import { gamesOf } from '@/domain/scoring/tennisFold.testkit';
import { padOf } from '@/domain/scoring/tennisPad.testkit';
import type { TennisPadKey } from '@/domain/scoring/tennisTypes';
import {
  DOUBLES,
  DOUBLES_NOAD_CFG,
  SINGLES,
  abandon,
  award,
  forfeit,
  point,
  points,
  start,
  summary,
  withCfg,
} from '../../../test/tennisLedger';

// S2-7 Task 18 (rulings 235, 239, 240): each live half is one row of a scoreboard, the sets boxes, the games box and the
// numbered dots of the games its side won; a doubles server's name sits under the names; a decided or ended match is a final
// board per half. Every expected value is written out from the sequence played (game numbers count every game of the set,
// awarded ones too), never read from the fold. Top half = home = first.

const T = 'scoring.tennis.';
const SETS = { key: `${T}board.sets` };
const GAMES = { key: `${T}board.games` };
const SIX_ALL = 'HAHAHAHAHAHA';
const boards = (view: PadView<TennisPadKey>) => view.halves.map((half) => half.scoreboard);

describe('the live half as a row of a scoreboard (rulings 240, 242)', () => {
  it('shows the numbers of the games this side won in the set as dots, which are its games count', () => {
    // Games 1..5 go to: first, second, first, first, second.
    const view = padOf([start(), ...gamesOf('HAHHA'), point('H')]);
    expect(boards(view).map((board) => [board?.setsLabel, board?.sets, board?.dots])).toEqual([
      [SETS, [], [1, 3, 4]],
      [SETS, [], [2, 5]],
    ]);
  });

  it('gives a side that has won no game an empty dots list (not none: its height stays)', () => {
    const view = padOf([start(), ...gamesOf('H')]);
    expect(boards(view).map((board) => board?.dots)).toEqual([[1], []]);
    expect(boards(padOf([start()])).map((board) => board?.dots)).toEqual([[], []]);
  });

  it('numbers an awarded game by its place in the set and gives it to the side it was awarded to', () => {
    const view = padOf([start(), award('A'), ...gamesOf('H'), award('A')]);
    expect(boards(view).map((board) => board?.dots)).toEqual([[2], [1, 3]]);
  });

  it('adds one box of each side’s games for every finished set, and starts the dots again in the next set', () => {
    // Set 1 is 6-0 to first; set 2: game 1 to second.
    const view = padOf([start(), ...gamesOf('HHHHHH'), ...gamesOf('A')]);
    expect(boards(view).map((board) => [board?.sets, board?.dots])).toEqual([
      [['6'], []],
      [['0'], [1]],
    ]);
  });

  it('lists every finished set, a set entered by Set score too (which has no dots of its own)', () => {
    const view = padOf([start(), summary(6, 3), summary(3, 6), ...gamesOf('H')]);
    expect(boards(view).map((board) => [board?.sets, board?.dots])).toEqual([
      [['6', '3'], [1]],
      [['3', '6'], []],
    ]);
  });

  it('keeps the dots of the twelve games in a set tie-break, and the call is the breaker’s points', () => {
    const view = padOf([start(), ...gamesOf(SIX_ALL), ...points('HHA')]);
    expect(view.halves.map((half) => half.value)).toEqual(['2', '1']);
    expect(boards(view).map((board) => board?.dots)).toEqual([
      [1, 3, 5, 7, 9, 11],
      [2, 4, 6, 8, 10, 12],
    ]);
  });

  it('has no dots in a match tie-break; the Sets boxes stay', () => {
    const noAd = withCfg(SINGLES, DOUBLES_NOAD_CFG);
    const view = padOf([start(), summary(6, 3), summary(3, 6), point('H')], { bootstrap: noAd });
    expect(boards(view).map((board) => [board?.sets, board?.dots])).toEqual([
      [['6', '3'], null],
      [['3', '6'], null],
    ]);
  });

  it('is none before the start (the Start screen) and once the match is decided', () => {
    expect(boards(padOf([]))).toEqual([null, null]);
    expect(boards(padOf([start(), ...gamesOf('HHHHHHHHHHHH')]))).toEqual([null, null]);
  });

  it('is said to a screen reader: the sets, then the games count and which games ("Games 2: 1, 3")', () => {
    const view = padOf([start(), ...gamesOf('HHHHHH'), ...gamesOf('HAH')]);
    expect(view.halves[0].scoreboard?.said).toEqual([
      { key: `${T}board.said`, vars: { label: SETS, value: '6' } },
      { key: `${T}board.gamesWon`, vars: { count: 2, games: '1, 3' } },
    ]);
    // A side with no game won says "Games: 0", never an empty list.
    expect(padOf([start(), ...gamesOf('H')]).halves[1].scoreboard?.said).toEqual([
      { key: `${T}board.said`, vars: { label: GAMES, value: '0' } },
    ]);
    // A match tie-break has no games to say.
    const noAd = withCfg(SINGLES, DOUBLES_NOAD_CFG);
    const mtb = padOf([start(), summary(6, 3), summary(3, 6), point('H')], { bootstrap: noAd });
    expect(mtb.halves[0].scoreboard?.said).toEqual([
      { key: `${T}board.said`, vars: { label: SETS, value: '6, 3' } },
    ]);
  });

  it('has no Games foot any more: the dots are the games', () => {
    expect(padOf([start(), ...gamesOf('H')]).halves.map((half) => half.foot ?? null)).toEqual([
      null,
      null,
    ]);
  });
});

describe('the doubles server’s name (ruling 235, device finding T12-F1)', () => {
  it('sits under the side’s names on the serving half, and the dots row is still there', () => {
    const view = padOf([start()], { bootstrap: DOUBLES });
    expect(view.halves[0].server).toEqual({
      key: `${T}serverPerson`,
      vars: { person: 'Ruiz / Vega h1' },
    });
    expect(view.halves[0].sub).toBeNull();
    expect(view.halves[1].server).toBeNull();
    expect(boards(view).map((board) => board?.dots)).toEqual([[], []]);
  });

  it('is none in singles and in a tie-break, where the plate stands alone', () => {
    expect(padOf([start()]).halves.map((half) => half.server ?? null)).toEqual([null, null]);
    const tb = padOf([start(), ...gamesOf(SIX_ALL)], { bootstrap: DOUBLES });
    expect(tb.halves.map((half) => half.server ?? null)).toEqual([null, null]);
  });
});

describe('the final board (ruling 239)', () => {
  const won = (view: PadView<TennisPadKey>, at: 0 | 1) => view.halves[at].finalBoard;
  const set = (n: number) => ({ key: `${T}board.set`, vars: { set: n } });

  it('is a box a set and the sets won, the winner’s set boxes lime and its Sets box the lime plate', () => {
    // first wins 6-0 6-0.
    const view = padOf([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(won(view, 0)?.boxes).toEqual([
      { label: set(1), value: '6', tone: 'won' },
      { label: set(2), value: '6', tone: 'won' },
      { label: SETS, value: '2', tone: 'plate' },
    ]);
    expect(won(view, 1)?.boxes).toEqual([
      { label: set(1), value: '0', tone: 'plain' },
      { label: set(2), value: '0', tone: 'plain' },
      { label: SETS, value: '0', tone: 'plain' },
    ]);
  });

  it('colours each set box by the side that won that set, not by the match', () => {
    // second takes set 1 (0-6), first sets 2 and 3.
    const view = padOf([start(), ...gamesOf('AAAAAA'), ...gamesOf('HHHHHH'), ...gamesOf('HHHHHH')]);
    expect(won(view, 0)?.boxes.map((box) => box.tone)).toEqual(['plain', 'won', 'won', 'plate']);
    expect(won(view, 1)?.boxes.map((box) => box.tone)).toEqual(['won', 'plain', 'plain', 'plain']);
  });

  it('shows the tie-break loser’s points in brackets after its games, and only the loser’s box', () => {
    // 7-6(5): the tie-break goes 7-5... first wins it 7-5 after 6-6.
    const view = padOf([
      start(),
      ...gamesOf(SIX_ALL),
      ...points('HAHAHAHAHAHH'),
      ...gamesOf('HHHHHH'),
    ]);
    expect(won(view, 0)?.boxes[0]).toEqual({ label: set(1), value: '7', tone: 'won' });
    expect(won(view, 1)?.boxes[0]).toEqual({
      label: set(1),
      value: '6',
      bracket: '5',
      tone: 'plain',
    });
  });

  it('labels a match tie-break decider MTB and holds its points', () => {
    const noAd = withCfg(SINGLES, DOUBLES_NOAD_CFG);
    const view = padOf(
      [start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA'), ...points('HHHHHHHHHH')],
      { bootstrap: noAd },
    );
    expect(won(view, 0)?.boxes).toEqual([
      { label: set(1), value: '6', tone: 'won' },
      { label: set(2), value: '0', tone: 'plain' },
      { label: { key: `${T}board.mtb` }, value: '10', tone: 'won' },
      { label: SETS, value: '2', tone: 'plate' },
    ]);
    expect(won(view, 1)?.boxes[2]).toMatchObject({ value: '0', tone: 'plain' });
  });

  it('lights the winner’s half with a WON plate where the serving plate sits, and neither half serves', () => {
    const view = padOf([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(view.halves.map((half) => half.bar)).toEqual(['lit', 'dim']);
    expect(view.halves[0].serving).toEqual({
      shown: { key: `${T}board.won` },
      said: { key: `${T}board.won` },
    });
    expect(view.halves[1].serving).toBeNull();
    expect(view.halves.map((half) => half.value)).toEqual(['', '']);
  });

  it('draws no big call and no board row: the final board stands in their place', () => {
    const view = padOf([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(view.halves.map((half) => half.scoreboard ?? null)).toEqual([null, null]);
    expect(view.halves.map((half) => half.sub)).toEqual([null, null]);
    expect(view.halves.map((half) => half.server ?? null)).toEqual([null, null]);
  });

  it('is said to a screen reader, box by box', () => {
    const view = padOf([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(won(view, 0)?.said).toEqual([
      { key: `${T}board.said`, vars: { label: set(1), value: '6' } },
      { key: `${T}board.said`, vars: { label: set(2), value: '6' } },
      { key: `${T}board.said`, vars: { label: SETS, value: '2' } },
    ]);
  });

  it('is shown for an ended match too, with no WON plate and the set under way counted with its games', () => {
    const view = padOf([start(), ...gamesOf('HHH'), forfeit('A', 'retired')]);
    expect(view.halves.map((half) => half.serving)).toEqual([null, null]);
    expect(view.halves.map((half) => half.bar)).toEqual(['dim', 'dim']);
    expect(won(view, 0)?.boxes).toEqual([
      { label: set(1), value: '3', tone: 'plain' },
      { label: SETS, value: '0', tone: 'plain' },
    ]);
    expect(won(view, 1)?.boxes[0]).toEqual({ label: set(1), value: '0', tone: 'plain' });
  });

  it('shows only the Sets box for an ended match with no game played, and keeps finished sets before the set under way', () => {
    const none = padOf([start(), abandon('rain')]);
    expect(won(none, 0)?.boxes).toEqual([{ label: SETS, value: '0', tone: 'plain' }]);
    const view = padOf([start(), ...gamesOf('HHHHHH'), ...gamesOf('A'), forfeit('H', 'retired')]);
    expect(won(view, 0)?.boxes.map((box) => [box.label, box.value])).toEqual([
      [set(1), '6'],
      [set(2), '0'],
      [SETS, '1'],
    ]);
    expect(won(view, 1)?.boxes.map((box) => box.value)).toEqual(['0', '1', '0']);
  });

  it('shows the match tie-break under way of an ended match as MTB with its points', () => {
    const noAd = withCfg(SINGLES, DOUBLES_NOAD_CFG);
    const view = padOf(
      [start(), summary(6, 3), summary(3, 6), ...points('HHA'), forfeit('A', 'retired')],
      { bootstrap: noAd },
    );
    expect(won(view, 0)?.boxes.map((box) => [box.label, box.value])).toEqual([
      [set(1), '6'],
      [set(2), '3'],
      [{ key: `${T}board.mtb` }, '2'],
      [SETS, '1'],
    ]);
  });

  it('says "Final" in the strip’s set slot, decided or ended', () => {
    const slot = (view: PadView<TennisPadKey>) => view.strip.find((one) => one.slot === 'set');
    expect(slot(padOf([start(), ...gamesOf('HHHHHHHHHHHH')]))?.text).toEqual({
      key: `${T}final`,
    });
    expect(slot(padOf([start(), forfeit('A', 'walkover')]))?.text).toEqual({ key: `${T}final` });
    expect(slot(padOf([start(), point('H')]))?.text).toEqual({
      key: `${T}setOf`,
      vars: { set: 1, bestOf: 3 },
    });
  });

  it('carries the result in words for the carried-forward card (the pad’s own result line)', () => {
    const view = padOf([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(view.result).toEqual({
      key: `${T}result`,
      vars: { side: 'Ana Ruiz', sets: '6–0 6–0' },
    });
    expect(padOf([start(), point('H')]).result).toBeUndefined();
  });
});
