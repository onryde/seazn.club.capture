import { describe, expect, it } from 'vitest';
import { cricketBoard } from '@/domain/scoring/cricketPad';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  ALL_OUT_FIRST,
  AWAY_BOWLERS,
  FIRST_INNINGS_8,
  HOME_BOWLERS,
  MATCH,
  NO_BALL,
  ONE,
  OPENING,
  OVER_ONE_DONE,
  WIDE,
  FOUR,
  OUT,
  DOT,
  TWO_INNINGS,
  ball,
  inningsOf,
  ledgerOf,
  player,
  summary,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';
import type { Bootstrap } from '@/domain/scoring/wire';

// The cricket board (S2-4 spec §5 rows 2 to 4; plan Task 8): the score of the innings now, the crease with the striker
// first and marked, the bowler with O-M-R-W, this over's deliveries and a free hit. Every expected value is written out
// from the Laws and the ledger, never read from the fold.

function boardOf(specs: readonly Spec[], bootstrap: Bootstrap = MATCH) {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks: NO_PICKS,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return cricketBoard(folded.display);
}

const en = createTranslator('en');
const H = (n: number) => player('H', n);

describe('cricketBoard', () => {
  it('no score before the toss, and no crease or bowler', () => {
    const board = boardOf([]);
    expect(board.score).toBeNull();
    expect(board.crease).toBeNull();
    expect(board.bowler).toBeNull();
    expect(board.over).toStrictEqual({ number: 1, chips: [] });
    expect(board.status).toBeNull();
  });

  it('after an over of six singles: 6/0 in 1 over, the second opener on strike, the next over empty', () => {
    const board = boardOf(OVER_ONE_DONE);
    const score = board.score;
    expect(score === null ? null : [score.runs, score.wickets, score.overs]).toStrictEqual([
      6,
      0,
      '1',
    ]);
    expect(score === null ? null : translatePad(en, score.innings)).toBe('Innings 1 · Home CC');
    expect(score?.chase).toBeNull();
    expect(board.crease).toStrictEqual([
      { id: H(2), name: 'Home Player 2', runs: 3, balls: 3, striker: true },
      { id: H(1), name: 'Home Player 1', runs: 3, balls: 3, striker: false },
    ]);
    expect(board.over).toStrictEqual({ number: 2, chips: [] });
  });

  it('mid-over: the overs as a scorebook writes them, the bowler’s figures, and the over’s chips in order', () => {
    const board = boardOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [FOUR, DOT, WIDE, OUT])]);
    const score = board.score;
    expect(score === null ? null : [score.runs, score.wickets, score.overs]).toStrictEqual([
      5,
      1,
      '0.3',
    ]);
    expect(board.bowler).toStrictEqual({
      id: player('A', 11),
      name: 'Away Player 11',
      figures: '0.3-0-5-1',
    });
    expect(board.over).toStrictEqual({
      number: 1,
      chips: [
        { text: '4', tone: 'boundary' },
        { text: '·', tone: 'dot' },
        { text: 'wd', tone: 'extra' },
        { text: 'W', tone: 'wicket' },
      ],
    });
  });

  it('a chase reads the runs needed off the balls left', () => {
    const chase = ball({
      over: 0,
      ballInOver: 1,
      striker: player('A', 1),
      nonStriker: player('A', 2),
      bowler: H(11),
      bat: 1,
    });
    const before = boardOf(FIRST_INNINGS_8).score;
    expect(before?.chase === null || before === null ? null : translatePad(en, before.chase)).toBe(
      'Need 9 off 12 balls',
    );
    const after = boardOf([...FIRST_INNINGS_8, chase]).score;
    expect(after === null || after.chase === null ? null : translatePad(en, after.chase)).toBe(
      'Need 8 off 11 balls',
    );
    expect(after === null ? null : translatePad(en, after.innings)).toBe('Innings 2 · Away CC');
  });

  it('a chase of one ball says ball; nl the same in its own words', () => {
    const lastBall = [
      ...FIRST_INNINGS_8,
      ...inningsOf('A', HOME_BOWLERS, [ONE, ONE, ONE, ONE, ONE, ONE, ONE, DOT, DOT, DOT, DOT]),
    ];
    const score = boardOf(lastBall).score;
    const chase = score?.chase ?? null;
    expect(chase === null ? null : translatePad(en, chase)).toBe('Need 2 off 1 ball');
    expect(chase === null ? null : translatePad(createTranslator('nl'), chase)).toBe(
      'Nog 2 nodig uit 1 bal',
    );
  });

  it('a decided match shows no chase', () => {
    const decided = [...ALL_OUT_FIRST, ...inningsOf('A', HOME_BOWLERS, [ONE, ONE])];
    expect(boardOf(decided).score?.chase).toBeNull();
  });

  // Law 16: a two-innings match drawn on time (`cricket.match.close`) with the fourth innings still open. 300 and 200
  // against 250 sets 251; the away side is 100/3 when time runs out, so the fold still holds a chase of 151.
  it('a match drawn on time mid-chase shows no chase: nothing is needed of a match that is over', () => {
    const bootstrap = withCfg(MATCH, TWO_INNINGS);
    const chasing = [
      ...OPENING,
      summary(300, 10, 300),
      summary(250, 10, 300),
      summary(200, 10, 300),
      summary(100, 3, 120),
    ];
    expect(boardOf(chasing, bootstrap).score?.chase).toStrictEqual({
      key: 'scoring.cricket.board.need',
      vars: { runs: 151 },
    });
    const drawn = boardOf([...chasing, { type: 'cricket.match.close', payload: {} }], bootstrap);
    expect(drawn.score === null ? null : [drawn.score.runs, drawn.score.wickets]).toEqual([100, 3]);
    expect(drawn.score?.chase).toBeNull();
  });

  // One innings a side with no overs limit: the home side all out for 1, so the away side needs 2, with no balls to count.
  it('a chase with no ball limit needs runs only', () => {
    const bootstrap = withCfg(MATCH, { ballsPerInnings: null, minOversForResult: 0 });
    const score = boardOf(ALL_OUT_FIRST, bootstrap).score;
    expect(score === null || score.chase === null ? null : translatePad(en, score.chase)).toBe(
      'Need 2',
    );
  });

  it('a no-ball makes the next ball a free hit', () => {
    expect(boardOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [NO_BALL])]).status).toStrictEqual({
      key: 'scoring.cricket.board.freeHit',
    });
    expect(
      boardOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [NO_BALL, ONE])]).status,
    ).toBeNull();
  });
});
