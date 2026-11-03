import { describe, expect, it } from 'vitest';
import { badmintonCfg, refusalOf } from '@/domain/scoring/badmintonEngine';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { AWAY, HOME, ledgerOf, rally } from '../../../test/badmintonLedger';

// The engine adapter the fold and the fake server share (plan S2-1 Task 7): the server's judgement of one new event.
// The envelopes it judges are the set-based sports' (`setBasedEngine.test`).

const MATCH = {
  fixtureId: 'fx-1',
  cfg: badmintonCfg({}),
  lineups: {
    home: {
      entrantId: HOME,
      slots: [{ personId: 'p-sharma', slot: 'starting' as const, orderNo: 1 }],
    },
    away: {
      entrantId: AWAY,
      slots: [{ personId: 'p-chen', slot: 'starting' as const, orderNo: 1 }],
    },
  },
};

describe('badmintonEngine', () => {
  // An empty input: nothing to judge is nothing refused.
  it('refuses nothing in an empty stream, and names the engine’s word for an event it refuses', () => {
    expect(refusalOf(MATCH, [])).toBeNull();
    const [orphan] = ledgerOf([rally('H')]);
    expect(orphan && refusalOf(MATCH, [envelopeOf('fx-1', orphan)])).toBe('WRONG_PHASE');
  });
});
