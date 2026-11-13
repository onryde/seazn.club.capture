import { foldMatch } from '@seazn/engine/core';
import type { NestedState } from '@seazn/engine/sports/nested';
import { tennis } from '@seazn/engine/sports/tennis';
import { describe, expect, it } from 'vitest';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { tennisCfgOf, tennisLineupOf } from '@/domain/scoring/tennisEngine';
import {
  tennisCallPlate,
  tennisPointCallsOf,
  type TennisPointCallInput,
} from '@/domain/scoring/tennisPointCall';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  DOUBLES,
  DOUBLES_NOAD_CFG,
  GRAND_SLAM_CFG,
  HOME,
  SINGLES,
  forfeit,
  ledgerOf,
  points,
  sanction,
  start,
  toss,
  withCfg,
  type Spec,
} from '../../../test/tennisLedger';
import { display, gamesOf } from './tennisFold.testkit';

// Break point, set point and match point for tennis (owner, 2026-11-13), read off the engine by folding one more point for each
// side. The rule, written out here from the rules of tennis and never from the helper: a point that decides the match is MATCH
// POINT; else one that wins a set is SET POINT; else one that wins a normal game for the RECEIVER is BREAK POINT. The server's
// plain game point has none, and a tie-break has no break point. Top half = home. With no toss home serves game 1, away game 2,
// and so on (a tie-break aside); the receiver is read from the engine's server, never from the half's place. In a string of
// winners, `H` is a point (or a game) to home and `A` one to away.

const NONE = { first: null, second: null };
const calls = (specs: readonly Spec[], bootstrap: Bootstrap = SINGLES) => {
  const { calls: named } = display(specs, { bootstrap });
  if (named === undefined) throw new Error('the fold names calls');
  return named;
};

/** Love games, one per letter. */
const love = gamesOf;
/** A set won 6-0 by home or away: six love games. */
const sixLove = (side: 'H' | 'A') => love(side.repeat(6));
const M = [start()];

describe('tennis point calls: break point (the receiver wins a normal game)', () => {
  it('calls the receiver at 30-40, and nobody else: the server has no plate', () => {
    expect(calls([...M, ...points('HAHAA')])).toEqual({ first: null, second: 'break' });
  });

  it('calls the receiver at 15-40 and at 0-40', () => {
    expect(calls([...M, ...points('HAAA')])).toEqual({ first: null, second: 'break' });
    expect(calls([...M, ...points('AAA')])).toEqual({ first: null, second: 'break' });
  });

  it('calls the receiver at advantage out, and nobody at deuce', () => {
    expect(calls([...M, ...points('HHHAAAA')])).toEqual({ first: null, second: 'break' });
    expect(calls([...M, ...points('HHHAAA')])).toEqual(NONE);
  });

  it('calls nobody for the server at 40-15 (a plain game point), nor at love, 15-15 or 30-30', () => {
    expect(calls([...M, ...points('HHHA')])).toEqual(NONE);
    for (const winners of ['', 'HA', 'HHAA'])
      expect(calls([...M, ...points(winners)])).toEqual(NONE);
  });

  it('reads the receiver from who serves, in doubles too: game 2 is away’s, so home is called at 30-40', () => {
    expect(calls([...M, ...love('H'), ...points('AHAHH')], DOUBLES)).toEqual({
      first: 'break',
      second: null,
    });
    expect(calls([...M, ...points('HAHAA')], DOUBLES)).toEqual({ first: null, second: 'break' });
  });

  it('reads the receiver from the toss: away serves first, so home is called at 40-30', () => {
    expect(calls([toss('A'), ...M, ...points('HAHAH')])).toEqual({ first: 'break', second: null });
    expect(calls([toss('H'), ...M, ...points('HAHAH')])).toEqual(NONE);
  });
});

describe('tennis point calls: set point', () => {
  // Nine games 'HAHAHAHAA' leave away 5-4 up, and game 10 is away’s service.
  const awayFiveFour = love('HAHAHAHAA');

  it('calls the server for set point at 5-4 and 40-15', () => {
    expect(calls([...M, ...awayFiveFour, ...points('AAAH')])).toEqual({
      first: null,
      second: 'set',
    });
  });

  it('calls the receiver SET POINT, not break point, when breaking wins the set (home 5-4 up, 30-40 on away’s serve)', () => {
    expect(calls([...M, ...love('HAHAHAHAH'), ...points('AHAHH')])).toEqual({
      first: 'set',
      second: null,
    });
  });

  it('calls the leader at 5-3 and 40-0 (6-3 wins the set), and nobody at 5-4 on 15-15', () => {
    expect(calls([...M, ...love('HAHAHAHH'), ...points('HHH')])).toEqual({
      first: 'set',
      second: null,
    });
    expect(calls([...M, ...awayFiveFour, ...points('AH')])).toEqual(NONE);
  });

  it('calls only break point when the game would level the set at 5-5, and nobody for a server at 5-5', () => {
    expect(calls([...M, ...awayFiveFour, ...points('HHH')])).toEqual({
      first: 'break',
      second: null,
    });
    expect(calls([...M, ...love('HAHAHAHAHA'), ...points('HHH')])).toEqual(NONE);
  });
});

