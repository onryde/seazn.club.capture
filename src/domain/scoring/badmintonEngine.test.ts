import { describe, expect, it } from 'vitest';
import {
  badmintonCfg,
  envelopeOf,
  queuedEnvelopeOf,
  queuedEventId,
  refusalOf,
} from '@/domain/scoring/badmintonEngine';
import {
  AWAY,
  HOME,
  eventId,
  ledgerOf,
  queuedOf,
  rally,
  start,
  voiding,
} from '../../../test/badmintonLedger';

// The engine adapter the fold and the fake server share (plan S2-1 Task 7). The void's target travels in the envelope,
// where the engine reads it, whether the server holds the void or this phone has only queued it.

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
  it('carries a ledger void’s target in its envelope, and nothing for any other event', () => {
    const [first, , undo] = ledgerOf([start(), rally('H', 'H'), voiding(2)]);
    expect(first && envelopeOf('fx-1', first)).not.toHaveProperty('voids');
    expect(undo && envelopeOf('fx-1', undo)).toMatchObject({
      type: 'core.void',
      voids: eventId(2),
    });
  });

  it('carries a queued void’s target in its envelope, under an id no server event can have', () => {
    const envelope = queuedEnvelopeOf('fx-1', queuedOf('k-undo', voiding(2)), 3);
    expect(envelope).toMatchObject({ id: queuedEventId('k-undo'), seq: 3, voids: eventId(2) });
    expect(queuedEnvelopeOf('fx-1', queuedOf('k', rally('A')), 3)).not.toHaveProperty('voids');
  });

  // An empty input: nothing to judge is nothing refused.
  it('refuses nothing in an empty stream, and names the engine’s word for an event it refuses', () => {
    expect(refusalOf(MATCH, [])).toBeNull();
    const [orphan] = ledgerOf([rally('H')]);
    expect(orphan && refusalOf(MATCH, [envelopeOf('fx-1', orphan)])).toBe('WRONG_PHASE');
  });
});
