import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { RuleLines } from '@/ui/components/RuleLines';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner, 2026-11-01: the Match details sheet and the Not started card show the rules under a "Rules" subheading,
// through this one component. It takes words already translated: any sport's lines.
const LINES = ['Best of 3 games', '21 points a game, win by 2', 'Game capped at 30'] as const;

describe('RuleLines', () => {
  it('shows the subheading, a heading to a screen reader, then each line in order', () => {
    renderWithPorts(<RuleLines heading={en['scoring.rules.heading']} lines={LINES} />);
    const block = screen.getByTestId('rule-lines');
    expect(block.firstElementChild?.textContent).toBe(en['scoring.rules.heading']);
    expect(screen.getByRole('heading').textContent).toBe(en['scoring.rules.heading']);
    expect(screen.getAllByTestId('rules-line').map((line) => line.textContent)).toEqual(LINES);
  });

  it('shows the subheading alone for a match with no lines (empty input)', () => {
    renderWithPorts(<RuleLines heading={en['scoring.rules.heading']} lines={[]} />);
    expect(screen.queryAllByTestId('rules-line')).toEqual([]);
    expect(screen.getByTestId('rule-lines').textContent).toBe(en['scoring.rules.heading']);
  });
});
