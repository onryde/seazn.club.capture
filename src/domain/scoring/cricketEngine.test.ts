import { foldMatch, type EventEnvelope } from '@seazn/engine/core';
import { cricket, orderFromLineup } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import {
  cricketCfg,
  cricketMatchOf,
  cricketRefusalOf,
  playersEntered,
  type CricketEngineMatch,
} from '@/domain/scoring/cricketEngine';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  ALL_OUT_FIRST,
  FIRST_INNINGS_8,
  HOME,
  KO_2,
  LEAGUE_2,
  MATCH,
  NO_AWAY_PLAYERS,
  NO_SLOTS,
  OPENING,
  OVER_ONE_DONE,
  T20,
  T20_LONG,
  TIED_KO,
  TWO_INNINGS,
  ball,
  bowlerChange,
  declare,
  ledgerOf,
  player,
  retire,
  summary,
  superBall,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

/**
 * Cricket's engine input (S2-4 plan Task 4, spec §6): its config, its two lineups from the bootstrap's team sheets, and
 * the server's word on one new event. Every expected value is the Laws' or the engine's own code, written out.
 */

function matchOf(bootstrap: Bootstrap): CricketEngineMatch {
  const match = cricketMatchOf(bootstrap);
  if (match === null) throw new Error('a cricket fixture with two sides and a config');
  return match;
}

const envelopes = (specs: readonly Spec[]): EventEnvelope[] =>
  ledgerOf(specs).map((event) => envelopeOf(MATCH.fixtureId, event));

const refusalAfter = (specs: readonly Spec[], bootstrap: Bootstrap = MATCH) =>
  cricketRefusalOf(matchOf(bootstrap), envelopes(specs));

const foldOf = (specs: readonly Spec[], bootstrap: Bootstrap = MATCH) => {
  const match = matchOf(bootstrap);
  return foldMatch(cricket, match.cfg, match.lineups, envelopes(specs));
};

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);

/** A delivery of the first over (over 0), with the openers at the crease as they open. */
const firstOver = (ballInOver: number, more: Partial<Parameters<typeof ball>[0]> = {}) =>
  ball({ over: 0, ballInOver, striker: H(1), nonStriker: H(2), bowler: A(11), ...more });

describe('cricketCfg', () => {
  it('a 2-over cfg without minOversForResult is null', () => {
    expect(cricketCfg({ ballsPerInnings: 12, ballsPerOver: 6 })).toBeNull();
  });

  it('reads a format through the engine’s schema, which fills what the organiser left out', () => {
    expect(cricketCfg(KO_2)).toMatchObject({
      ballsPerInnings: 12,
      ballsPerOver: 6,
      maxOversPerBowler: 1,
      superOver: true,
      minOversForResult: 1,
      inningsPerSide: 1,
      playersPerSide: 11,
    });
  });

  it('reads every format the test ledger names', () => {
    expect([KO_2, LEAGUE_2, T20, TWO_INNINGS].map((cfg) => cricketCfg(cfg) !== null)).toStrictEqual(
      [true, true, true, true],
    );
  });

  it('a garbled config is null', () => {
    expect(cricketCfg({ ballsPerOver: 'six' })).toBeNull();
    expect(cricketCfg(null)).toBeNull();
  });
});

describe('cricketMatchOf', () => {
  it('builds each side’s lineup from its team sheet', () => {
    const match = matchOf(MATCH);
    expect(match.fixtureId).toBe('fx-cricket-1');
    expect(match.lineups.home).toStrictEqual(teamSheetOf(HOME).lineup);
    expect(match.lineups.away.entrantId).toBe('ent-away');
  });

  it('is null with a seat empty, or a config the engine refuses', () => {
    expect(cricketMatchOf({ ...MATCH, sides: { home: HOME, away: null } })).toBeNull();
    expect(cricketMatchOf(withCfg(MATCH, { ballsPerInnings: 12 }))).toBeNull();
  });
});

describe('the batting order', () => {
  it('the bench and the coach are not in the batting order', () => {
    expect(orderFromLineup(matchOf(MATCH).lineups.home)).toStrictEqual([
      'H-p1',
      'H-p2',
      'H-p3',
      'H-p4',
      'H-p5',
      'H-p6',
      'H-p7',
      'H-p8',
      'H-p9',
      'H-p10',
      'H-p11',
    ]);
  });

  it('with no team sheet every row bats, in the order sent', () => {
    expect(orderFromLineup(matchOf(NO_SLOTS).lineups.home)).toHaveLength(13);
  });
});

