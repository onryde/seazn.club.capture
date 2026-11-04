import type { EventEnvelope } from '@seazn/engine/core';
import { describe, expect, it } from 'vitest';
import {
  field,
  ledgerRows,
  summaryDone,
  type EventFacts,
  type LedgerEntry,
  type Recorded,
} from '@/domain/scoring/setBasedLedgerHistory';
import { namesOf, seatsOf } from '@/domain/scoring/setBasedSides';
import { AWAY, HOME, SINGLES } from '../../../test/badmintonLedger';

// History from the ledger for the set-based sports (lifted from badminton's, plan S2-2 fix round 1): the field reader,
// a set score in either of the forms the engine takes, and the rows of the entries the pad has words for.

const names = namesOf(seatsOf(SINGLES)!);

describe('field', () => {
  it('reads a payload’s field, and nothing from a payload that is not an object', () => {
    expect(field({ wonBy: HOME }, 'wonBy')).toBe(HOME);
    expect(field({ wonBy: HOME }, 'by')).toBeUndefined();
    for (const payload of [null, undefined, 'x', 7, ['wonBy']]) {
      expect(field(payload, 'wonBy')).toBeUndefined();
    }
  });
});

describe('summaryDone', () => {
  it('reads the positional form as the pad writes it: home on top', () => {
    expect(summaryDone(names, { home: 21, away: 15 })).toEqual({
      kind: 'setScore',
      first: 21,
      second: 15,
    });
  });

  it('reads the by-entrant form with the entrant’s own score first, whichever side that is', () => {
    expect(summaryDone(names, { by: HOME, forBy: 21, forOpp: 15 })).toEqual({
      kind: 'setScore',
      first: 21,
      second: 15,
    });
    expect(summaryDone(names, { by: AWAY, forBy: 21, forOpp: 15 })).toEqual({
      kind: 'setScore',
      first: 15,
      second: 21,
    });
  });

  // An empty and a garbled input: a score that names no numbers, or an entrant that is neither side, says nothing.
  it.each([
    [{}],
    [{ home: 21 }],
    [{ home: '21', away: 15 }],
    [{ by: 'ent-stranger', forBy: 21, forOpp: 15 }],
    [{ by: HOME, forBy: 21 }],
    [{ by: HOME, forBy: '21', forOpp: 15 }],
    [null],
    ['21-15'],
  ])('is null for %j', (payload) => {
    expect(summaryDone(names, payload)).toBeNull();
  });
});

describe('ledgerRows', () => {
  const envelope = (id: string, seq: number): EventEnvelope => ({
    id,
    fixtureId: 'fx',
    seq,
    type: 'x.rally',
    payload: {},
    recordedAt: '2026-11-03T10:00:00.000Z',
    recordedBy: null,
  });
  const facts = (game: number, first: number, second: number): EventFacts => ({
    game,
    after: { first, second },
    won: 'none',
    sanctionedPerson: null,
  });
  const entry = (id: string, more: Partial<LedgerEntry> = {}): LedgerEntry => ({
    envelope: envelope(id, 1),
    own: false,
    sending: false,
    ...more,
  });
  const recorded = new Map<string, Recorded<string>>([
    ['e1', { did: 'one', facts: facts(1, 1, 0) }],
    ['e2', { did: 'two', facts: facts(2, 0, 3) }],
  ]);

  it('is a row for each entry the pad has words for, in the match’s order, with its game and score', () => {
    const rows = ledgerRows([entry('e1'), entry('e2')], recorded, new Set());
    expect(rows).toEqual([
      {
        did: 'one',
        game: 1,
        after: { first: 1, second: 0 },
        own: false,
        undone: false,
        sending: false,
      },
      {
        did: 'two',
        game: 2,
        after: { first: 0, second: 3 },
        own: false,
        undone: false,
        sending: false,
      },
    ]);
  });

  it('skips an entry the pad has no words for', () => {
    const rows = ledgerRows([entry('e1'), entry('other'), entry('e2')], recorded, new Set());
    expect(rows.map((row) => row.did)).toEqual(['one', 'two']);
  });

  it('marks an entry a void takes back, an entry this phone recorded, and a tap still on its way', () => {
    const rows = ledgerRows(
      [entry('e1', { own: true, sending: true }), entry('e2')],
      recorded,
      new Set(['e2']),
    );
    expect(rows.map(({ own, undone, sending }) => [own, undone, sending])).toEqual([
      [true, false, true],
      [false, true, false],
    ]);
  });

  it('is no row at all for no entries', () => {
    expect(ledgerRows([], recorded, new Set())).toEqual([]);
  });
});
