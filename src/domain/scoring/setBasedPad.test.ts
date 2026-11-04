import { describe, expect, it } from 'vitest';
import {
  gamesWon,
  playedSaid,
  playedScore,
  resultCardOf,
  heaviestLevel,
  padMarks,
  setBasedGameItem,
  setBasedStart,
  setBasedTally,
} from '@/domain/scoring/setBasedPad';
import type { SetBasedGame, SetBasedPhase } from '@/domain/scoring/setBasedBoard';

// The pieces of a pad the set-based sports (badminton, table tennis) draw alike (plan S2-2 Task 5, lifted from
// badminton's): driven with made-up keys, so nothing here is one sport's wording.

const SIDES = {
  first: { players: ['A. Sharma', 'R. Iyer'] },
  second: { players: ['L. Chen'] },
} as const;

const won = (first: number, second: number): SetBasedGame => ({
  points: { first, second },
  winner: first > second ? 'first' : 'second',
});

describe('gamesWon', () => {
  it('counts the games each side won, top first', () => {
    expect(gamesWon([won(11, 7), won(5, 11), won(11, 9)])).toEqual({ first: 2, second: 1 });
  });

  it('is nothing for nothing played', () => {
    expect(gamesWon([])).toEqual({ first: 0, second: 0 });
  });
});

describe('setBasedTally', () => {
  it('shows the games won top first, and says them with both sides’ names, partners joined', () => {
    expect(setBasedTally('t.tally', SIDES, { first: 1, second: 2 })).toEqual({
      shown: '1:2',
      said: {
        key: 't.tally',
        vars: { first: 'A. Sharma / R. Iyer', firstGames: 1, second: 'L. Chen', secondGames: 2 },
      },
    });
  });
});

describe('setBasedStart', () => {
  it('asks the question with the two sides as typed, top first, while the match has not started', () => {
    expect(setBasedStart('t.ask', SIDES, 'notStarted')).toEqual({
      ask: { key: 't.ask' },
      sides: [
        { side: 'first', label: 'A. Sharma / R. Iyer' },
        { side: 'second', label: 'L. Chen' },
      ],
    });
  });

  it.each(['pre', 'live', 'betweenGames', 'decided'] as const)('asks nothing once %s', (phase) => {
    expect(setBasedStart('t.ask', SIDES, phase)).toBeNull();
  });
});

describe('heaviestLevel', () => {
  const ORDER = ['light', 'middle', 'heavy'] as const;

  it('is the heaviest level of those given, whatever order they came in', () => {
    expect(heaviestLevel(ORDER, ['middle', 'heavy', 'light'])).toBe('heavy');
    expect(heaviestLevel(ORDER, ['heavy', 'middle'])).toBe('heavy');
    expect(heaviestLevel(ORDER, ['light', 'middle'])).toBe('middle');
  });

  it('is the one level when there is one, and nothing when there is none', () => {
    expect(heaviestLevel(ORDER, ['light'])).toBe('light');
    expect(heaviestLevel(ORDER, [])).toBeNull();
  });

  it('ignores a level the order does not list, so an unknown one never outweighs a known one', () => {
    expect(heaviestLevel(ORDER, ['unknown' as never, 'light'])).toBe('light');
    expect(heaviestLevel(ORDER, ['unknown' as never])).toBeNull();
  });
});

describe('padMarks', () => {
  const CARD = { cards: ['caution', 'dismissal'], said: { key: 't.card' } } as const;
  const CLOCK = { key: 't.clock' } as const;

  it('is nothing to draw and nothing to say for no card and no clock', () => {
    expect(padMarks(null, null)).toEqual({ clock: false, cards: [], said: [] });
  });

  it('draws a card’s cards in the order given and says its name', () => {
    expect(padMarks(CARD, null)).toEqual({
      clock: false,
      cards: ['caution', 'dismissal'],
      said: [{ key: 't.card' }],
    });
  });

  it('draws a clock and says its words', () => {
    expect(padMarks(null, CLOCK)).toEqual({ clock: true, cards: [], said: [{ key: 't.clock' }] });
  });

  it('says the card before the clock when a half has both', () => {
    expect(padMarks(CARD, CLOCK)).toEqual({
      clock: true,
      cards: ['caution', 'dismissal'],
      said: [{ key: 't.card' }, { key: 't.clock' }],
    });
  });
});

describe('setBasedGameItem', () => {
  it('is the strip’s game slot: the game of how many', () => {
    expect(setBasedGameItem('t.of', 2, 5)).toEqual({
      slot: 'game',
      text: { key: 't.of', vars: { game: 2, bestOf: 5 } },
    });
  });
});

describe('a finished game’s box and its words', () => {
  it('marks the box of the side that won the game', () => {
    expect(playedScore(won(11, 7), 'first')).toEqual({ value: '11', won: true });
    expect(playedScore(won(11, 7), 'second')).toEqual({ value: '7', won: false });
  });

  it('says a side’s scores in game order, counted for the plural', () => {
    expect(playedSaid('t.games.other', [won(11, 7), won(9, 11)], 'second')).toEqual({
      key: 't.games.other',
      count: 2,
      vars: { scores: '7, 11' },
    });
    expect(playedSaid('t.games.other', [won(11, 7)], 'first')).toEqual({
      key: 't.games.other',
      count: 1,
      vars: { scores: '11' },
    });
  });
});

describe('resultCardOf', () => {
  it('is the recorded result’s card once the match is decided, and no card otherwise', () => {
    expect(resultCardOf('decided')).toEqual({ kind: 'resultRecorded', undoLeft: null });
    const others: SetBasedPhase[] = ['notStarted', 'pre', 'live', 'betweenGames'];
    for (const phase of others) expect(resultCardOf(phase), phase).toBeNull();
  });
});