describe('cricketRefusalOf', () => {
  it('has no word for the toss, the start and a first ball naming the openers', () => {
    expect(refusalAfter([...OPENING, firstOver(1)])).toBeNull();
  });

  it('a bench batter is refused', () => {
    expect(refusalAfter([...OPENING, firstOver(1, { striker: H(12) })])).toStrictEqual({
      code: 'INVALID_EVENT',
      reason: null,
    });
  });

  it('a coach cannot bowl', () => {
    expect(refusalAfter([...OPENING, firstOver(1, { bowler: 'A-coach' })])).toStrictEqual({
      code: 'INVALID_EVENT',
      reason: null,
    });
  });

  it('a ball before the start is the wrong phase', () => {
    expect(refusalAfter([OPENING[0], firstOver(1)])?.code).toBe('WRONG_PHASE');
  });

  // CK-SS-1 (engine ruling 277, phone ruling 76): a hand strike swap sends the fold's pair reversed on the next ball.
  it('a reversed pair is taken and any other pair refused', () => {
    const opened = [...OPENING, firstOver(1)];
    expect(refusalAfter([...opened, firstOver(2, { striker: H(2), nonStriker: H(1) })])).toBeNull();
    expect(
      refusalAfter([...opened, firstOver(2, { striker: H(3), nonStriker: H(2) })]),
    ).toStrictEqual({
      code: 'INVALID_EVENT',
      reason: null,
    });
  });

  // CK-BC-1 (engine ruling 278, phone ruling 75; Law 17.8): T20, so the one-over cap is not what refuses the next over.
  it('a bowler change mid-over is taken; neither bowler may bowl the next over', () => {
    const t20 = withCfg(MATCH, T20);
    const changed = [
      ...OPENING,
      firstOver(1),
      firstOver(2),
      firstOver(3),
      bowlerChange(A(10), 'incapacitated'),
      firstOver(4, { bowler: A(10) }),
      firstOver(5, { bowler: A(10) }),
      firstOver(6, { bowler: A(10) }),
    ];
    expect(refusalAfter(changed.slice(0, 6), t20)).toBeNull();
    expect(refusalAfter(changed, t20)).toBeNull();
    // Dot balls: the over's end changes ends, so `H-p2` faces the second over.
    const next = (bowler: string) =>
      ball({ over: 1, ballInOver: 1, striker: H(2), nonStriker: H(1), bowler });
    expect(refusalAfter([...changed, next(A(11))], t20)?.code).toBe('INVALID_EVENT');
    expect(refusalAfter([...changed, next(A(10))], t20)?.code).toBe('INVALID_EVENT');
    expect(refusalAfter([...changed, next(A(9))], t20)).toBeNull();
  });
});

describe('the engine’s accounting', () => {
  it('a wide and two run is runs 3', () => {
    const state = foldOf([...OPENING, firstOver(1, { extras: { kind: 'wide', runs: 3 } })]);
    expect(state.innings[0]).toMatchObject({ runs: 3, legalBalls: 0, wickets: 0 });
  });
});

describe('playersEntered', () => {
  it('both sides with eleven starters are entered', () => {
    expect(playersEntered(matchOf(MATCH).lineups)).toStrictEqual({ first: true, second: true });
  });

  it('a side with no rows is not', () => {
    expect(playersEntered(matchOf(NO_AWAY_PLAYERS).lineups)).toStrictEqual({
      first: true,
      second: false,
    });
  });

  it('playersEntered is false for a side with one starter', () => {
    const lineups = matchOf(MATCH).lineups;
    const one = {
      ...lineups.home,
      slots: lineups.home.slots.map((slot, i) =>
        i === 0 ? slot : { ...slot, slot: 'bench' as const },
      ),
    };
    expect(playersEntered({ home: one, away: lineups.away })).toStrictEqual({
      first: false,
      second: true,
    });
    const two = {
      ...one,
      slots: one.slots.map((slot, i) => (i === 1 ? { ...slot, slot: 'starting' as const } : slot)),
    };
    expect(playersEntered({ home: two, away: lineups.away }).first).toBe(true);
  });

  it('a coach does not make up the two', () => {
    const lineups = matchOf(MATCH).lineups;
    const coached = {
      ...lineups.home,
      slots: lineups.home.slots.map((slot, i) =>
        i === 0
          ? slot
          : i === 1
            ? { ...slot, role: 'coach' as const }
            : { ...slot, slot: 'bench' as const },
      ),
    };
    expect(playersEntered({ home: coached, away: lineups.away }).first).toBe(false);
  });
});

