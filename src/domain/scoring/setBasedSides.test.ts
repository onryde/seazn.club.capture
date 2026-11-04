import { describe, expect, it } from 'vitest';
import {
  namesOf,
  personName,
  scoreText,
  seatsOf,
  sideNames,
  sideOfEntrant,
  soleOf,
} from '@/domain/scoring/setBasedSides';
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

// The names a ledger fold reads a side by (lifted from badminton's ledger history, plan S2-2 fix round 1): the entrant
// ids top first, the players as typed, and who plays for each.
describe('namesOf', () => {
  it('names a singles side by its one member and a pair by both, as typed, with the entrant ids top first', () => {
    const names = namesOf(seatsOf(DOUBLES)!);
    expect(names.entrants).toEqual({ first: HOME, second: AWAY });
    expect(names.sides.first.players).toEqual(['A. Sharma', 'R. Iyer']);
    expect(names.sides.second.players).toEqual(['L. Chen', 'M. Wong']);
    expect(names.members.first.map((one) => one.personId)).toEqual(['p-sharma', 'p-iyer']);
    expect(namesOf(seatsOf(SINGLES)!).sides.first.players).toEqual(['A. Sharma']);
  });

  // An empty input: a side the endpoint sends with no members is named by the side's own name.
  it('falls back to the side’s own name for a side that lists no member', () => {
    const seats = seatsOf(SINGLES)!;
    const bare = namesOf({ ...seats, first: { ...seats.first, members: [], name: 'Spring FC' } });
    expect(bare.sides.first.players).toEqual(['Spring FC']);
    expect(bare.members.first).toEqual([]);
  });
});

describe('sideOfEntrant', () => {
  const names = namesOf(seatsOf(SINGLES)!);

  it('is the half an entrant id sits in, and none for a stranger or no id', () => {
    expect(sideOfEntrant(names, HOME)).toBe('first');
    expect(sideOfEntrant(names, AWAY)).toBe('second');
    expect(sideOfEntrant(names, 'ent-stranger')).toBeNull();
    expect(sideOfEntrant(names, undefined)).toBeNull();
    expect(sideOfEntrant(names, 42)).toBeNull();
  });
});

describe('personName', () => {
  const names = namesOf(seatsOf(DOUBLES)!);

  it('is the listed member’s name as typed', () => {
    expect(personName(names, 'first', 'p-iyer')).toBe('R. Iyer');
    expect(personName(names, 'second', 'p-chen')).toBe('L. Chen');
  });

  // The person is named by the side that lists them: a member of the other side is nobody here.
  it('is the side’s names when none is named, or the one named is not on that side', () => {
    expect(personName(names, 'first', null)).toBe('A. Sharma / R. Iyer');
    expect(personName(names, 'first', undefined)).toBe('A. Sharma / R. Iyer');
    expect(personName(names, 'first', 'p-chen')).toBe('A. Sharma / R. Iyer');
  });
});
