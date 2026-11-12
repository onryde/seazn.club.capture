import { foldEpochOf } from '@seazn/engine/sport';
import { volleyball } from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import { envelopeOf, setBasedCfgOf } from '@/domain/scoring/setBasedEngine';
import { isBeach, volleyballCfg, volleyballRefusalOf } from '@/domain/scoring/volleyballEngine';
import { volleyballLineupOf } from '@/domain/scoring/volleyballLineup';
import {
  BEACH,
  BEACH_CFG,
  INDOOR,
  ledgerOf,
  judgedLedgerOf,
  rally,
  start,
} from '../../../test/volleyballLedger';

// The engine adapter the fold and the fake server share (S2-6 Task 2).

const matchOf = (bootstrap: typeof INDOOR) => {
  const { home, away } = bootstrap.sides;
  if (home === null || away === null) throw new Error('seed has both sides');
  return {
    fixtureId: bootstrap.fixtureId,
    cfg: volleyballCfg(bootstrap.cfg),
    lineups: { home: volleyballLineupOf(home), away: volleyballLineupOf(away) },
  };
};

describe('volleyballCfg', () => {
  it('indoor is the default: best of 5, to 25, the deciding set to 15, win by 2', () => {
    const cfg = volleyballCfg({});
    expect([cfg.bestOf, cfg.setTo, cfg.finalSetTo, cfg.winBy]).toEqual([5, 25, 15, 2]);
    expect(cfg.records.substitutions).toBe(true);
  });

  it('beach is best of 3, to 21, with no substitutions', () => {
    const cfg = volleyballCfg(BEACH_CFG);
    expect([cfg.bestOf, cfg.setTo, cfg.finalSetTo]).toEqual([3, 21, 15]);
    expect(cfg.records.substitutions).toBe(false);
  });

  it('a garbled config is refused: the schema throws, and the fold’s reader answers null, never a throw', () => {
    expect(() => volleyballCfg({ bestOf: 'x' })).toThrow();
    expect(setBasedCfgOf(volleyball, { bestOf: 'x' })).toBeNull();
    expect(setBasedCfgOf(volleyball, null)).toBeNull();
  });
});

describe('isBeach', () => {
  it('reads the substitutions flag: indoor is not beach, beach is', () => {
    expect(isBeach(volleyballCfg({}))).toBe(false);
    expect(isBeach(volleyballCfg(BEACH_CFG))).toBe(true);
  });

  it('a beach config with bestOf 1 is still beach, and an indoor one with bestOf 3 is still indoor', () => {
    expect(isBeach(volleyballCfg({ ...BEACH_CFG, bestOf: 1 }))).toBe(true);
    expect(isBeach(volleyballCfg({ bestOf: 3 }))).toBe(false);
  });
});

describe('the volleyball engine’s epoch', () => {
  it('is read from the engine, and the fake seeds send it', () => {
    expect(INDOOR.epochRequired).toBe(foldEpochOf('volleyball'));
    expect(BEACH.epochRequired).toBe(foldEpochOf('volleyball'));
  });
});

describe('volleyballRefusalOf', () => {
  it('refuses nothing in an empty stream, and names the engine’s word for a rally before the start', () => {
    expect(volleyballRefusalOf(matchOf(INDOOR), [])).toBeNull();
    const [orphan] = ledgerOf([rally({ wonBy: 'H' })]);
    expect(
      orphan && volleyballRefusalOf(matchOf(INDOOR), [envelopeOf(INDOOR.fixtureId, orphan)]),
    ).toBe('WRONG_PHASE');
  });

  it('takes a start and a first rally on an indoor and a beach match (the ledger builder judges through it)', () => {
    expect(judgedLedgerOf(INDOOR, [start(), rally({ wonBy: 'H', serving: 'H' })])).toHaveLength(2);
    expect(judgedLedgerOf(BEACH, [start(), rally({ wonBy: 'A', serving: 'H' })])).toHaveLength(2);
  });

  it('refuses a substitution on a beach match and takes it on an indoor one', () => {
    const sub = { type: 'volleyball.sub', payload: { by: 'ent-home', off: 'h1', on: 'h7' } };
    const prefix = [start(), rally({ wonBy: 'H', serving: 'H' })];
    expect(() => judgedLedgerOf(BEACH, [...prefix, sub])).toThrow(/refused/);
    expect(judgedLedgerOf(INDOOR, [...prefix, sub])).toHaveLength(3);
  });
});
