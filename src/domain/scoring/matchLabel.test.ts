import { describe, expect, it } from 'vitest';
import { matchLabelOf } from '@/domain/scoring/matchLabel';
import type { BootstrapContext, BootstrapSide } from '@/domain/scoring/wire';

const side = (name: string): BootstrapSide => ({
  entrantId: `e-${name}`,
  name,
  kind: 'player',
  members: [],
  lineup: [],
});
const context = (over: Partial<BootstrapContext> = {}): BootstrapContext => ({
  competition: 'Spring Open 2026',
  division: 'U15 Boys Singles',
  round: 'Round 1',
  match: 'Match 4',
  ...over,
});
const sides = { home: side('A. Sharma'), away: side('L. Chen') };

/**
 * What Home calls a match (design §6.3: "4 taps from Match 4 not sent yet"): the organiser's own number for it, else the
 * two sides as the Live Stream label puts them, else the competition. Never an id: a volunteer cannot read one.
 */
describe('matchLabelOf', () => {
  it('is the match number the organiser gave', () => {
    expect(matchLabelOf({ context: context(), sides })).toBe('Match 4');
  });

  it('is the two sides, " v " between, when the match has no number of its own', () => {
    expect(matchLabelOf({ context: context({ match: null }), sides })).toBe('A. Sharma v L. Chen');
  });

  it.each([null, '', '   '])('reads a match number of %j as none', (match) => {
    expect(matchLabelOf({ context: context({ match }), sides })).toBe('A. Sharma v L. Chen');
  });

  it('is the competition when there is no number and a seat has no side yet', () => {
    expect(
      matchLabelOf({
        context: context({ match: null }),
        sides: { home: side('A. Sharma'), away: null },
      }),
    ).toBe('Spring Open 2026');
    expect(
      matchLabelOf({ context: context({ match: null }), sides: { home: null, away: null } }),
    ).toBe('Spring Open 2026');
  });

  it('is empty when the organiser typed nothing at all', () => {
    expect(
      matchLabelOf({
        context: context({ match: null, competition: ' ' }),
        sides: { home: null, away: null },
      }),
    ).toBe('');
  });

  it('trims what the organiser typed', () => {
    expect(matchLabelOf({ context: context({ match: '  Match 4 ' }), sides })).toBe('Match 4');
  });

  it('trims the side names it joins', () => {
    expect(
      matchLabelOf({
        context: context({ match: null }),
        sides: { home: side('  A. Sharma '), away: side(' L. Chen  ') },
      }),
    ).toBe('A. Sharma v L. Chen');
  });
});
