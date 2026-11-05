import { describe, expect, it } from 'vitest';
import {
  CHESS_TIEBREAK_SCORES,
  advancerOf,
  type ChessTiebreakTap,
} from '@/domain/scoring/chessTypes';

// The tie-break as the pad chooses it (spec S2-3b §1, §3; the engine's `boardgame.tiebreak`, `boardgame.js:189-209`). A
// choice names SEATS, never entrants or colours. Every expected value is written out from the engine's rules (BG-KO-2:
// White won, the other entrant advances; Black won or a drawn Armageddon, Black advances), never computed by the code under
// test.

const rapid = (winner: 'first' | 'second'): ChessTiebreakTap => ({
  kind: 'tiebreak',
  rung: 'rapid',
  winner,
  score: null,
});

const armageddon = (
  black: 'first' | 'second',
  result: 'white' | 'black' | 'draw',
): ChessTiebreakTap => ({ kind: 'tiebreak', rung: 'armageddon', black, result });

describe('advancerOf: who goes through', () => {
  it('is the seat the scorer named for a rapid or a blitz tie-break, with a score or none', () => {
    expect(advancerOf(rapid('first'))).toBe('first');
    expect(advancerOf(rapid('second'))).toBe('second');
    expect(advancerOf({ kind: 'tiebreak', rung: 'blitz', winner: 'second', score: '2–0' })).toBe(
      'second',
    );
    expect(advancerOf({ kind: 'tiebreak', rung: 'blitz', winner: 'first', score: '1½–½' })).toBe(
      'first',
    );
  });

  it('is the other seat when White won the Armageddon: White never advances by a draw', () => {
    expect(advancerOf(armageddon('first', 'white'))).toBe('second');
    expect(advancerOf(armageddon('second', 'white'))).toBe('first');
  });

  it('is Black when Black won the Armageddon', () => {
    expect(advancerOf(armageddon('first', 'black'))).toBe('first');
    expect(advancerOf(armageddon('second', 'black'))).toBe('second');
  });

  it('is Black when the Armageddon was drawn (BG-KO-2)', () => {
    expect(advancerOf(armageddon('first', 'draw'))).toBe('first');
    expect(advancerOf(armageddon('second', 'draw'))).toBe('second');
  });
});

describe('the score options', () => {
  // The web's pad offers No score, 2-0 and 1½-½; the wire takes an en dash between the numbers (CHESS_SCORE).
  it('are the two the web offers, with the en dash and the half sign the wire takes', () => {
    expect(CHESS_TIEBREAK_SCORES).toEqual(['2–0', '1½–½']);
  });
});
