import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MatchContext } from '@/domain/scoring/matchContext';
import { MatchDetails } from '@/ui/components/MatchDetails';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner, 2026-11-01: "How do we know Comp/Divi round etc.?" The block says where the match sits, in the organiser's
// words; a line with nothing to say is skipped, and nothing is cut.
const FULL: MatchContext = {
  competition: 'Spring Open 2026',
  division: 'U15 Boys Singles',
  round: 'Round 1',
  match: 'Match 4',
  sides: ['A. Sharma', 'L. Chen'],
};

const lines = () =>
  [...screen.getByTestId('match-details').children].map((line) => line.textContent);

describe('MatchDetails', () => {
  it('shows the competition, the division · round, the match, then the sides joined by " v "', () => {
    renderWithPorts(<MatchDetails context={FULL} />);
    expect(lines()).toEqual([
      'Spring Open 2026',
      'U15 Boys Singles · Round 1',
      'Match 4',
      'A. Sharma v L. Chen',
    ]);
  });

  it('draws the v in ink2 and the names in ink, as the match label does (C2)', () => {
    renderWithPorts(<MatchDetails context={FULL} />);
    const sides = screen.getByTestId('details-sides');
    expect(getComputedStyle(sides).color).toBe(edgeOf(colour.ink));
    const v = sides.firstElementChild;
    if (!(v instanceof HTMLElement)) throw new Error('no v');
    expect(v.textContent).toBe(' v ');
    expect(getComputedStyle(v).color).toBe(edgeOf(colour.ink2));
  });

  it('skips a line with nothing to say (empty input)', () => {
    renderWithPorts(
      <MatchDetails context={{ ...FULL, division: null, round: null, match: null }} />,
    );
    expect(lines()).toEqual(['Spring Open 2026', 'A. Sharma v L. Chen']);
    expect(screen.queryByTestId('details-where')).toBeNull();
    expect(screen.queryByTestId('details-match')).toBeNull();
  });

  it('keeps the division or the round alone, and skips a blank match', () => {
    renderWithPorts(<MatchDetails context={{ ...FULL, division: null, match: ' ' }} />);
    expect(lines()).toEqual(['Spring Open 2026', 'Round 1', 'A. Sharma v L. Chen']);
  });

  it('never cuts a long name: no line has a line limit', () => {
    renderWithPorts(
      <MatchDetails
        context={{
          ...FULL,
          competition: 'Riverside Badminton Club Championships 2026',
          sides: ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'],
        }}
      />,
    );
    for (const line of screen.getByTestId('match-details').children) {
      if (!(line instanceof HTMLElement)) throw new Error('not an element');
      expect(getComputedStyle(line).whiteSpace).not.toBe('nowrap');
      expect(getComputedStyle(line).webkitLineClamp).toBe('');
    }
    expect(screen.getByTestId('details-sides').textContent).toBe(
      'A. Sharma / R. Iyer v L. Chen / M. Wong',
    );
  });
});
