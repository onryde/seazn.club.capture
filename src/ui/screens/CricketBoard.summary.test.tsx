import { screen, within } from '@testing-library/react';
import type { TextProps } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import type { CricketBoardView } from '@/domain/scoring/cricketPad';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { layout } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The result's summary (T19 fix 10): a block a side with its top bat, best bowl and extras. Text is stood in for so the
// props a phone acts on (one line, an ellipsis, the figures' face) can be read; that a long name is then cut on the phone
// is the device check's. Names and figures are written out here, labels are the dictionary's.
vi.mock('@/ui/components/Text', () => ({
  Text: (props: TextProps & { variant: string }) => (
    <span
      data-testid={props.testID}
      data-variant={props.variant}
      data-lines={String(props.numberOfLines)}
      data-ellipsis={String(props.ellipsizeMode)}
    >
      {props.children}
    </span>
  ),
}));

const EXTRAS = {
  key: 'scoring.cricket.card.extras',
  vars: { total: 7, wides: 3, noBalls: 2, byes: 1, legByes: 1 },
} as const;

const VIEW: CricketBoardView = {
  score: null,
  result: [
    { team: 'South XI', figures: '61/1', overs: '2' },
    { team: 'North XI', figures: '56/0', overs: '2' },
  ],
  crease: null,
  bowler: null,
  over: null,
  status: null,
  summary: [
    {
      team: 'South XI',
      top: { name: 'Asha Rao', runs: 46, balls: 11 },
      best: { name: 'Ben Ito', wickets: 1, runs: 12, overs: '2' },
      extras: EXTRAS,
    },
    { team: 'North XI', top: null, best: null, extras: null },
  ],
};

describe('the result’s summary', () => {
  it('a block a side: the side, its top bat and best bowl as name and figures, and its extras', () => {
    renderWithPorts(<CricketBoard view={VIEW} />);
    const blocks = screen.getAllByTestId('summary-block');
    expect(blocks).toHaveLength(2);
    const first = within(blocks[0]!);
    expect(first.getByTestId('summary-team').textContent).toBe('South XI');
    const top = within(first.getByTestId('summary-top'));
    expect(top.getByText(en['scoring.cricket.board.summary.top'])).toBeTruthy();
    expect(top.getByText('Asha Rao')).toBeTruthy();
    expect(top.getByText('46 (11)')).toBeTruthy();
    const best = within(first.getByTestId('summary-best'));
    expect(best.getByText(en['scoring.cricket.board.summary.best'])).toBeTruthy();
    expect(best.getByText('Ben Ito')).toBeTruthy();
    expect(best.getByText('1-12 (2)')).toBeTruthy();
    expect(first.getByTestId('summary-extras').textContent).toBe('Extras 7 (w 3, nb 2, b 1, lb 1)');
  });

  it('a side with nothing to show keeps its heading and no empty rows', () => {
    renderWithPorts(<CricketBoard view={VIEW} />);
    const second = within(screen.getAllByTestId('summary-block')[1]!);
    expect(second.getByTestId('summary-team').textContent).toBe('North XI');
    expect(second.queryByTestId('summary-top')).toBeNull();
    expect(second.queryByTestId('summary-best')).toBeNull();
    expect(second.queryByTestId('summary-extras')).toBeNull();
  });

  it('a board without a summary (play, a break) draws none', () => {
    renderWithPorts(<CricketBoard view={{ ...VIEW, summary: null }} />);
    expect(screen.queryByTestId('summary-block')).toBeNull();
  });

  it('names are one line with an ellipsis, figures are the tabular type, and a row reads as one line', () => {
    renderWithPorts(<CricketBoard view={VIEW} />);
    const row = screen.getAllByTestId('summary-top')[0]!;
    const name = within(row).getByTestId('summary-top-name');
    expect([name.dataset.lines, name.dataset.ellipsis]).toEqual(['1', 'tail']);
    expect(within(row).getByTestId('summary-top-figures').dataset.variant).toBe('metricValue');
    expect(row.getAttribute('aria-label')).toBe(
      `${en['scoring.cricket.board.summary.top']}, Asha Rao, 46 (11)`,
    );
    expect(getComputedStyle(row).height).toBe(`${layout.creaseRow}px`);
    expect(screen.getAllByTestId('summary-team')[0]!.dataset.lines).toBe('1');
  });

  it('is in the phone’s language', () => {
    renderWithPorts(<CricketBoard view={VIEW} />, { deviceLanguages: ['es'] });
    expect(
      within(screen.getAllByTestId('summary-top')[0]!).getByText(
        es['scoring.cricket.board.summary.top'],
      ),
    ).toBeTruthy();
  });
});
