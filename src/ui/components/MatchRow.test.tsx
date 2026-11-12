import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchRow } from '@/ui/components/MatchRow';
import { colour, font, layout } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';

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

  it('names in the house face for player names, Barlow Condensed 600 at 16, cream, never under their floor (review M1, I2)', () => {
    render(<MatchRow label="Now" names="Lee / Tan v Ashok / Ravi" detail="14:40" />);
    const names = getComputedStyle(screen.getByText('Lee / Tan v Ashok / Ravi'));
    expect([names.fontFamily, names.fontSize, names.color]).toEqual([
      font.displaySemibold,
      '16px',
      edgeOf(colour.ink),
    ]);
    expect(names.minWidth).toBe(`${layout.matchDayNamesMin}px`);
    expect(names.whiteSpace).toBe('nowrap');
    expect(names.textOverflow).toBe('ellipsis');
  });

  it('the detail is one line that gives way with an ellipsis, so a long headline never pushes the names out (review I2)', () => {
    const headline = '1 — 1 · 21–15, 18–21 (14–9)';
    render(<MatchRow label="Now" names="Ng v Brown" detail={headline} />);
    const detail = getComputedStyle(screen.getByText(headline));
    expect(detail.whiteSpace).toBe('nowrap');
    expect(detail.textOverflow).toBe('ellipsis');
    expect(detail.flexShrink).toBe('1');
    expect(detail.minWidth).toBe('0px');
  });

  it('dimmed, the names and the detail are in the inert ink', () => {
    render(<MatchRow names="Ann v Cat" detail="21–15" dim />);
    expect(getComputedStyle(screen.getByText('Ann v Cat')).color).toBe(edgeOf(colour.ink3));
    expect(getComputedStyle(screen.getByText('21–15')).color).toBe(edgeOf(colour.ink3));
  });

  it('with no label and no detail reads the names alone', () => {
    render(<MatchRow names="Singh v Murphy" detail={null} />);
    expect(screen.getByTestId('match-row').getAttribute('aria-label')).toBe('Singh v Murphy');
  });
});
