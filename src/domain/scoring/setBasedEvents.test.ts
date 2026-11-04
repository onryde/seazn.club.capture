import { describe, expect, it, vi } from 'vitest';
import {
  payloadForFirstSend,
  rallyPayload,
  sanctionPayload,
  standing,
} from '@/domain/scoring/setBasedEvents';
import { seatsOf, type Seats } from '@/domain/scoring/setBasedSides';
import type { BootstrapSide } from '@/domain/scoring/wire';
import {
  DOUBLES,
  SINGLES,
  expedite,
  ledgerOf,
  queuedOf,
  rally,
  start,
  summary,
  timeout,
  voiding,
} from '../../../test/tableTennisLedger';

// Plan S2-2 Task 4 (design §6, the lift rule): what badminton's and table tennis's event files do the same way. The
// sport files keep their event types and the rules of their own (which serve is named, what ends a pick's life); these
// are the shared parts. Expected values are written out from the wire shape (engine SetBasedRally, SetBasedSanction),
// never computed by the code under test.

const seats = (bootstrap: typeof SINGLES): Seats => {
  const found = seatsOf(bootstrap);
  if (found === null) throw new Error('fixture has an empty seat');
  return found;
};

describe('rallyPayload', () => {
  it('names the winner’s entrant and, for a singles winner, the one player as scorer', () => {
    expect(rallyPayload(seats(SINGLES), 'second')).toStrictEqual({
      wonBy: 'ent-away',
      scorer: 'p-chen',
    });
  });

  it('names no scorer for a pair: the pad asks no player (S2 ruling 5)', () => {
    expect(rallyPayload(seats(DOUBLES), 'first')).toStrictEqual({ wonBy: 'ent-home' });
  });

  it('names the serving side as its entrant and the server as the person given', () => {
    expect(
      rallyPayload(seats(SINGLES), 'first', { serving: 'second', server: 'p-chen' }),
    ).toStrictEqual({
      wonBy: 'ent-home',
      serving: 'ent-away',
      server: 'p-chen',
      scorer: 'p-sharma',
    });
  });

  it('leaves out a serving side and a server that are null', () => {
    expect(rallyPayload(seats(DOUBLES), 'second', { serving: null, server: null })).toStrictEqual({
      wonBy: 'ent-away',
    });
  });

  it('carries the returns count when one is given, and nothing when not', () => {
    expect(rallyPayload(seats(DOUBLES), 'second', { returns: 13 })).toStrictEqual({
      wonBy: 'ent-away',
      returns: 13,
    });
    expect(rallyPayload(seats(DOUBLES), 'second', { returns: 0 })).toStrictEqual({
      wonBy: 'ent-away',
      returns: 0,
    });
  });
});

describe('sanctionPayload', () => {
  const [sharma, iyer] = [
    { personId: 'p-sharma', fullName: 'A. Sharma' },
    { personId: 'p-iyer', fullName: 'R. Iyer' },
  ];
  const pair: BootstrapSide = {
    entrantId: 'ent-home',
    name: 'A. Sharma / R. Iyer',
    kind: 'pair',
    members: [sharma, iyer],
    lineup: [],
  };
  const nobody: BootstrapSide = {
    entrantId: 'ent-team',
    name: 'Team Blue',
    kind: 'individual',
    members: [],
    lineup: [],
  };

  it('names the person by the id the bootstrap gave for the name offered', () => {
    expect(sanctionPayload(pair, 'penalty', 'R. Iyer')).toStrictEqual({
      by: 'ent-home',
      level: 'penalty',
      person: 'p-iyer',
    });
  });

  it('refuses a person the side does not list', () => {
    expect(sanctionPayload(pair, 'warning', 'L. Chen')).toBeNull();
    expect(sanctionPayload(pair, 'warning', 'Team Blue')).toBeNull();
  });

  it('is a team sanction, no person, for a side that lists no people and is offered as its own name', () => {
    expect(sanctionPayload(nobody, 'warning', 'Team Blue')).toStrictEqual({
      by: 'ent-team',
      level: 'warning',
    });
    expect(sanctionPayload(nobody, 'warning', 'Someone Else')).toBeNull();
  });

  it('is a sanction by the side alone when no person is given, whoever the side lists', () => {
    expect(sanctionPayload(pair, 'warning', null)).toStrictEqual({
      by: 'ent-home',
      level: 'warning',
    });
    expect(sanctionPayload(nobody, 'penalty', null)).toStrictEqual({
      by: 'ent-team',
      level: 'penalty',
    });
  });
});

