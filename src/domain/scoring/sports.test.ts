import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { sportFor } from '@/domain/scoring/sports';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';

// The sports this build scores (owner, 2026-11-02: pad per sport): one table by the bootstrap's sport_key. Badminton and
// table tennis (S2-2) are its two rows.

describe('sportFor', () => {
  it('names badminton by its key', () => {
    expect(sportFor('badminton')).toBe(badmintonSport);
  });

  it('names table tennis by its key', () => {
    expect(sportFor('tabletennis')).toBe(tableTennisSport);
  });

  it.each(['tennis', '', 'Badminton', 'constructor', 'toString'])(
    'is null for %j: a sport this build does not score, or no row of the table',
    (key) => {
      expect(sportFor(key)).toBeNull();
    },
  );
});
