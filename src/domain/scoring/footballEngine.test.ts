import { foldMatch, type LineupPair } from '@seazn/engine/core';
import { football } from '@seazn/engine/sports/football';
import { describe, expect, it } from 'vitest';
import {
  footballCfg,
  footballLineupOf,
  footballOptions,
  footballRefusalOf,
  type FootballEngineMatch,
} from '@/domain/scoring/footballEngine';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import type { Bootstrap, BootstrapSide } from '@/domain/scoring/wire';
import {
  AWAY,
  CAPPED,
  HOME,
  KO_11,
  LEAGUE_11,
  MATCH,
  MINI,
  NO_SHEET,
  NO_SLOTS,
  at,
  goal,
  ledgerOf,
  start,
  sub,
  withCfg,
  type Spec,
} from '../../../test/footballLedger';

/**
 * S2-5 design §9 and §10: football's engine input, its two lineups built from the bootstrap's team sheets as the web's
 * server fold builds them (`server/engine-db/lineups.ts` `buildLineup`), so the phone and the console fold the same
 * pitch. Every expected squad is the team sheet's, written out: 1–11 start, 12–16 sit on the bench (the Laws: eleven a
 * side).
 */
const ids = (prefix: 'H' | 'A', from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-p${from + i}`);

function matchOf(bootstrap: Bootstrap): FootballEngineMatch {
  const cfg = footballCfg(bootstrap.cfg);
  const { home, away } = bootstrap.sides;
  if (cfg === null || home === null || away === null) throw new Error('a football fixture');
  return {
    fixtureId: bootstrap.fixtureId,
    cfg,
    lineups: { home: footballLineupOf(home).lineup, away: footballLineupOf(away).lineup },
  };
}

const envelopes = (match: FootballEngineMatch, specs: readonly Spec[]) =>
  ledgerOf(specs).map((event) => envelopeOf(match.fixtureId, event));

function squadsAfter(bootstrap: Bootstrap, specs: readonly Spec[]) {
  const match = matchOf(bootstrap);
  return foldMatch(football, match.cfg, match.lineups, envelopes(match, specs)).squads;
}

const refusalAfter = (bootstrap: Bootstrap, specs: readonly Spec[]) => {
  const match = matchOf(bootstrap);
  return footballRefusalOf(match, envelopes(match, specs));
};

describe('footballLineupOf', () => {
  it('starting and bench rows fold to 11 on the pitch and 5 on the bench', () => {
    const squads = squadsAfter(MATCH, [start()]);
    expect(squads.home.onPitch).toEqual(ids('H', 1, 11));
    expect(squads.home.bench).toEqual(ids('H', 12, 16));
    expect(squads.away.onPitch).toEqual(ids('A', 1, 11));
    expect(squads.away.bench).toEqual(ids('A', 12, 16));
  });

  it('a team-sheet row is the engine’s slot as the web’s server builds it', () => {
    const side: BootstrapSide = {
      ...HOME,
      lineup: [
        {
          personId: 'H-gk',
          pairOrder: null,
          slot: 'bench',
          orderNo: 12,
          positionKey: 'GK',
          roles: ['captain'],
          role: 'player',
          squadNumber: 14,
        },
        { personId: 'H-coach', pairOrder: null, slot: 'bench', orderNo: 20, role: 'staff' },
        { personId: 'H-late', pairOrder: 1, slot: 'starting' },
      ],
    };
    expect(footballLineupOf(side)).toStrictEqual({
      lineup: {
        entrantId: 'ent-home',
        slots: [
          {
            personId: 'H-gk',
            slot: 'bench',
            orderNo: 12,
            positionKey: 'GK',
            roles: ['captain'],
            squadNumber: 14,
          },
          { personId: 'H-coach', slot: 'bench', orderNo: 20, role: 'staff' },
          // No order on the sheet: the row's place, from 1 (`order_no ?? i + 1`); a pair order is not football's.
          { personId: 'H-late', slot: 'starting', orderNo: 3 },
        ],
      },
      sheet: true,
    });
  });

  // The web sends a slot on every row; a row without one among rows that have one is read as a sheetless row is.
  it('one row with a slot makes it a team sheet; a row without one there starts', () => {
    const side: BootstrapSide = {
      ...HOME,
      lineup: [
        { personId: 'H-p12', pairOrder: null, slot: 'bench', orderNo: 12 },
        { personId: 'H-p1', pairOrder: null, squadNumber: 1 },
      ],
    };
    expect(footballLineupOf(side)).toStrictEqual({
      lineup: {
        entrantId: 'ent-home',
        slots: [
          { personId: 'H-p12', slot: 'bench', orderNo: 12 },
          { personId: 'H-p1', slot: 'starting', orderNo: 2, squadNumber: 1 },
        ],
      },
      sheet: true,
    });
  });

  it('a coach row is not on the pitch', () => {
    const coach = {
      personId: 'H-coach',
      pairOrder: null,
      slot: 'starting',
      orderNo: 17,
      role: 'coach',
    } as const;
    const withCoach: Bootstrap = {
      ...MATCH,
      sides: { home: { ...HOME, lineup: [...HOME.lineup, coach] }, away: AWAY },
    };
    const squads = squadsAfter(withCoach, [start()]);
    expect(squads.home.onPitch).toEqual(ids('H', 1, 11));
    expect(squads.home.bench).toEqual(ids('H', 12, 16));
    expect(squads.home.nonPlayers).toEqual(['H-coach']);
  });

  it('squadNumber 0 reaches the slot', () => {
    const side: BootstrapSide = {
      ...HOME,
      lineup: [{ personId: 'H-p1', pairOrder: null, slot: 'starting', orderNo: 1, squadNumber: 0 }],
    };
    expect(footballLineupOf(side).lineup.slots[0]?.squadNumber).toBe(0);
  });

  it('rows with no slot fold as all starting', () => {
    const home = NO_SLOTS.sides.home;
    if (home === null) throw new Error('NO_SLOTS has a home side');
    const { lineup, sheet } = footballLineupOf(home);
    expect(sheet).toBe(false);
    expect(lineup.slots.slice(0, 2)).toStrictEqual([
      { personId: 'H-p1', slot: 'starting', orderNo: 1 },
      { personId: 'H-p2', slot: 'starting', orderNo: 2 },
    ]);
    const squads = squadsAfter(NO_SLOTS, [start()]);
    expect(squads.home.onPitch).toEqual(ids('H', 1, 16));
    expect(squads.home.bench).toEqual([]);
  });

  // With no slot on any row there is no sheet to read: a number or an order such a row carries is not used.
  it('sheetless rows start in the order listed, and carry nothing of a sheet', () => {
    const side: BootstrapSide = {
      ...HOME,
      lineup: [
        { personId: 'H-p9', pairOrder: null, orderNo: 9, squadNumber: 9 },
        { personId: 'H-p4', pairOrder: null, orderNo: 4, positionKey: 'CB' },
      ],
    };
    expect(footballLineupOf(side)).toStrictEqual({
      lineup: {
        entrantId: 'ent-home',
        slots: [
          { personId: 'H-p9', slot: 'starting', orderNo: 1 },
          { personId: 'H-p4', slot: 'starting', orderNo: 2 },
        ],
      },
      sheet: false,
    });
  });

  // The controller's ruling of 2026-11-08 (agreed with S2-4, superseding item 7 of the Batch B rulings): the web's
  // bootstrap orders the rows as the server's `buildLineup` does (`order_no` nulls last, `full_name`, `person_id`), so the
  // phone keeps them exactly as they arrive and never sorts them again. These rows are in an order that sorting by
  // person id (H-p2, H-p5, H-p9), by name (Abe, Mo, Zed) or by order number (1, 2) would each change.
  it('rows keep the order they arrive in', () => {
    const side: BootstrapSide = {
      ...HOME,
      members: [
        { personId: 'H-p9', fullName: 'Zed' },
        { personId: 'H-p2', fullName: 'Abe' },
        { personId: 'H-p5', fullName: 'Mo' },
      ],
      lineup: [
        { personId: 'H-p9', pairOrder: null, slot: 'starting', orderNo: 2 },
        { personId: 'H-p2', pairOrder: null, slot: 'starting', orderNo: 1 },
        { personId: 'H-p5', pairOrder: null, slot: 'bench' },
      ],
    };
    expect(footballLineupOf(side).lineup.slots.map((slot) => slot.personId)).toEqual([
      'H-p9',
      'H-p2',
      'H-p5',
    ]);
  });

  // The wire's `order_no: null` is read as no order (`wire.ts`); such a row is numbered by its place in the order it came in.
  it('a null orderNo is numbered by position', () => {
    const side: BootstrapSide = {
      ...HOME,
      lineup: [
        { personId: 'H-p7', pairOrder: null, slot: 'starting', orderNo: 1 },
        { personId: 'H-p3', pairOrder: null, slot: 'starting' },
        { personId: 'H-p8', pairOrder: null, slot: 'bench', orderNo: 12 },
        { personId: 'H-p1', pairOrder: null, slot: 'bench' },
      ],
    };
    expect(
      footballLineupOf(side).lineup.slots.map((slot) => [slot.personId, slot.orderNo]),
    ).toEqual([
      ['H-p7', 1],
      ['H-p3', 2],
      ['H-p8', 12],
      ['H-p1', 4],
    ]);
  });

  it('no rows folds with an empty lineup', () => {
    const home = NO_SHEET.sides.home;
    if (home === null) throw new Error('NO_SHEET has a home side');
    expect(footballLineupOf(home)).toStrictEqual({
      lineup: { entrantId: 'ent-home', slots: [] },
      sheet: false,
    });
    const squads = squadsAfter(NO_SHEET, [start(), goal({ by: 'H' })]);
    expect(squads.home.onPitch).toEqual([]);
    expect(squads.home.bench).toEqual([]);
  });
});

describe('footballRefusalOf', () => {
  it('a bench scorer is refused INVALID_EVENT', () => {
    expect(refusalAfter(MATCH, [start(), goal({ by: 'H', scorer: 'H-p12' })])).toEqual({
      code: 'INVALID_EVENT',
      reason: null,
    });
    expect(refusalAfter(MATCH, [start(), goal({ by: 'H', scorer: 'H-p9' })])).toBeNull();
  });

  it('a goal before kick-off is refused WRONG_PHASE', () => {
    expect(refusalAfter(MATCH, [goal({ by: 'A' })])).toEqual({ code: 'WRONG_PHASE', reason: null });
  });

  // The Laws: five substitutions in three windows. A window is the stoppage the subs share (`at`).
  it('SUB_WINDOW_EXCEEDED is answered with its code', () => {
    const capped = withCfg(MATCH, CAPPED);
    const three = [
      start(),
      sub({ by: 'H', off: 'H-p2', on: 'H-p12', at: at('H1', 600) }),
      sub({ by: 'H', off: 'H-p3', on: 'H-p13', at: at('H1', 1200) }),
      sub({ by: 'H', off: 'H-p4', on: 'H-p14', at: at('H1', 1800) }),
    ];
    expect(refusalAfter(capped, three)).toBeNull();
    const fourth = sub({ by: 'H', off: 'H-p5', on: 'H-p15', at: at('H1', 2400) });
    expect(refusalAfter(capped, [...three, fourth])).toEqual({
      code: 'SUB_WINDOW_EXCEEDED',
      reason: null,
    });
  });

  it('a cap of maxSubs answers reason sub-cap-reached', () => {
    const capped = withCfg(MATCH, CAPPED);
    const five = [
      start(),
      sub({ by: 'H', off: 'H-p2', on: 'H-p12' }),
      sub({ by: 'H', off: 'H-p3', on: 'H-p13' }),
      sub({ by: 'H', off: 'H-p4', on: 'H-p14' }),
      sub({ by: 'H', off: 'H-p5', on: 'H-p15' }),
      sub({ by: 'H', off: 'H-p6', on: 'H-p16' }),
    ];
    expect(refusalAfter(capped, five)).toBeNull();
    const sixth = sub({ by: 'H', off: 'H-p7', on: 'H-p2' });
    expect(refusalAfter(capped, [...five, sixth])).toEqual({
      code: 'INVALID_EVENT',
      reason: 'sub-cap-reached',
    });
  });

  it('judges only the last event: one already in the ledger is replayed, not judged again', () => {
    const capped = withCfg(MATCH, CAPPED);
    const subs = ['2', '3', '4', '5', '6', '7'].map((n, i) =>
      sub({ by: 'H', off: `H-p${n}`, on: `H-p${12 + i}` }),
    );
    // Six substitutions where five are allowed, the sixth already in the ledger: a goal after it is judged alone.
    const sixDone = [start(), ...subs.slice(0, 5), sub({ by: 'H', off: 'H-p7', on: 'H-p2' })];
    expect(refusalAfter(capped, [...sixDone, goal({ by: 'H' })])).toBeNull();
  });

  it('no events is no refusal', () => {
    expect(footballRefusalOf(matchOf(MATCH), [])).toBeNull();
  });

  it('anything but the engine’s own refusal is thrown', () => {
    const match = matchOf(MATCH);
    const broken = { ...match, lineups: undefined as unknown as LineupPair };
    expect(() => footballRefusalOf(broken, envelopes(match, [start()]))).toThrow(TypeError);
  });
});

describe('footballCfg', () => {
  it('reads a knockout tie’s config, the engine’s defaults filled in', () => {
    expect(footballCfg(KO_11)).toMatchObject({
      halves: 2,
      halfMinutes: 45,
      extraTime: { enabled: true, halfMinutes: 15 },
      shootout: true,
      sinBinMinutes: 10,
    });
  });

  it('each test config is one the engine takes', () => {
    for (const cfg of [KO_11, LEAGUE_11, MINI, CAPPED]) expect(footballCfg(cfg)).not.toBeNull();
  });

  it('a garbled cfg is null', () => {
    expect(footballCfg({ halves: 3 })).toBeNull();
    expect(footballCfg({ halfMinutes: 'forty-five' })).toBeNull();
    expect(footballCfg('football')).toBeNull();
    expect(footballCfg(null)).toBeNull();
  });
});

describe('footballOptions', () => {
  // Read from the engine's own schema, never a copy: a shot outcome the engine adds reaches the pad with no edit here.
  it('footballOptions reads saved, missed, blocked and scored', () => {
    expect([...footballOptions('football.shot', 'outcome')].sort()).toEqual([
      'blocked',
      'missed',
      'saved',
      'scored',
    ]);
  });
});