describe('tennis point calls: match point', () => {
  const oneAll = [...M, ...sixLove('H'), ...sixLove('A')];

  it('calls the side one point from the match in the final set, and only that side', () => {
    expect(calls([...oneAll, ...love('HHHHH'), ...points('HHH')])).toEqual({
      first: 'match',
      second: null,
    });
  });

  it('is MATCH point, not set or break point, for a receiver whose point wins the match', () => {
    const specs = [...oneAll, ...love('HHHHH'), ...points('HHH')];
    // 17 games have gone, so away serves and home is the receiver: break point would also be true.
    expect(display(specs).serving).toBe('second');
    expect(calls(specs).first).toBe('match');
  });

  it('is set point with a set to go: a best of 3 up 1-0 wins the match, a best of 5 up 1-1 only the set', () => {
    const upOne = [...M, ...sixLove('H'), ...love('HHHHH'), ...points('HHH')];
    expect(calls(upOne).first).toBe('match');
    const slam = withCfg(SINGLES, GRAND_SLAM_CFG);
    expect(calls([...oneAll, ...love('HHHHH'), ...points('HHH')], slam).first).toBe('set');
  });

  it('calls match point in a best of 5 at 2-1 up, and in the fifth set’s tie-break to 10', () => {
    const slam = withCfg(SINGLES, GRAND_SLAM_CFG);
    const twoOne = [...M, ...sixLove('H'), ...sixLove('A'), ...sixLove('H')];
    expect(calls([...twoOne, ...love('HHHHH'), ...points('HHH')], slam).first).toBe('match');
    const twoAll = [...twoOne, ...sixLove('A'), ...love('HAHAHAHAHAHA')];
    expect(calls([...twoAll, ...points('HA'.repeat(7) + 'HH')], slam)).toEqual({
      first: 'match',
      second: null,
    });
    expect(calls([...twoAll, ...points('HA'.repeat(9))], slam)).toEqual(NONE);
  });
});

describe('tennis point calls: the tie-break (no break point, only set or match point)', () => {
  const sixAll = love('HAHAHAHAHAHA');
  const final = [...M, ...sixLove('H'), ...sixLove('A'), ...sixAll];

  it('calls match point at 6-4, 6-5 and 7-6 in the final set’s tie-break, for the side that leads', () => {
    for (const winners of ['HAHAHAHAHH', 'HAHAHAHAHAH', 'HA'.repeat(6) + 'H'])
      expect(calls([...final, ...points(winners)]), winners).toEqual({
        first: 'match',
        second: null,
      });
  });

  it('calls nobody at 6-6 in the tie-break, nor at its start: one point cannot win it', () => {
    expect(calls([...final, ...points('HA'.repeat(6))])).toEqual(NONE);
    expect(calls(final)).toEqual(NONE);
  });

  it('calls set point, not match point, in the first set’s tie-break', () => {
    expect(calls([...M, ...sixAll, ...points('HAHAHAHAHH')])).toEqual({
      first: 'set',
      second: null,
    });
  });
});

describe('tennis point calls: the match tie-break to 10 (doubles’ deciding set)', () => {
  const noAd = withCfg(SINGLES, DOUBLES_NOAD_CFG);
  const oneAll = [...M, ...sixLove('H'), ...sixLove('A')];

  it('calls match point at 9-7, for the side on 9 only', () => {
    expect(calls([...oneAll, ...points('HA'.repeat(7) + 'HH')], noAd)).toEqual({
      first: 'match',
      second: null,
    });
  });

  it('calls nobody at 9-9, and nobody at the start', () => {
    expect(calls([...oneAll, ...points('HA'.repeat(9))], noAd)).toEqual(NONE);
    expect(calls(oneAll, noAd)).toEqual(NONE);
  });
});

