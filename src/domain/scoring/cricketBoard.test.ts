import { describe, expect, it } from 'vitest';
import { cricketBoard } from '@/domain/scoring/cricketPad';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { playersView } from '@/domain/scoring/cricketPlayers';
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
  TIED_KO,
  TWO,
  superOverOf,
  ball,
  inningsOf,
  ledgerOf,
  player,
  retire,
  summary,
  times,
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
const A = (n: number) => player('A', n);

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
    expect(score === null ? null : [score.team, translatePad(en, score.innings)]).toStrictEqual([
      'Home CC',
      'Innings 1',
    ]);
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
    expect(after === null ? null : [after.team, translatePad(en, after.innings)]).toStrictEqual([
      'Away CC',
      'Innings 2',
    ]);
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

// T19 D6 (the controller's ruling, 2026-11-09): once a match is decided the board keeps the bowler's line and shows the
// batters left not out, `name runs (balls)`, with no striker mark: no ball is due. Home made 8 off two overs, so the
// away side chases 9. Every name, run and ball below is worked out by hand from the script.
describe('cricketBoard at a result (T19 D6)', () => {
  const chased = (script: Parameters<typeof inningsOf>[2]) => [
    ...FIRST_INNINGS_8,
    ...inningsOf('A', HOME_BOWLERS, script),
  ];

  it('a chase won by 10 wickets shows both openers, runs (balls), neither on strike, beside the bowler', () => {
    // A-p1 hits a four then a single (5 off 2) and crosses; A-p2 hits a four (4 off 1): 9 runs, won by 10 wickets.
    const board = boardOf(chased([FOUR, ONE, FOUR]));
    expect(board.crease).toStrictEqual([
      { id: A(1), name: 'Away Player 1', runs: 5, balls: 2, striker: false },
      { id: A(2), name: 'Away Player 2', runs: 4, balls: 1, striker: false },
    ]);
    expect(board.bowler).toStrictEqual({
      id: H(11),
      name: 'Home Player 11',
      figures: '0.3-0-9-0',
    });
  });

  it('a win by fewer wickets shows the pair at the crease when it ended, in the order they came in', () => {
    // A-p1 is bowled first ball; A-p3 and A-p2 run a single each, then A-p3 hits two fours: 1 + 1 + 4 + 4 = 10, 9
    // wickets.
    const board = boardOf(chased([OUT, ONE, ONE, FOUR, FOUR]));
    expect(board.crease).toStrictEqual([
      { id: A(2), name: 'Away Player 2', runs: 1, balls: 1, striker: false },
      { id: A(3), name: 'Away Player 3', runs: 9, balls: 3, striker: false },
    ]);
  });

  it('an all-out result shows the one batter left not out, alone', () => {
    // Away: a single, five wickets, a single after the over, five more wickets. A-p1 survives on 2 off 2; all out for
    // 2.
    const board = boardOf(chased([ONE, ...times(5, OUT), ONE, ...times(5, OUT)]));
    expect(board.crease).toStrictEqual([
      { id: A(1), name: 'Away Player 1', runs: 2, balls: 2, striker: false },
      null,
    ]);
  });

  it('a batter who retired hurt and did not return is not at the crease at the result', () => {
    // A-p1 takes a single (1 off 1) and retires hurt for A-p3; then A-p2 hits two fours (8 off 2), 9 in all.
    const board = boardOf([
      ...FIRST_INNINGS_8,
      ...inningsOf('A', HOME_BOWLERS, [ONE]),
      retire(A(1), 'hurt', A(3)),
      ball({
        over: 0,
        ballInOver: 2,
        striker: A(2),
        nonStriker: A(3),
        bowler: H(11),
        bat: 4,
        boundary: 4,
      }),
      ball({
        over: 0,
        ballInOver: 3,
        striker: A(2),
        nonStriker: A(3),
        bowler: H(11),
        bat: 4,
        boundary: 4,
      }),
    ]);
    expect(board.crease).toStrictEqual([
      { id: A(2), name: 'Away Player 2', runs: 8, balls: 2, striker: false },
      { id: A(3), name: 'Away Player 3', runs: 0, balls: 0, striker: false },
    ]);
  });

  it('over totals have no players to show at the result', () => {
    const board = boardOf([...OPENING, summary(8, 0, 12), summary(9, 0, 10)]);
    expect(board.score === null ? null : [board.score.runs, board.score.wickets]).toStrictEqual([
      9, 0,
    ]);
    expect(board.crease).toBeNull();
  });

  // T19 P3: an abandon before the first ball decides the match with no innings at all; the board has nothing to show and
  // the not-out read must not throw on the empty card list (`notOutAtResult`'s guards).
  it('a match abandoned before a ball is decided with no innings: no score, crease or bowler, and no throw', () => {
    const abandoned: Spec = { type: 'core.abandon', payload: { reason: 'rain' } };
    const folded = foldCricket({
      bootstrap: MATCH,
      ledger: ledgerOf([...OPENING, abandoned]),
      queued: [],
      ownEventIds: [],
      toss: null,
      picks: NO_PICKS,
    });
    if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
    const { display } = folded;
    expect([display.stage, display.innings, display.scorecard.innings]).toStrictEqual([
      'decided',
      null,
      [],
    ]);
    const board = cricketBoard(display);
    expect([board.score, board.crease, board.bowler]).toStrictEqual([null, null, null]);
    expect(playersView(display).batting).toStrictEqual([]);
  });

  it('a match still being played keeps the striker first and marked', () => {
    const board = boardOf(chased([FOUR, ONE]));
    expect(board.crease).toStrictEqual([
      { id: A(2), name: 'Away Player 2', runs: 0, balls: 0, striker: true },
      { id: A(1), name: 'Away Player 1', runs: 5, balls: 2, striker: false },
    ]);
  });
});

