import { describe, expect, it } from 'vitest';
import {
  chooseBlack,
  chooseRung,
  chooseResult,
  chooseScore,
  chooseWinner,
  startTiebreak,
  tiebreakStale,
  tiebreakStep,
  tiebreakTapOf,
  type TiebreakDraft,
} from '@/domain/scoring/chessTiebreakSheet';
import type { ChessRung } from '@/domain/scoring/chessTypes';
import { NO_TIEBREAK, pendingTiebreak } from '../../../test/chessLedger';

// The steps of the tie-break sheet (S2-3b Task 2; design §3): the rung, then who won and the optional score for a rapid or
// blitz tie-break, or who had Black and how it ended for an Armageddon, then the confirm. Expected values are the design's
// steps, written out; nothing is read back from the code under test.

const ALL: readonly ChessRung[] = ['rapid', 'blitz', 'armageddon'];

const BLANK: TiebreakDraft = { rung: null, winner: null, score: null, black: null, result: null };

describe('starting the sheet', () => {
  it('asks which rung when the stage lists several', () => {
    expect(startTiebreak(ALL)).toEqual(BLANK);
    expect(startTiebreak(['blitz', 'armageddon'])).toEqual(BLANK);
    expect(tiebreakStep(startTiebreak(ALL))).toBe('rung');
  });

  // The web skips the pick when the stage plays exactly one rung: there is nothing to ask.
  it.each([
    ['rapid', 'winner'],
    ['blitz', 'winner'],
    ['armageddon', 'black'],
  ] as const)(
    'skips the rung step for a stage that lists only %s: it opens on %s',
    (rung, step) => {
      const draft = startTiebreak([rung]);
      expect(draft.rung).toBe(rung);
      expect(tiebreakStep(draft)).toBe(step);
    },
  );

  it('holds no rung when the stage lists none (the pad opens no sheet then)', () => {
    expect(startTiebreak([])).toEqual(BLANK);
  });
});

describe('a rapid or blitz tie-break: rung, who won, the score', () => {
  const walk = (rung: 'rapid' | 'blitz') =>
    chooseWinner(chooseRung(startTiebreak(ALL), rung, ALL), 'second');

  it.each(['rapid', 'blitz'] as const)(
    '%s goes from the rung to the winner to the score',
    (rung) => {
      const picked = chooseRung(startTiebreak(ALL), rung, ALL);
      expect(tiebreakStep(picked)).toBe('winner');
      expect(tiebreakStep(chooseWinner(picked, 'first'))).toBe('score');
    },
  );

  it('records the seat that won with no score', () => {
    expect(tiebreakTapOf(walk('rapid'))).toEqual({
      kind: 'tiebreak',
      rung: 'rapid',
      winner: 'second',
      score: null,
    });
  });

  it.each(['2–0', '1½–½'] as const)('records the score %s the scorer picked', (score) => {
    expect(tiebreakTapOf(chooseScore(walk('blitz'), score))).toEqual({
      kind: 'tiebreak',
      rung: 'blitz',
      winner: 'second',
      score,
    });
  });

  it('takes the score back: none again is no score', () => {
    const scored = chooseScore(walk('rapid'), '2–0');
    expect(tiebreakTapOf(chooseScore(scored, null))).toMatchObject({ score: null });
  });

  it('is complete from the score step on, and not before', () => {
    const rung = chooseRung(startTiebreak(ALL), 'rapid', ALL);
    expect(tiebreakTapOf(startTiebreak(ALL))).toBeNull();
    expect(tiebreakTapOf(rung)).toBeNull();
    expect(tiebreakTapOf(chooseWinner(rung, 'first'))).not.toBeNull();
  });
});

