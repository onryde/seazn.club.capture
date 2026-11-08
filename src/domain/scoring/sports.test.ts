import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { chessSport } from '@/domain/scoring/chessSport';
import { cricketSport } from '@/domain/scoring/cricketSport';
import { footballSport } from '@/domain/scoring/footballSport';
import { sportFor } from '@/domain/scoring/sports';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';

// The sports this build scores (owner, 2026-11-02: pad per sport): one table by the bootstrap's sport_key. Badminton and
// table tennis (S2-2), chess (S2-3, under the engine's key `boardgame`), cricket (S2-4) and football (S2-5) are its five rows.

describe('sportFor', () => {
  it('names badminton by its key', () => {
    expect(sportFor('badminton')).toBe(badmintonSport);
  });

  it('names table tennis by its key', () => {
    expect(sportFor('tabletennis')).toBe(tableTennisSport);
  });

  it('names chess by the engine’s key for it, boardgame, not by chess', () => {
    expect(sportFor('boardgame')).toBe(chessSport);
    expect(sportFor('chess')).toBeNull();
  });

  it('names cricket by its key', () => {
    expect(sportFor('cricket')).toBe(cricketSport);
  });

  it('names football by its key', () => {
    expect(sportFor('football')).toBe(footballSport);
    expect(sportFor('Football')).toBeNull();
  });

  it.each(['tennis', '', 'Badminton', 'constructor', 'toString'])(
    'is null for %j: a sport this build does not score, or no row of the table',
    (key) => {
      expect(sportFor(key)).toBeNull();
    },
  );
});
