import { describe, expect, it } from 'vitest';
import { scoreText, seatsOf, sideNames, soleOf } from '@/domain/scoring/setBasedSides';
import type { Bootstrap } from '@/domain/scoring/wire';
import { AWAY, DOUBLES, HOME, SINGLES } from '../../../test/badmintonLedger';

// The sides every set-based sport reads the same way (plan S2-2 Task 2): who sits where, the one player of a singles
// side, a side's names as one line and a score as one string. Each was badminton's until table tennis needed it.

describe('seatsOf', () => {
  it('seats home on top and away below, whoever they are', () => {
    const seats = seatsOf(SINGLES);
    expect(seats?.first.entrantId).toBe(HOME);
    expect(seats?.second.entrantId).toBe(AWAY);
  });

  // An empty input: a bye, or a match waiting on a result, has a side with no entrant, and so no seats at all.
  it.each([
    ['home', { ...SINGLES.sides, home: null }],
    ['away', { ...SINGLES.sides, away: null }],
    ['both', { home: null, away: null }],
  ])('has no seats while %s has no entrant', (_, sides) => {
    const bootstrap: Bootstrap = { ...SINGLES, sides };
    expect(seatsOf(bootstrap)).toBeNull();
  });
});

describe('soleOf', () => {
  it('names a singles side’s one player', () => {
    const seats = seatsOf(SINGLES);
    expect(seats && soleOf(seats.first)).toBe('p-sharma');
    expect(seats && soleOf(seats.second)).toBe('p-chen');
  });

  it('names no one for a pair, and no one for a side with no lineup', () => {
    const seats = seatsOf(DOUBLES);
    expect(seats && soleOf(seats.first)).toBeNull();
    const first = seatsOf(SINGLES)?.first;
    expect(first && soleOf({ ...first, lineup: [] })).toBeNull();
  });
});

describe('sideNames', () => {
  it('is one name for a singles side and the partners joined by a slash for a pair', () => {
    expect(sideNames({ players: ['A. Sharma'] })).toBe('A. Sharma');
    expect(sideNames({ players: ['A. Sharma', 'R. Iyer'] })).toBe('A. Sharma / R. Iyer');
  });

  it('is nothing for a side that lists no one', () => {
    expect(sideNames({ players: [] })).toBe('');
  });
});

describe('scoreText', () => {
  it('writes the top side first with an en dash between, numbers untranslated', () => {
    expect(scoreText({ first: 7, second: 3 })).toBe('7–3');
    expect(scoreText({ first: 0, second: 0 })).toBe('0–0');
    expect(scoreText({ first: 11, second: 13 })).toBe('11–13');
  });
});
