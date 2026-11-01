import { describe, expect, it } from 'vitest';
import { contextSaid, divisionAndRound, type MatchContext } from '@/domain/scoring/matchContext';

const CONTEXT: MatchContext = {
  competition: 'Spring Open 2026',
  division: 'U15 Boys Singles',
  round: 'Round 1',
  match: 'Match 4',
  sides: ['A. Sharma', 'L. Chen'],
};

describe('divisionAndRound', () => {
  it('joins the division and the round with a middle dot', () => {
    expect(divisionAndRound(CONTEXT)).toBe('U15 Boys Singles · Round 1');
  });

  it('says either alone when the other is left out', () => {
    expect(divisionAndRound({ ...CONTEXT, round: null })).toBe('U15 Boys Singles');
    expect(divisionAndRound({ ...CONTEXT, division: null })).toBe('Round 1');
  });

  it('has no line when both are left out, or blank', () => {
    expect(divisionAndRound({ ...CONTEXT, division: null, round: null })).toBeNull();
    expect(divisionAndRound({ ...CONTEXT, division: ' ', round: '' })).toBeNull();
  });
});

// Owner, 2026-11-01 (option A): Match details' header reads as one line to a screen reader. Each piece the organiser
// gave, a comma between (a pause in all four languages); the middle dot is drawn, not said.
describe('contextSaid', () => {
  it('says the competition, the division, the round and the match as one line', () => {
    expect(contextSaid(CONTEXT)).toBe('Spring Open 2026, U15 Boys Singles, Round 1, Match 4');
  });

  // An empty input: a blank competition is skipped like any piece, so a context of blanks says nothing.
  it('says nothing for a context of blanks', () => {
    expect(
      contextSaid({ ...CONTEXT, competition: ' ', division: null, round: '', match: null }),
    ).toBe('');
  });

  it('skips a piece left out or blank', () => {
    expect(contextSaid({ ...CONTEXT, division: null, match: ' ' })).toBe(
      'Spring Open 2026, Round 1',
    );
    expect(contextSaid({ ...CONTEXT, division: null, round: null, match: null })).toBe(
      'Spring Open 2026',
    );
  });
});