describe('standing', () => {
  const RALLY = 'tabletennis.rally';
  const ledger = ledgerOf([
    start(), // 1
    rally({ wonBy: 'H' }), // 2
    timeout('A'), // 3
    rally({ wonBy: 'A' }), // 4
    voiding(2), // 5
  ]);

  it('lists the events of the type that no other event voids, in ledger order', () => {
    expect(standing(ledger, RALLY).map((event) => event.seq)).toEqual([4]);
  });

  it('lists nothing of a type the ledger does not hold, or of an empty ledger', () => {
    expect(standing(ledger, 'tabletennis.sanction')).toEqual([]);
    expect(standing([], RALLY)).toEqual([]);
  });

  it('counts a void as the event it is, not as a rally', () => {
    expect(standing(ledger, 'core.void').map((event) => event.seq)).toEqual([5]);
  });

  // Fix round 1: table tennis counts a point and a game score alike, so it asks for both types at once.
  it('lists the events of any of several types, in ledger order', () => {
    const scored = ledgerOf([
      start(),
      rally({ wonBy: 'H' }),
      summary(3, 2),
      timeout('A'),
      rally({ wonBy: 'A' }),
    ]);
    expect(standing(scored, RALLY, 'tabletennis.game.summary').map((event) => event.seq)).toEqual([
      2, 3, 5,
    ]);
  });

  // The fold counts the engine's envelopes, which name a void's target in `voids` and have none when they void nothing.
  it('reads an engine envelope as it reads a ledger event', () => {
    const envelopes = [
      { id: 'e1', type: RALLY },
      { id: 'e2', type: RALLY },
      { id: 'e3', type: 'core.void', voids: 'e1' },
    ];
    expect(standing(envelopes, RALLY).map((event) => event.id)).toEqual(['e2']);
  });
});

describe('payloadForFirstSend', () => {
  const ANCHOR = queuedOf('k-anchor', rally({ wonBy: 'H', serving: 'A' }));
  const dropped = { wonBy: 'ent-home' };

  it('sends the payload as queued when the anchor is not taken', () => {
    expect(payloadForFirstSend(ANCHOR, () => false, false)).toBe(ANCHOR.payload);
  });

  it('drops `serving` and keeps the rest of the tap when the anchor is taken', () => {
    expect(payloadForFirstSend(ANCHOR, () => true, false)).toEqual(dropped);
  });

  // After an interruption: a send may have reached the server. With its copy in the ledger the server holds the tap under
  // its key as first sent (it matches a resend by key and never compares payloads), so the tap is not changed.
  it('never changes a tap already sent while the ledger holds its copy', () => {
    const sent = { ...ANCHOR, attempts: 1 };
    expect(payloadForFirstSend(sent, () => true, true)).toBe(sent.payload);
  });

  // Fix round 2 (I2): with no copy the first attempt may never have been stored, and a resend is appended as new.
  it('judges a tap already sent as a first send when the ledger holds no copy of it', () => {
    const sent = { ...ANCHOR, attempts: 1 };
    expect(payloadForFirstSend(sent, () => true, false)).toEqual(dropped);
    expect(payloadForFirstSend(sent, () => false, false)).toBe(sent.payload);
  });

  it('changes no tap that names no `serving`', () => {
    for (const spec of [rally({ wonBy: 'H' }), timeout('H'), expedite()]) {
      const tap = queuedOf('k', spec);
      expect(payloadForFirstSend(tap, () => true, false)).toBe(tap.payload);
    }
  });

  it('keeps a payload that is not a record', () => {
    const odd = { ...ANCHOR, payload: 'serving' };
    expect(payloadForFirstSend(odd, () => true, false)).toBe('serving');
  });

  // The ledger is read only for a tap that could lose something: the pump asks for every send.
  it('asks the ledger nothing for a tap whose copy stands in it or one with no `serving`', () => {
    const taken = vi.fn(() => true);
    payloadForFirstSend({ ...ANCHOR, attempts: 2 }, taken, true);
    payloadForFirstSend(queuedOf('k', timeout('A')), taken, false);
    payloadForFirstSend({ ...queuedOf('k', timeout('A')), attempts: 2 }, taken, false);
    expect(taken).not.toHaveBeenCalled();
  });
});