// The fixtures are what a server takes: every event of each is judged as an append, strictly, as `cricketRefusalOf` does.
describe('the test ledger', () => {
  it.each([
    ['OVER_ONE_DONE', OVER_ONE_DONE],
    ['ALL_OUT_FIRST', ALL_OUT_FIRST],
    ['FIRST_INNINGS_8', FIRST_INNINGS_8],
    ['TIED_KO', TIED_KO],
  ])('%s is taken event by event', (_name, specs) => {
    const all = envelopes(specs);
    const refused = all.flatMap((_, i) => {
      const refusal = cricketRefusalOf(matchOf(MATCH), all.slice(0, i + 1));
      return refusal === null ? [] : [{ seq: i + 1, refusal }];
    });
    expect(refused).toStrictEqual([]);
  });

  it('T20_LONG is 280 events, taken event by event, and home wins by 122 runs', () => {
    const t20 = withCfg(MATCH, T20);
    const all = envelopes(T20_LONG);
    expect(all).toHaveLength(280);
    const refused = all.filter(
      (_, i) => cricketRefusalOf(matchOf(t20), all.slice(0, i + 1)) !== null,
    );
    expect(refused).toStrictEqual([]);
    const state = foldOf(T20_LONG, t20);
    expect(
      state.innings.map((innings) => [innings.runs, innings.wickets, innings.legalBalls]),
    ).toStrictEqual([
      [140, 0, 120],
      [18, 0, 120],
    ]);
    expect(state.margin).toStrictEqual({ kind: 'runs', value: 122 });
  });

  // The builders the later tasks lean on, each judged as an append once.
  it('a super-over ball after the tie is taken, the side that batted second batting first', () => {
    const first = superBall({
      over: 0,
      ballInOver: 1,
      striker: A(1),
      nonStriker: A(2),
      bowler: H(11),
    });
    expect(refusalAfter([...TIED_KO, first])).toBeNull();
    const home = superBall({
      over: 0,
      ballInOver: 1,
      striker: H(1),
      nonStriker: H(2),
      bowler: A(11),
    });
    expect(refusalAfter([...TIED_KO, home])?.code).toBe('INVALID_EVENT');
  });

  // Spec §4.10: with the fielding side not entered there is no bowler to name either, so both innings are totals.
  it('a side with no players is scored in over totals, and so is the innings it fields in', () => {
    const homeBall = [...OPENING, firstOver(1)];
    expect(refusalAfter(homeBall, NO_AWAY_PLAYERS)).toStrictEqual({
      code: 'INVALID_EVENT',
      reason: null,
    });
    const totals = [
      ...OPENING,
      summary(4, 0, 6),
      summary(8, 0, 12),
      summary(5, 0, 6),
      summary(9, 1, 11),
    ];
    const all = envelopes(totals);
    const match = matchOf(NO_AWAY_PLAYERS);
    expect(all.map((_, i) => cricketRefusalOf(match, all.slice(0, i + 1)))).toStrictEqual(
      all.map(() => null),
    );
    expect(foldOf(totals, NO_AWAY_PLAYERS).innings[1]).toMatchObject({
      runs: 9,
      wickets: 1,
      legalBalls: 11,
    });
  });

  it('a retirement, a void and a declaration are taken', () => {
    expect(refusalAfter([...OVER_ONE_DONE, retire(H(1), 'hurt')])).toBeNull();
    expect(refusalAfter([...OPENING, firstOver(1), voiding(3)])).toBeNull();
    const twoInnings = withCfg(MATCH, TWO_INNINGS);
    expect(refusalAfter([...OPENING, firstOver(1), declare()], twoInnings)).toBeNull();
  });

  it('the fixtures fold to the scores they say', () => {
    expect(foldOf(OVER_ONE_DONE).innings[0]).toMatchObject({ runs: 6, wickets: 0, legalBalls: 6 });
    expect(foldOf(ALL_OUT_FIRST).innings[0]).toMatchObject({
      runs: 1,
      wickets: 10,
      legalBalls: 11,
    });
    expect(foldOf(FIRST_INNINGS_8).innings[0]).toMatchObject({
      runs: 8,
      wickets: 0,
      legalBalls: 12,
    });
    const tied = foldOf(TIED_KO);
    expect(tied.innings.map((innings) => innings.runs)).toStrictEqual([8, 8]);
    expect(tied.phase).toBe('super_over');
  });
});
