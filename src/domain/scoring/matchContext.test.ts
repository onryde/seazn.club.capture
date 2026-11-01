import { describe, expect, it } from 'vitest';
import { divisionAndRound, type MatchContext } from '@/domain/scoring/matchContext';

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
