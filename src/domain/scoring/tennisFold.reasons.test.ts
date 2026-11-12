import { AWARD_REASONS, FORFEIT_REASONS } from '@seazn/engine/core';
import type { NestedState } from '@seazn/engine/sports/nested';
import { describe, expect, it } from 'vitest';
import { namesOf, seatsOf } from '@/domain/scoring/setBasedSides';
import { endingOf } from '@/domain/scoring/tennisFold';
import { display } from '@/domain/scoring/tennisFold.testkit';
import { endingKindOf, tennisDoneOf } from '@/domain/scoring/tennisLedgerHistory';
import { AWAY, SINGLES, forfeit, point, start } from '../../../test/tennisLedger';

// S2-7 Task 8 (B1 review carry): every reason the engine lists for a forfeit or an award maps to an ending the pad has words
// for, so no match the organiser ended ever reads "decided" with no word for how. The expected endings are written out
// from the spec (ruling 225), never read off the table under test.

const EXPECTED = {
  walkover: 'walkover',
  retired: 'retired',
  disqualified: 'defaulted',
  withdrew: 'withdrew',
} as const;

const seats = seatsOf(SINGLES);
if (seats === null) throw new Error('the singles bootstrap has two sides');
const NAMES = namesOf(seats);

/** An engine state of a match the organiser took from the court, as far as `endingOf` reads it. */
const awarded = (reason: string): NestedState =>
  ({ phase: 'done', outcome: { kind: 'award', reason, loser: AWAY } }) as unknown as NestedState;

describe('every reason the engine lists for a forfeit', () => {
  it('lists the four this table covers (anti-vacuity: a new reason fails here and is read on purpose)', () => {
    expect([...FORFEIT_REASONS]).toEqual(['walkover', 'retired', 'disqualified', 'withdrew']);
  });

  it.each(FORFEIT_REASONS)(
    '%s ends the match with the pad’s word and the side at fault',
    (reason) => {
      // A retirement needs play under way; the others are refused once a point is played (the engine's phase rules).
      const played = reason === 'retired' ? [point('H')] : [];
      const shown = display([start(), ...played, forfeit('A', reason)]);
      expect(shown.phase).toBe('ended');
      expect(shown.ending).toEqual({ kind: EXPECTED[reason], side: 'second' });
    },
  );
});

describe('every reason an award may carry', () => {
  it('lists the five (bye the system’s)', () => {
    expect([...AWARD_REASONS]).toEqual(['walkover', 'retired', 'disqualified', 'withdrew', 'bye']);
  });

  it.each(AWARD_REASONS.filter((reason) => reason !== 'bye'))(
    '%s reads as its ending',
    (reason) => {
      expect(endingOf(awarded(reason), NAMES)).toEqual({ kind: EXPECTED[reason], side: 'second' });
    },
  );

  it('a bye, which the phone never records, reads as a walkover against the absent side', () => {
    expect(endingOf(awarded('bye'), NAMES)).toEqual({ kind: 'walkover', side: 'second' });
  });

  it('a reason this build does not list falls back to a walkover, never to no ending', () => {
    expect(endingOf(awarded('sabbatical'), NAMES)).toEqual({ kind: 'walkover', side: 'second' });
    expect(endingKindOf('')).toBe('walkover');
    expect(endingKindOf('toString')).toBe('walkover');
  });

  it('a match won on court has no ending, and neither has one still on', () => {
    const won = { phase: 'done', outcome: { kind: 'win', winner: AWAY } } as unknown as NestedState;
    expect(endingOf(won, NAMES)).toBeNull();
    expect(endingOf({ phase: 'live', outcome: null } as unknown as NestedState, NAMES)).toBeNull();
  });
});

describe('a forfeit as a History row', () => {
  const envelope = (payload: unknown) => ({
    id: 'e',
    seq: 1,
    type: 'core.forfeit',
    payload,
    recordedAt: '2026-11-12T10:00:00.000Z',
    recordedBy: null,
    fixtureId: SINGLES.fixtureId,
  });
  const facts = { set: 1, won: 'none', after: '0–0' } as const;

  it.each(FORFEIT_REASONS)('%s has a row with its ending and side', (reason) => {
    const did = tennisDoneOf(envelope({ by: AWAY, reason }), facts, NAMES);
    expect(did).toEqual({ kind: 'ending', ending: EXPECTED[reason], side: 'second' });
  });

  it('a payload with no reason has no row (garbled), and an unknown one is a walkover row', () => {
    expect(tennisDoneOf(envelope({ by: AWAY }), facts, NAMES)).toBeNull();
    expect(tennisDoneOf(envelope({ by: AWAY, reason: 'x' }), facts, NAMES)).toEqual({
      kind: 'ending',
      ending: 'walkover',
      side: 'second',
    });
  });
});