// T19 fix 9 (device, build 985): a 2-over match decided at its last ball showed "Over 3" and no chips. A decided match's
// strip is the over that ended it; an innings break has no over yet, so no strip. Chips are written out by hand.
describe('cricketBoard strip at a result and at a break (T19 fix 9)', () => {
  const chased = (script: Parameters<typeof inningsOf>[2]) => [
    ...FIRST_INNINGS_8,
    ...inningsOf('A', HOME_BOWLERS, script),
  ];
  const dot = { text: '·', tone: 'dot' } as const;
  const run = (n: number) => ({ text: String(n), tone: 'run' }) as const;

  it('decided on the last ball of over 2: Over 2 with its six deliveries in order, never Over 3', () => {
    // Away: six dots, then 1, dot, 2, dot, dot, dot = 3 of 9 needed; home wins by 5 on the 12th ball.
    const board = boardOf(chased([...times(6, DOT), ONE, DOT, TWO, DOT, DOT, DOT]));
    expect(board.result).not.toBeNull();
    expect(board.over).toStrictEqual({
      number: 2,
      chips: [run(1), dot, run(2), dot, dot, dot],
    });
  });

  it('decided mid-over by a chase won with balls to spare: that over and the chips so far', () => {
    const board = boardOf(chased([FOUR, ONE, FOUR]));
    expect(board.over).toStrictEqual({
      number: 1,
      chips: [{ text: '4', tone: 'boundary' }, run(1), { text: '4', tone: 'boundary' }],
    });
  });

  it('a super-over result shows the super over’s deliveries', () => {
    const board = boardOf([
      ...TIED_KO,
      ...superOverOf('A', player('H', 9), [ONE, ONE, ...times(4, DOT)]),
      ...superOverOf('H', player('A', 9), times(6, DOT)),
    ]);
    expect(board.result).not.toBeNull();
    expect(board.over).toStrictEqual({ number: 1, chips: times(6, DOT).map(() => dot) });
  });

  it('an innings break shows no over: the next innings has none yet', () => {
    expect(boardOf(FIRST_INNINGS_8).over).toBeNull();
  });

  it('play still shows the over under way: an over just ended reads the next, empty', () => {
    expect(boardOf(OVER_ONE_DONE).over).toStrictEqual({ number: 2, chips: [] });
  });
});

// T19 fix 10: a decided match's summary, off the scorecard. Worked from the script by hand: Home 1 all out, a single then ten
// wickets on ten balls (Home Player 1 is on strike again for the seventh ball, so faces two; A-p11 bowls the first over: 1 run, 5 wickets, 6 balls; A-p10 the second: 0 runs, 5 wickets, 5
// balls); Away then single, single (H-p11, 2 balls, 2 runs), winning at once.
describe('cricketBoard summary (T19 fix 10)', () => {
  const decided = [...ALL_OUT_FIRST, ...inningsOf('A', HOME_BOWLERS, [ONE, ONE])];

  it('a decided match has a block per main innings, in batting order', () => {
    const summary = boardOf(decided).summary;
    expect(summary?.map((block) => block.team)).toStrictEqual(['Home CC', 'Away CC']);
    expect(summary?.[0]?.top).toStrictEqual({ name: 'Home Player 1', runs: 1, balls: 2 });
    expect(summary?.[0]?.best).toStrictEqual({
      name: 'Away Player 10',
      wickets: 5,
      runs: 0,
      overs: '0.5',
    });
    // Both Away openers made 1 off 1: the earlier in the order.
    expect(summary?.[1]?.top).toStrictEqual({ name: 'Away Player 1', runs: 1, balls: 1 });
    expect(summary?.[1]?.best).toStrictEqual({
      name: 'Home Player 11',
      wickets: 0,
      runs: 2,
      overs: '0.2',
    });
  });

  it('none while the match is played, and none at a break', () => {
    expect(boardOf(OVER_ONE_DONE).summary).toBeNull();
    expect(boardOf(FIRST_INNINGS_8).summary).toBeNull();
  });

  it('super overs are left out: a tie decided there has the two main innings only', () => {
    const board = boardOf([
      ...TIED_KO,
      ...superOverOf('A', player('H', 9), [ONE, ONE, ...times(4, DOT)]),
      ...superOverOf('H', player('A', 9), times(6, DOT)),
    ]);
    expect(board.summary).toHaveLength(2);
  });
});
