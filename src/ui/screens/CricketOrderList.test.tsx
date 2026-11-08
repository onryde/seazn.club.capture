import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SetupBatter } from '@/domain/scoring/cricketSetup';
import en from '@/i18n/en.json';
import { CricketOrderList } from '@/ui/screens/CricketOrderList';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The batting order (S2-4 spec §4.1 step 3; plan Task 10): the starters in order, Opener on the first two, ▲▼ on each,
// written out here. Which order the match holds and that the openers follow it is the hook's (`useCricketMatch.test.tsx`);
// here the list draws what it is given and hands each move back. The lime is the phone's to see (Task 19).

const ORDER: readonly SetupBatter[] = [
  { id: 'r1', name: 'A. Sharma', opener: true },
  { id: 'r2', name: 'B. Okafor', opener: true },
  { id: 'r3', name: 'C. Mendes', opener: false },
  { id: 'r4', name: 'D. Walsh', opener: false },
];

const up = (name: string) => en['scoring.cricket.setup.up'].replace('{name}', name);
const down = (name: string) => en['scoring.cricket.setup.down'].replace('{name}', name);

function renderOrder() {
  const onMove = vi.fn();
  renderWithPorts(<CricketOrderList order={ORDER} onMove={onMove} />);
  return { onMove };
}

describe('CricketOrderList', () => {
  it('the order lists starters only, Opener on the first two', () => {
    renderOrder();
    const rows = ORDER.map((one) => screen.getByTestId(`order-${one.id}`));
    expect(rows.map((row) => within(row).getByText(/\./).textContent)).toEqual([
      'A. Sharma',
      'B. Okafor',
      'C. Mendes',
      'D. Walsh',
    ]);
    expect(rows.map((row) => within(row).queryByTestId('opener')?.textContent ?? null)).toEqual([
      en['scoring.cricket.setup.opener'],
      en['scoring.cricket.setup.opener'],
      null,
      null,
    ]);
    expect(rows.map((row) => within(row).getByText(/^\d+$/).textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  it('Up and Down hand the move back, one place, naming the batter to a screen reader', () => {
    const { onMove } = renderOrder();
    act(() => fireEvent.click(screen.getByRole('button', { name: up('C. Mendes') })));
    act(() => fireEvent.click(screen.getByRole('button', { name: down('A. Sharma') })));
    expect(onMove.mock.calls).toEqual([
      [2, 1],
      [0, 1],
    ]);
  });

  it('the first’s Up and the last’s Down are greyed and take no press', () => {
    const { onMove } = renderOrder();
    for (const name of [up('A. Sharma'), down('D. Walsh')]) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(getComputedStyle(button).borderTopColor).toBe(edgeOf(colour.ink3));
      act(() => fireEvent.click(button));
    }
    expect(onMove).not.toHaveBeenCalled();
  });

  it('a move that takes a tap has the lime border and a 48 dp target; the row has no border', () => {
    renderOrder();
    const button = screen.getByRole('button', { name: up('B. Okafor') });
    const style = getComputedStyle(button);
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect([style.borderTopColor, style.borderTopWidth, style.width, style.height]).toEqual([
      edgeOf(colour.lime),
      `${layout.iconBorder}px`,
      `${layout.touch}px`,
      `${layout.touch}px`,
    ]);
    expect(getComputedStyle(screen.getByTestId('order-r2')).borderTopWidth).toBe('0px');
  });
});
