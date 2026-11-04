import { describe, expect, it } from 'vitest';
import { sportFor } from '@/domain/scoring/sports';
import { BadmintonMatchScreen } from '@/ui/screens/BadmintonMatchScreen';
import { screenFor } from '@/ui/screens/scoringScreens';
import { TableTennisMatchScreen } from '@/ui/screens/TableTennisMatchScreen';

// Owner ruling 38 (2026-11-02): a screen per sport, picked from a table by the sport's key. Literal keys.

describe('the sports screens table', () => {
  it('badminton is drawn by its own screen', () => {
    expect(screenFor('badminton')).toBe(BadmintonMatchScreen);
  });

  it('table tennis is drawn by its own screen, never badminton’s (plan S2-2 Task 8)', () => {
    expect(screenFor('tabletennis')).toBe(TableTennisMatchScreen);
    expect(screenFor('tabletennis')).not.toBe(screenFor('badminton'));
  });

  it('every sport the runtime scores has a screen: the table cannot fall behind the sports', () => {
    for (const key of ['badminton', 'tabletennis']) {
      expect(sportFor(key), key).not.toBeNull();
      expect(screenFor(key), key).not.toBeNull();
    }
  });

  it.each(['tennis', '', 'Badminton', 'constructor', '__proto__'])(
    'has no screen for %j: a sport this build does not score, an inherited name included',
    (key) => {
      expect(screenFor(key)).toBeNull();
    },
  );
});
