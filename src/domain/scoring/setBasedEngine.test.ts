import { foldMatchWithStoppage } from '@seazn/engine/core';
import {
  badminton,
  setBasedServeContext,
  tabletennis,
  type SetBasedCfg,
} from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import {
  envelopeOf,
  lineupOf,
  queuedEnvelopeOf,
  queuedEventId,
  setBasedCfgOf,
  setBasedRefusalOf,
} from '@/domain/scoring/setBasedEngine';
import type { BootstrapSide } from '@/domain/scoring/wire';
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

// The engine adapter every set-based sport shares (plan S2-2 Task 2): the lineups the web builds from a side, and a
// ledger's events as the engine's envelopes. The void's target travels in the envelope, where the engine reads it,
// whether the server holds the void or this phone has only queued it.

/** A pair as the bootstrap sends it: the list's order is the names', the pair orders are the team sheet's. */
function pairSide(
  entrantId: string,
  members: readonly (readonly [string, string, number | null])[],
): BootstrapSide {
  return {
    entrantId,
    name: members.map(([, name]) => name).join(' / '),
    kind: 'pair',
    members: members.map(([personId, fullName]) => ({ personId, fullName })),
    lineup: members.map(([personId, , pairOrder]) => ({ personId, pairOrder })),
  };
}

describe('lineupOf', () => {
  it('carries each slot’s pair order into the lineup, as the web’s browser pad does', () => {
    const lineup = lineupOf(
      pairSide(HOME, [
        ['p-sharma', 'A. Sharma', 2],
        ['p-iyer', 'R. Iyer', 1],
      ]),
    );
    expect(lineup).toEqual({
      entrantId: HOME,
      slots: [
        { personId: 'p-sharma', slot: 'starting', orderNo: 2, pairOrder: 2 },
        { personId: 'p-iyer', slot: 'starting', orderNo: 1, pairOrder: 1 },
      ],
    });
  });

  // An empty input: a singles side, or a pair whose sheet never declared an order, has no pair order to carry.
  it('leaves pair order out of a slot that has none, and numbers it by its place in the list', () => {
    const lineup = lineupOf(
      pairSide(AWAY, [
        ['p-chen', 'L. Chen', null],
        ['p-wong', 'M. Wong', null],
      ]),
    );
    expect(lineup.slots).toEqual([
      { personId: 'p-chen', slot: 'starting', orderNo: 1 },
      { personId: 'p-wong', slot: 'starting', orderNo: 2 },
    ]);
    for (const slot of lineup.slots) expect(slot).not.toHaveProperty('pairOrder');
  });

  it('carries one slot’s pair order and not the next one’s when only one is declared', () => {
    const lineup = lineupOf(
      pairSide(HOME, [
        ['p-sharma', 'A. Sharma', null],
        ['p-iyer', 'R. Iyer', 1],
      ]),
    );
    expect(lineup.slots[0]).not.toHaveProperty('pairOrder');
    expect(lineup.slots[1]).toMatchObject({ orderNo: 1, pairOrder: 1 });
  });

  // The reason the order is carried: the engine names a doubles server from it, for table tennis alone
  // (`serverFromPairOrder`, engine sports/setbased/tabletennis.ts), and only from a lineup that declares it.
  it('lets the engine name the doubles server from the team sheet’s pair order, not the list’s', () => {
    const lineups = {
      home: lineupOf(
        pairSide(HOME, [
          ['p-sharma', 'A. Sharma', 2],
          ['p-iyer', 'R. Iyer', 1],
        ]),
      ),
      away: lineupOf(
        pairSide(AWAY, [
          ['p-chen', 'L. Chen', 1],
          ['p-wong', 'M. Wong', 2],
        ]),
      ),
    };
    const specs = ledgerOf([
      start(),
      { type: 'tabletennis.rally', payload: { wonBy: HOME, serving: HOME } },
    ]);
    const events = specs.map((event) => envelopeOf('fx-1', event));
    const cfg: SetBasedCfg = tabletennis.configSchema.parse({});
    const { state } = foldMatchWithStoppage(tabletennis, cfg, lineups, events);
    const serve = setBasedServeContext(tabletennis, state, events);
    expect(serve.servingSide).toBe(HOME);
    expect(serve.serverPersonId).toBe('p-iyer');
  });

  // Another sport: badminton names no doubles server (the engine says so), pair order or none.
  it('leaves badminton’s doubles server unnamed, with the pair order carried', () => {
    const lineups = {
      home: lineupOf(
        pairSide(HOME, [
          ['p-sharma', 'A. Sharma', 1],
          ['p-iyer', 'R. Iyer', 2],
        ]),
      ),
      away: lineupOf(
        pairSide(AWAY, [
          ['p-chen', 'L. Chen', 1],
          ['p-wong', 'M. Wong', 2],
        ]),
      ),
    };
    const events = ledgerOf([start(), rally('H', 'H')]).map((event) => envelopeOf('fx-1', event));
    const cfg: SetBasedCfg = badminton.configSchema.parse({});
    const { state } = foldMatchWithStoppage(badminton, cfg, lineups, events);
    expect(setBasedServeContext(badminton, state, events).serverPersonId).toBeNull();
  });
});

