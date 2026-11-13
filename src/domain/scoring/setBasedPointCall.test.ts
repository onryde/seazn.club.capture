import { foldMatch, type EventEnvelope, type FoldableModule } from '@seazn/engine/core';
import { badminton, type SetBasedCfg, type SetBasedState } from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import { badmintonCfg } from '@/domain/scoring/badmintonEngine';
import { envelopeOf, lineupOf } from '@/domain/scoring/setBasedEngine';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import { pointCallsOf, type PointCallInput } from '@/domain/scoring/setBasedPointCall';
import {
  HOME,
  AWAY,
  SINGLES,
  ledgerOf,
  rallies,
  rally,
  start,
} from '../../../test/badmintonLedger';

// The helper's two guards that a match's own ledger cannot reach: what an engine refusal does to a hypothetical point, and
// what a throw that is not the engine's refusal does. The rules themselves are tested per sport (`*PointCall.test.ts`).

const seats = seatsOf(SINGLES);
if (seats === null) throw new Error('the singles bootstrap has no seats');

const engine = {
  fixtureId: 'fx-1',
  cfg: badmintonCfg({}),
  lineups: {
    home: lineupOf(seats.first),
    away: lineupOf(seats.second),
  },
};

const envelopes: EventEnvelope[] = ledgerOf([
  start(),
  rally('H', 'H'),
  ...rallies('AH'.repeat(17) + 'HH'),
]).map((event) => envelopeOf('fx-1', event));

describe('pointCallsOf: faults', () => {
  const input = (over: Partial<PointCallInput>): PointCallInput => ({
    module: badminton,
    rally: 'badminton.rally',
    engine,
    entrants: { first: HOME, second: AWAY },
    envelopes,
    state: foldMatch(badminton, engine.cfg, engine.lineups, envelopes),
    golden: true,
    ...over,
  });

  it('calls the side on 20-17 with the engine’s own state (the contrast to the next test)', () => {
    expect(pointCallsOf(input({})).calls).toEqual({ first: 'game', second: null });
  });

  it('says nothing and calls nobody when the engine refuses the point (an entrant it does not know)', () => {
    const result = pointCallsOf(input({ entrants: { first: 'ent-nobody', second: 'ent-nobody' } }));
    expect(result).toEqual({ calls: { first: null, second: null }, fault: null });
  });

  it('names a throw that is not the engine’s refusal, never its message, and calls nobody', () => {
    const exploding = new Proxy({} as FoldableModule<SetBasedCfg, SetBasedState>, {
      get() {
        throw new TypeError('secret bytes dl_abc');
      },
    });
    const result = pointCallsOf(input({ module: exploding }));
    expect(result).toEqual({ calls: { first: null, second: null }, fault: 'TypeError' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('calls nobody for a match already decided or not live, without asking the engine', () => {
    const exploding = new Proxy({} as FoldableModule<SetBasedCfg, SetBasedState>, {
      get() {
        throw new TypeError('asked');
      },
    });
    for (const quiet of [{ outcome: { kind: 'win' } }, { phase: 'pre' }] as const) {
      const state = {
        phase: 'live',
        outcome: null,
        sets: [],
        ...quiet,
      } as unknown as SetBasedState;
      expect(pointCallsOf(input({ module: exploding, state }))).toEqual({
        calls: { first: null, second: null },
        fault: null,
      });
    }
  });
});