describe('an Armageddon: who had Black, how it ended, the confirm', () => {
  const asked = chooseRung(startTiebreak(ALL), 'armageddon', ALL);

  it('goes from the rung to Black to the result to the confirm', () => {
    expect(tiebreakStep(asked)).toBe('black');
    const black = chooseBlack(asked, 'first');
    expect(tiebreakStep(black)).toBe('result');
    expect(tiebreakStep(chooseResult(black, 'draw'))).toBe('confirm');
  });

  it.each(['white', 'black', 'draw'] as const)(
    'records Black and the result %s, and never a winner',
    (result) => {
      const tap = tiebreakTapOf(chooseResult(chooseBlack(asked, 'second'), result));
      expect(tap).toEqual({ kind: 'tiebreak', rung: 'armageddon', black: 'second', result });
      expect(tap).not.toHaveProperty('winner');
    },
  );

  it('is complete at the confirm and not before', () => {
    const black = chooseBlack(asked, 'first');
    expect(tiebreakTapOf(asked)).toBeNull();
    expect(tiebreakTapOf(black)).toBeNull();
    expect(tiebreakTapOf(chooseResult(black, 'white'))).not.toBeNull();
  });
});

describe('a pick that is not for the step on screen changes nothing', () => {
  const rung = startTiebreak(ALL);
  const timed = chooseRung(rung, 'rapid', ALL);
  const armageddon = chooseRung(rung, 'armageddon', ALL);

  it('takes no winner, score, Black or result on the rung step', () => {
    expect(chooseWinner(rung, 'first')).toBe(rung);
    expect(chooseScore(rung, '2–0')).toBe(rung);
    expect(chooseBlack(rung, 'first')).toBe(rung);
    expect(chooseResult(rung, 'draw')).toBe(rung);
  });

  it('takes no Black or result for a rapid or blitz tie-break', () => {
    expect(chooseBlack(timed, 'first')).toBe(timed);
    expect(chooseResult(timed, 'draw')).toBe(timed);
  });

  it('takes no winner or score for an Armageddon', () => {
    expect(chooseWinner(armageddon, 'first')).toBe(armageddon);
    expect(chooseScore(armageddon, '2–0')).toBe(armageddon);
  });

  it('takes no score before the winner, and no result before Black', () => {
    expect(chooseScore(timed, '2–0')).toBe(timed);
    expect(chooseResult(armageddon, 'white')).toBe(armageddon);
  });

  it('takes no second rung once one is picked, and none the stage does not list', () => {
    expect(chooseRung(timed, 'blitz', ALL)).toBe(timed);
    expect(chooseRung(rung, 'armageddon', ['rapid', 'blitz'])).toBe(rung);
  });

  it('takes no winner twice: a second pick is a double tap’s touch on the score step', () => {
    const winner = chooseWinner(timed, 'first');
    expect(chooseWinner(winner, 'second')).toBe(winner);
  });

  it('takes a score only from the wire’s two, or none', () => {
    const scored = chooseWinner(timed, 'first');
    // @ts-expect-error a score the wire does not take
    expect(chooseScore(scored, '3–0')).toBe(scored);
  });
});

describe('when the sheet has no place any more', () => {
  const draft = chooseRung(startTiebreak(ALL), 'blitz', ALL);

  it('stands while the tie-break is owed and the rung is listed', () => {
    expect(tiebreakStale(draft, pendingTiebreak())).toBe(false);
    expect(tiebreakStale(startTiebreak(ALL), pendingTiebreak())).toBe(false);
  });

  it('goes when none is owed any more (recorded by another scorer, settled, voided)', () => {
    expect(tiebreakStale(draft, { ...pendingTiebreak(), pending: false })).toBe(true);
    expect(tiebreakStale(draft, NO_TIEBREAK)).toBe(true);
  });

  it('goes when the rung picked is no longer one the stage lists', () => {
    expect(tiebreakStale(draft, pendingTiebreak(['rapid', 'armageddon']))).toBe(true);
  });

  it('goes when the stage lists no rung at all', () => {
    expect(tiebreakStale(startTiebreak(ALL), pendingTiebreak([]))).toBe(true);
  });
});
