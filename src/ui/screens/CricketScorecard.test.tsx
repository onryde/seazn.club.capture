import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScorecardInnings } from '@/domain/scoring/cricketScorecard';
import { STORE_KEYS } from '@/services/modeStore';
import { CricketScorecard } from '@/ui/screens/CricketScorecard';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The scorecard under Match details (S2-4 plan Task 18): what the operator reads, from innings the domain has built
// (`cricketScorecard.test.ts` pins their figures). The words are the dictionaries'; nothing here is computed.

const FIRST: ScorecardInnings = {
  title: { key: 'scoring.cricket.history.innings', vars: { number: 1, side: 'Home CC' } },
  total: { key: 'scoring.cricket.card.total', vars: { runs: 12, wickets: 2, overs: '2.0' } },
  batting: [
    {
      name: 'Home Player 1',
      how: { key: 'scoring.cricket.card.notOut' },
      score: { key: 'scoring.cricket.card.score', vars: { runs: 2, balls: 6 } },
    },
    {
      name: 'Home Player 2',
      how: {
        key: 'scoring.cricket.card.bowledBy',
        vars: {
          how: {
            key: 'scoring.cricket.out.fielder',
            vars: { how: { key: 'scoring.cricket.out.kind.caught' }, fielder: 'Away Player 5' },
          },
          bowler: 'Away Player 11',
        },
      },
      score: { key: 'scoring.cricket.card.score', vars: { runs: 4, balls: 2 } },
    },
  ],
  didNotBat: {
    key: 'scoring.cricket.card.didNotBat',
    vars: { names: 'Home Player 5, Home Player 6' },
  },
  extras: {
    key: 'scoring.cricket.card.extras',
    vars: { total: 2, wides: 1, noBalls: 1, byes: 0, legByes: 0 },
  },
  bowling: [
    { name: 'Away Player 11', figures: '1.0-0-7-1' },
    { name: 'Away Player 10', figures: '1.0-0-5-1' },
  ],
  fall: [
    {
      key: 'scoring.cricket.card.fall',
      vars: { wicket: 1, runs: 6, batter: 'Home Player 2', over: '0.3' },
    },
    {
      key: 'scoring.cricket.card.fall',
      vars: { wicket: 2, runs: 7, batter: 'Home Player 3', over: '1.1' },
    },
  ],
};

const SECOND: ScorecardInnings = {
  title: { key: 'scoring.cricket.history.superOver', vars: { number: 1, side: 'Away CC' } },
  total: { key: 'scoring.cricket.card.declared', vars: { runs: 9, wickets: 0, overs: '1.0' } },
  batting: [],
  didNotBat: null,
  extras: null,
  bowling: [],
  fall: [],
};

const texts = (id: string) => screen.getAllByTestId(id).map((one) => one.textContent);

describe('the cricket scorecard', () => {
  it('shows an innings: its title and total, its batters with how out and runs (balls), the rest', () => {
    renderWithPorts(<CricketScorecard innings={[FIRST]} />);
    expect(texts('card-title')).toEqual(['Innings 1 · Home CC']);
    expect(texts('card-total')).toEqual(['12/2 · 2.0 ov']);
    const rows = screen.getAllByTestId('card-batter');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Home Player 1not out2 (6)',
      'Home Player 2caught (Away Player 5) · b Away Player 114 (2)',
    ]);
    expect(texts('card-didnotbat')).toEqual(['Did not bat: Home Player 5, Home Player 6']);
    expect(texts('card-extras')).toEqual(['Extras 2 (w 1, nb 1, b 0, lb 0)']);
  });

  it('shows the bowling with O-M-R-W, and the fall of wickets as one line', () => {
    renderWithPorts(<CricketScorecard innings={[FIRST]} />);
    expect(screen.getAllByTestId('card-bowler').map((row) => row.textContent)).toEqual([
      'Away Player 111.0-0-7-1',
      'Away Player 101.0-0-5-1',
    ]);
    expect(texts('card-fall')).toEqual([
      '1-6 (Home Player 2, 0.3 ov), 2-7 (Home Player 3, 1.1 ov)',
    ]);
    expect(screen.getByText('Fall of wickets')).toBeTruthy();
  });

  it('draws only the sections an innings has: no batting, no extras, no bowling, no fall', () => {
    renderWithPorts(<CricketScorecard innings={[SECOND]} />);
    expect(texts('card-title')).toEqual(['Super over 1 · Away CC']);
    expect(texts('card-total')).toEqual(['9/0 declared · 1.0 ov']);
    for (const id of [
      'card-batting',
      'card-batter',
      'card-didnotbat',
      'card-extras',
      'card-bowling',
      'card-fall',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('draws every innings, in the order given, each in its own block', () => {
    renderWithPorts(<CricketScorecard innings={[FIRST, SECOND]} />);
    const blocks = screen.getAllByTestId('card-innings');
    expect(blocks).toHaveLength(2);
    expect(within(blocks[0] as HTMLElement).getByTestId('card-title').textContent).toBe(
      'Innings 1 · Home CC',
    );
    expect(within(blocks[1] as HTMLElement).getByTestId('card-title').textContent).toBe(
      'Super over 1 · Away CC',
    );
  });

  // A rule between innings so the second does not run into the first. The first has none (nothing is above it).
  it('rules the second innings off from the first, and the first has no rule', () => {
    renderWithPorts(<CricketScorecard innings={[FIRST, SECOND]} />);
    const [first, second] = screen.getAllByTestId('card-innings');
    expect(getComputedStyle(first as HTMLElement).borderTopWidth).not.toBe('1px');
    expect(getComputedStyle(second as HTMLElement).borderTopWidth).toBe('1px');
  });

  it('a section’s name is a heading to a screen reader', () => {
    renderWithPorts(<CricketScorecard innings={[FIRST]} />);
    expect(screen.getByRole('heading', { name: 'Innings 1 · Home CC' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Batting' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bowling' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fall of wickets' })).toBeTruthy();
  });

  // The four questions, another language.
  it('reads in Spanish', async () => {
    renderWithPorts(<CricketScorecard innings={[FIRST]} />, {
      kvSeed: { [STORE_KEYS.lang]: 'es' },
    });
    expect(await screen.findByText('Caída de wickets')).toBeTruthy();
    expect(texts('card-didnotbat')).toEqual(['No batearon: Home Player 5, Home Player 6']);
    expect(screen.getByRole('heading', { name: 'Bateo' })).toBeTruthy();
  });
});
