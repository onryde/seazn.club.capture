import { describe, expect, it } from 'vitest';
import { sportFor } from '@/domain/scoring/sports';
import { BadmintonMatchScreen } from '@/ui/screens/BadmintonMatchScreen';
import { ChessMatchScreen } from '@/ui/screens/ChessMatchScreen';
import { CricketMatchScreen } from '@/ui/screens/CricketMatchScreen';
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

  // Chess's key is the engine's `boardgame`, shared with every generic one-against-one game (ruling 61).
  it('chess is drawn by its own screen, under the engine’s key (plan S2-3 Task 3)', () => {
    expect(screenFor('boardgame')).toBe(ChessMatchScreen);
    expect(screenFor('boardgame')).not.toBe(screenFor('badminton'));
    expect(screenFor('boardgame')).not.toBe(screenFor('tabletennis'));
  });

  it('a cricket link opens on the cricket screen, nobody else’s (S2-4 plan Task 8)', () => {
    expect(screenFor('cricket')).toBe(CricketMatchScreen);
    for (const other of ['badminton', 'tabletennis', 'boardgame']) {
      expect(screenFor('cricket')).not.toBe(screenFor(other));
    }
  });

  it('every sport the runtime scores has a screen: the table cannot fall behind the sports', () => {
    for (const key of ['badminton', 'tabletennis', 'boardgame', 'cricket']) {
      expect(sportFor(key), key).not.toBeNull();
      expect(screenFor(key), key).not.toBeNull();
    }
  });

  it.each(['tennis', '', 'Badminton', 'chess', 'constructor', '__proto__'])(
    'has no screen for %j: a sport this build does not score, an inherited name included',
    (key) => {
      expect(screenFor(key)).toBeNull();
    },
  );
});