describe('tennis point calls: no-ad games', () => {
  const noAd = withCfg(SINGLES, DOUBLES_NOAD_CFG);

  it('calls the receiver break point at the deciding point, and the server nothing', () => {
    expect(calls([...M, ...points('HHHAAA')], noAd)).toEqual({ first: null, second: 'break' });
  });

  it('calls both halves at once where the server’s deciding point wins the set: server SET POINT, receiver BREAK POINT', () => {
    expect(calls([...M, ...love('HAHAHAHAA'), ...points('AAAHHH')], noAd)).toEqual({
      first: 'break',
      second: 'set',
    });
  });
});

describe('tennis point calls: when no plate is shown', () => {
  it('calls nobody before the start, with a toss held but no start, and once the match is decided', () => {
    expect(calls([])).toEqual(NONE);
    expect(calls([toss('H')])).toEqual(NONE);
    expect(calls([...M, ...sixLove('H'), ...sixLove('H')])).toEqual(NONE);
  });

  it('calls nobody once the organiser has ended the match, or while a default waits for the forfeit', () => {
    expect(calls([...M, ...points('HHH'), forfeit('A', 'retired')])).toEqual(NONE);
    expect(calls([...M, ...points('HAHAA'), sanction('H', 'default')])).toEqual(NONE);
  });
});

describe('tennisPointCallsOf: faults', () => {
  const home = SINGLES.sides.home;
  const away = SINGLES.sides.away;
  if (home === null || away === null) throw new Error('the singles seed has both sides');
  const cfg = tennisCfgOf(SINGLES.cfg);
  if (cfg === null) throw new Error('the singles seed has a config');
  const engine = {
    fixtureId: SINGLES.fixtureId,
    cfg,
    lineups: { home: tennisLineupOf(home), away: tennisLineupOf(away) },
  };

  const inputOf = (specs: readonly Spec[], over: Partial<TennisPointCallInput> = {}) => {
    const envelopes = ledgerOf(specs).map((event) => envelopeOf(SINGLES.fixtureId, event));
    return {
      engine,
      entrants: { first: HOME, second: AWAY },
      envelopes,
      state: foldMatch(tennis, cfg, engine.lineups, envelopes),
      serving: 'first',
      ...over,
    } satisfies TennisPointCallInput;
  };

  it('calls the receiver on the engine’s own state (the contrast to the next tests)', () => {
    expect(tennisPointCallsOf(inputOf([...M, ...points('HAHAA')])).calls).toEqual({
      first: null,
      second: 'break',
    });
  });

  it('names no receiver, so no break point, when the engine cannot name the server', () => {
    const result = tennisPointCallsOf(inputOf([...M, ...points('HAHAA')], { serving: null }));
    expect(result).toEqual({ calls: NONE, fault: null });
  });

  it('says nothing and calls nobody when the engine refuses the point (a default waits for its forfeit)', () => {
    const specs = [...M, ...points('HAHAA'), sanction('H', 'default')];
    expect(tennisPointCallsOf(inputOf(specs))).toEqual({ calls: NONE, fault: null });
  });

  it('names a throw that is not the engine’s refusal, never its message, and calls nobody', () => {
    const lineups = { home: null, away: null } as unknown as typeof engine.lineups;
    const result = tennisPointCallsOf(
      inputOf([...M, ...points('HAHAA')], { engine: { ...engine, lineups } }),
    );
    expect(result).toEqual({ calls: NONE, fault: 'TypeError' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('calls nobody for a match already decided or not live, without asking the engine', () => {
    const live = inputOf([...M, ...points('HAHAA')]);
    for (const quiet of [{ outcome: { kind: 'win' } }, { phase: 'pre' }]) {
      const state = { ...live.state, ...quiet } as unknown as NestedState;
      const lineups = { home: null, away: null } as unknown as typeof engine.lineups;
      const asked = { ...live, state, engine: { ...engine, lineups } };
      expect(tennisPointCallsOf(asked)).toEqual({ calls: NONE, fault: null });
    }
  });
});

describe('tennisCallPlate', () => {
  it('words each call, the match point with badminton’s own key, drawn and said alike', () => {
    expect(tennisCallPlate('break', true)).toEqual({
      text: { key: 'scoring.pad.call.breakPoint' },
      said: { key: 'scoring.pad.call.breakPoint' },
    });
    expect(tennisCallPlate('set', true)?.text).toEqual({ key: 'scoring.pad.call.setPoint' });
    expect(tennisCallPlate('match', true)?.said).toEqual({ key: 'scoring.pad.call.matchPoint' });
  });

  it('draws none for no call, or on a half that takes no tap', () => {
    expect(tennisCallPlate(null, true)).toBeNull();
    expect(tennisCallPlate(undefined, true)).toBeNull();
    expect(tennisCallPlate('match', false)).toBeNull();
  });
});
