import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchRow } from '@/ui/components/MatchRow';

// MD-2 Task 4, the dispatch's ruling 5: rows are not tappable yet, but are 48 dp row components with an optional
// onPress, so Task 5 wires the press and not a new row. Online rows never get one (MatchDayScreen.test.tsx).

describe('MatchRow', () => {
  it('without onPress is not a control, and reads as one line', () => {
    render(<MatchRow label="Now" names="Ng v Brown" detail="14-9" />);
    const row = screen.getByTestId('match-row');
    expect(row.getAttribute('role')).not.toBe('button');
    expect(row.getAttribute('aria-label')).toBe('Now, Ng v Brown, 14-9');
    expect(screen.queryByRole('button')).toBeNull();
    // The label is drawn in its column, as are the names and the detail.
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
    expect(screen.getByText('14-9')).toBeTruthy();
  });

  it('with onPress is a button of the same name, 48 dp tall, and a press calls it once', () => {
    const press = vi.fn();
    render(<MatchRow label="Next" names="Patel v Okafor" detail="14:40" onPress={press} />);
    const row = screen.getByRole('button', { name: 'Next, Patel v Okafor, 14:40' });
    expect(getComputedStyle(row).minHeight).toBe('48px');
    fireEvent.click(row);
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('a spoken label is read first and not drawn', () => {
    render(<MatchRow spoken="Finished" names="Ann v Cat" detail="21-15" dim />);
    expect(screen.getByTestId('match-row').getAttribute('aria-label')).toBe(
      'Finished, Ann v Cat, 21-15',
    );
    expect(screen.queryByText('Finished')).toBeNull();
  });

  it('with no label and no detail reads the names alone', () => {
    render(<MatchRow names="Singh v Murphy" detail={null} />);
    expect(screen.getByTestId('match-row').getAttribute('aria-label')).toBe('Singh v Murphy');
  });
});
