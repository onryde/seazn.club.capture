import { describe, expect, it } from 'vitest';
import { bootstrapToWire, parseBootstrap, type Bootstrap } from '@/domain/scoring/wire';
import { DOUBLES, SINGLES } from '../../../test/badmintonLedger';

// The boot cache (plan S2-1 Task 9) keeps a bootstrap as the endpoint's own envelope, so `parseBootstrap` is the one
// reader of that shape (AGENTS §4): what it writes, it reads back whole.
describe('bootstrapToWire', () => {
  it.each([
    ['singles', SINGLES],
    ['doubles', DOUBLES],
    ['a seat with no entrant', { ...SINGLES, sides: { home: SINGLES.sides.home, away: null } }],
    [
      'a match with no division or round',
      { ...SINGLES, context: { competition: 'Open', division: null, round: null, match: null } },
    ],
    ['a view-only reason', { ...SINGLES, screen: 'viewOnly', viewOnlyReason: 'finalized' }],
    ['the division not started', { ...SINGLES, screen: 'divisionNotStarted' }],
    ['a waiting match', { ...SINGLES, screen: 'waiting', status: 'scheduled', lastSeq: 0 }],
    [
      'a confirm screen',
      { ...SINGLES, screen: 'confirm', rulesVersion: 4, epochRequired: 3, lastSeq: 12 },
    ],
    ['a cfg with content', { ...SINGLES, cfg: { bestOf: 5, points: 15 } }],
  ] as readonly (readonly [string, Bootstrap])[])(
    'reads back %s as written',
    (_name, bootstrap) => {
      expect(parseBootstrap(bootstrapToWire(bootstrap))).toEqual(bootstrap);
    },
  );

  // S2-5 design §10: the team sheet on each lineup row. The boot cache keeps it, so a cached football match folds the
  // same pitch as a fresh one.
  it('bootstrapToWire then parseBootstrap round-trips every new field, and a row with none', () => {
    const home = SINGLES.sides.home;
    if (home === null) throw new Error('SINGLES has a home side');
    const sheet: Bootstrap = {
      ...SINGLES,
      sides: {
        home: {
          ...home,
          lineup: [
            {
              personId: 'p-gk',
              pairOrder: null,
              slot: 'starting',
              positionKey: 'GK',
              orderNo: 1,
              role: 'player',
              roles: ['captain', 'goalkeeper'],
              squadNumber: 0,
            },
            { personId: 'p-coach', pairOrder: null, slot: 'bench', orderNo: 17, role: 'coach' },
            { personId: 'p-old', pairOrder: 2 },
          ],
        },
        away: SINGLES.sides.away,
      },
    };
    expect(parseBootstrap(bootstrapToWire(sheet))).toStrictEqual(sheet);
  });

  it('writes a row with no team sheet as the web would: every field there, empty', () => {
    const wire = bootstrapToWire(SINGLES) as {
      data: { sides: { home: { lineup: Record<string, unknown>[] } } };
    };
    expect(wire.data.sides.home.lineup[0]).toStrictEqual({
      person_id: 'p-sharma',
      pair_order: null,
      slot: null,
      position_key: null,
      order_no: null,
      role: null,
      roles: [],
      squad_number: null,
    });
  });

  it("writes the endpoint's own words, as the web sends them", () => {
    const wire = bootstrapToWire(SINGLES) as { ok: boolean; data: Record<string, unknown> };
    expect(wire.ok).toBe(true);
    expect(wire.data).toMatchObject({
      fixture_id: 'fx-1',
      link_id: 'link-phone',
      sport_key: 'badminton',
      rules_version: 1,
      engine_epoch_required: 2,
      screen: 'pad',
      names: {
        competition: 'Spring Open 2026',
        division: 'U15 Boys Singles',
        round_label: 'Round 1',
        ref: 'Match 4',
      },
      state: { last_seq: 0, status: 'in_play' },
    });
  });
});
