import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { sportFor, sportOfMatch } from '@/domain/scoring/sports';
import { SINGLES } from '../../../test/badmintonLedger';

// The sports this build scores (owner, 2026-11-02: pad per sport): one table by the bootstrap's sport_key. Badminton is
// the one row today; table tennis is S2-2's.

describe('sportFor', () => {
  it('names badminton by its key', () => {
    expect(sportFor('badminton')).toBe(badmintonSport);
  });

  it.each(['tabletennis', 'tennis', '', 'Badminton', 'constructor', 'toString'])(
    'is null for %j: a sport this build does not score, or no row of the table',
    (key) => {
      expect(sportFor(key)).toBeNull();
    },
  );
});

describe('sportOfMatch', () => {
  it('is badminton with nothing kept to name the sport (a first open, the headless sender)', () => {
    expect(sportOfMatch(null)).toBe(badmintonSport);
  });

  it('is the sport the kept bootstrap names', () => {
    expect(sportOfMatch({ bootstrap: SINGLES, toss: null })).toBe(badmintonSport);
  });

  it('is badminton when the kept bootstrap names a sport this build does not score, which then reads unsupported', () => {
    expect(sportOfMatch({ bootstrap: { ...SINGLES, sportKey: 'tennis' }, toss: null })).toBe(
      badmintonSport,
    );
  });
});
