import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { sportFor } from '@/domain/scoring/sports';
import { tennisCfgOf, tennisLineupOf, tennisRefusalOf } from '@/domain/scoring/tennisEngine';
import type { BootstrapSide } from '@/domain/scoring/wire';
import {
  DOUBLES,
  DOUBLES_NOAD_CFG,
  FAST4_CFG,
  GRAND_SLAM_CFG,
  SINGLES,
  TOUR_CFG,
  award,
  game,
  judgedLedgerOf,
  ledgerOf,
  point,
  points,
  sanction,
  start,
} from '../../../test/tennisLedger';

// The engine adapter the fold and the fake server share (S2-7 Task 3).

const matchOf = (bootstrap: typeof SINGLES) => {
  const { home, away } = bootstrap.sides;
  if (home === null || away === null) throw new Error('seed has both sides');
  const cfg = tennisCfgOf(bootstrap.cfg);
  if (cfg === null) throw new Error('seed has a good cfg');
  return {
    fixtureId: bootstrap.fixtureId,
    cfg,
    lineups: { home: tennisLineupOf(home), away: tennisLineupOf(away) },
  };
};

describe('tennisCfgOf', () => {
  it('the Tour defaults: best of 3, sets to 6, a tie-break at 6 to 7, ad games', () => {
    const cfg = tennisCfgOf(TOUR_CFG);
    expect(cfg && [cfg.bestOf, cfg.set.gamesTo, cfg.set.tiebreakAt, cfg.set.tiebreakTo]).toEqual([
      3, 6, 6, 7,
    ]);
    expect(cfg?.game.noAd).toBe(false);
    expect(cfg?.finalSet).toBe('same');
  });

  it('doubles no-ad: no-ad games and a match tie-break to 10 as the deciding set', () => {
    const cfg = tennisCfgOf(DOUBLES_NOAD_CFG);
    expect(cfg?.game.noAd).toBe(true);
    expect(cfg?.finalSet).toEqual({ matchTiebreakTo: 10 });
  });

  it('Grand Slam is best of 5 with a deciding-set tie-break to 10; Fast4 is sets to 4, a tie-break at 3', () => {
    const slam = tennisCfgOf(GRAND_SLAM_CFG);
    expect([slam?.bestOf, slam?.finalSet]).toEqual([5, { tiebreakTo: 10 }]);
    const fast4 = tennisCfgOf(FAST4_CFG);
    expect([fast4?.set.gamesTo, fast4?.set.tiebreakAt, fast4?.set.tiebreakTo]).toEqual([4, 3, 5]);
  });

  it('a garbled config answers null, never a throw', () => {
    expect(tennisCfgOf({ bestOf: 'x' })).toBeNull();
    expect(tennisCfgOf(null)).toBeNull();
    expect(tennisCfgOf(7)).toBeNull();
  });
});

describe('the tennis engine’s epoch and the unscored sport', () => {
  it('the seeds send the engine’s own epoch', () => {
    expect(SINGLES.epochRequired).toBe(foldEpochOf('tennis'));
    expect(DOUBLES.epochRequired).toBe(foldEpochOf('tennis'));
  });

  it('hockey is a sport this build does not score', () => {
    expect(sportFor('hockey')).toBeNull();
  });
});

describe('tennisRefusalOf', () => {
  it('refuses nothing in an empty stream, and names WRONG_PHASE for a point before the start', () => {
    expect(tennisRefusalOf(matchOf(SINGLES), [])).toBeNull();
    const [orphan] = ledgerOf([point('H')]);
    expect(
      orphan && tennisRefusalOf(matchOf(SINGLES), [envelopeOf(SINGLES.fixtureId, orphan)]),
    ).toBe('WRONG_PHASE');
  });

  it('takes a start and points on a singles and a doubles match (the ledger builder judges through it)', () => {
    expect(judgedLedgerOf(SINGLES, [start(), ...points('HAH')])).toHaveLength(4);
    expect(judgedLedgerOf(DOUBLES, [start(), ...game('A')])).toHaveLength(5);
  });

  it('the fake judges a point after a default as refused (TN-SE-1), and a game award as taken', () => {
    expect(() => judgedLedgerOf(SINGLES, [start(), sanction('A', 'default'), point('H')])).toThrow(
      /ENDING_SANCTION_PENDING/,
    );
    expect(judgedLedgerOf(SINGLES, [start(), award('H')])).toHaveLength(2);
  });
});

describe('tennisLineupOf', () => {
  const side = (lineup: BootstrapSide['lineup']): BootstrapSide => ({
    entrantId: 'ent-1',
    name: 'Side',
    kind: 'pair',
    members: [],
    lineup,
  });

  it('is the web’s field for field: the sheet’s slot, order, a position, a shirt number and the pair order', () => {
    expect(
      tennisLineupOf(
        side([
          { personId: 'a', pairOrder: 1, slot: 'starting', orderNo: 1, squadNumber: 9 },
          { personId: 'b', pairOrder: 2, slot: 'starting', orderNo: 2, positionKey: 'baseline' },
        ]),
      ),
    ).toEqual({
      entrantId: 'ent-1',
      slots: [
        { personId: 'a', slot: 'starting', orderNo: 1, squadNumber: 9, pairOrder: 1 },
        { personId: 'b', slot: 'starting', orderNo: 2, positionKey: 'baseline', pairOrder: 2 },
      ],
    });
  });

  it('a singles player has no pair order, and a coach row keeps role coach', () => {
    expect(
      tennisLineupOf(
        side([
          { personId: 'p', pairOrder: null, slot: 'starting', orderNo: 1, role: 'player' },
          { personId: 'c', pairOrder: null, slot: 'bench', orderNo: 2, role: 'coach' },
        ]),
      ).slots,
    ).toEqual([
      { personId: 'p', slot: 'starting', orderNo: 1 },
      { personId: 'c', slot: 'bench', orderNo: 2, role: 'coach' },
    ]);
  });

  it('rows with no slot (a web older than the sheet) all start, numbered in the order listed; no rows, no slots', () => {
    expect(
      tennisLineupOf(
        side([
          { personId: 'a', pairOrder: 2 },
          { personId: 'b', pairOrder: 1 },
        ]),
      ).slots,
    ).toEqual([
      { personId: 'a', slot: 'starting', orderNo: 1, pairOrder: 2 },
      { personId: 'b', slot: 'starting', orderNo: 2, pairOrder: 1 },
    ]);
    expect(tennisLineupOf(side([]))).toEqual({ entrantId: 'ent-1', slots: [] });
  });
});
