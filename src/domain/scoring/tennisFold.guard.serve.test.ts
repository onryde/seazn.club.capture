import { describe, expect, it, vi } from 'vitest';
import { DOUBLES, start } from '../../../test/tennisLedger';
import { display, folded, gamesOf } from '@/domain/scoring/tennisFold.testkit';

// S2-7 final review M2: the two other guarded reads of a pad rule. `servingOf` in a snapshot (the server of a past game's
// facts) and `breakerInForce` (the doubles server's name and the detailed point's `server`) fall back to a quiet answer when
// the engine throws. The first throws only for the board with one game played, so the fold's own end-of-ledger read stands.

const mocks = vi.hoisted(() => ({ throwAtOneGame: false, throwBreaker: false }));

vi.mock('@seazn/engine/sports/nested', async (importActual) => {
  const actual = await importActual<typeof import('@seazn/engine/sports/nested')>();
  return {
    ...actual,
    serveContext: (state: Parameters<typeof actual.serveContext>[0]) => {
      if (mocks.throwAtOneGame && state.games.home + state.games.away === 1)
        throw new Error('the engine cannot read this board');
      return actual.serveContext(state);
    },
  };
});

vi.mock('@seazn/engine/pad', async (importActual) => {
  const actual = await importActual<typeof import('@seazn/engine/pad')>();
  return {
    ...actual,
    tennisPadRules: {
      ...actual.tennisPadRules,
      breakerInForce: (...args: Parameters<typeof actual.tennisPadRules.breakerInForce>) => {
        if (mocks.throwBreaker) throw new Error('the engine cannot read this config');
        return actual.tennisPadRules.breakerInForce(...args);
      },
    },
  };
});

describe('a snapshot whose serve cannot be read', () => {
  it('names no server for the game played on that board, and the other games keep theirs', () => {
    mocks.throwAtOneGame = true;
    try {
      const keys = folded([start(), ...gamesOf('HAH')]).history.map((group) => group.heading.key);
      // Games 1 and 3 name their server; game 2 (played from one game up) does not.
      expect(keys).toEqual([
        'scoring.tennis.history.gameWon',
        'scoring.tennis.history.gameWonNoServer',
        'scoring.tennis.history.gameWon',
      ]);
    } finally {
      mocks.throwAtOneGame = false;
    }
  });
});

describe('a breaker rule that throws', () => {
  it('leaves the doubles server unnamed, and a detailed point with no server', () => {
    mocks.throwBreaker = true;
    try {
      const shown = display([start()], { bootstrap: DOUBLES });
      expect(shown.servingPerson).toBeNull();
      expect(shown.serverId).toBeNull();
    } finally {
      mocks.throwBreaker = false;
    }
  });
});