describe('setBasedEngine envelopes', () => {
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
});

// The engine's judgement of one new event, and the config read through a sport's schema (lifted from the two sports'
// engine files, plan S2-2 fix round 1): the module is the caller's, so the same events are judged by the sport's own rules.
describe('setBasedRefusalOf', () => {
  const cfgFor = (module: typeof badminton) => setBasedCfgOf(module, {});
  const matchOf = (module: typeof badminton) => {
    const cfg = cfgFor(module);
    if (cfg === null) throw new Error('the default config did not parse');
    return {
      fixtureId: 'fx-1',
      cfg,
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
  };
  const envelopes = (...events: ReturnType<typeof ledgerOf>) =>
    events.map((event) => envelopeOf('fx-1', event));

  it.each([
    ['badminton', badminton],
    ['tabletennis', tabletennis],
  ])(
    'refuses nothing in an empty stream, and a point before the start with the engine’s word (%s)',
    (_, module) => {
      expect(setBasedRefusalOf(module, matchOf(module), [])).toBeNull();
      const type = `${module.key}.rally`;
      const orphan = { ...ledgerOf([rally('H')])[0]!, type, payload: { wonBy: HOME } };
      expect(setBasedRefusalOf(module, matchOf(module), envelopes(orphan))).toBe('WRONG_PHASE');
    },
  );

  it('judges the last event strictly with everything before it replayed, by the module it is given', () => {
    const [begin, point] = ledgerOf([start(), rally('H', 'H')]);
    const mine = { ...point!, type: 'badminton.rally', payload: { wonBy: HOME, serving: HOME } };
    const stream = envelopes(begin!, mine);
    expect(setBasedRefusalOf(badminton, matchOf(badminton), stream)).toBeNull();
    // Table tennis has no event of that name: its engine refuses what badminton's takes.
    expect(setBasedRefusalOf(tabletennis, matchOf(tabletennis), stream)).not.toBeNull();
  });
});

describe('setBasedCfgOf', () => {
  it('fills what the organiser left out from the sport’s own schema', () => {
    expect(setBasedCfgOf(badminton, {})).toMatchObject({ bestOf: 3, setTo: 21 });
    expect(setBasedCfgOf(tabletennis, {})).toMatchObject({ bestOf: 5, setTo: 11 });
  });

  // An empty and a garbled input: the schema's refusal is all a throw can be, and it reads as null.
  it.each([['garbled'], [{ bestOf: 'many' }], [null]])(
    'is null for a config the schema refuses (%j)',
    (raw) => {
      expect(setBasedCfgOf(badminton, raw)).toBeNull();
      expect(setBasedCfgOf(tabletennis, raw)).toBeNull();
    },
  );
});
