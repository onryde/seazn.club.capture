import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadSide, PadStartSide } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import { TossPicker } from '@/ui/components/TossPicker';
import { colour, layout, plateInk, space } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner, 2026-11-01, option A: "Who serves first?" with the two sides as two big buttons, the names as typed, one
// choice; the picked one drawn as selected (lime, AGENTS §5). A radio group to a screen reader.
const SIDES: readonly [PadStartSide, PadStartSide] = [
  { side: 'first', label: 'A. Sharma / R. Iyer' },
  { side: 'second', label: 'L. Chen / M. Wong' },
];

function renderToss(picked: PadSide | null) {
  const onPick = vi.fn();
  renderWithPorts(
    <TossPicker
      ask={en['scoring.badminton.start.ask']}
      sides={SIDES}
      picked={picked}
      onPick={onPick}
    />,
  );
  return { onPick };
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('TossPicker', () => {
  it('asks, as a heading, then offers the two sides, top first, as a radio group the question names', () => {
    renderToss(null);
    expect(screen.getByRole('heading').textContent).toBe(en['scoring.badminton.start.ask']);
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-label')).toBe(en['scoring.badminton.start.ask']);
    expect(screen.getAllByRole('radio').map((side) => side.textContent)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
    expect(screen.getAllByRole('radio').map((side) => side.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
    ]);
  });

  it('says which side a tap picked, each tap once', () => {
    const { onPick } = renderToss(null);
    act(() => fireEvent.click(radio('L. Chen / M. Wong')));
    act(() => fireEvent.click(radio('A. Sharma / R. Iyer')));
    expect(onPick.mock.calls).toEqual([['second'], ['first']]);
  });

  it('draws the picked side as the lime plate with night ink, and the other as the board', () => {
    renderToss('second');
    const picked = radio('L. Chen / M. Wong');
    const other = radio('A. Sharma / R. Iyer');
    expect([picked.getAttribute('aria-checked'), other.getAttribute('aria-checked')]).toEqual([
      'true',
      'false',
    ]);
    expect(getComputedStyle(picked).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(picked).borderTopColor).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(other).backgroundColor).toBe(fillOf(colour.surface));
    expect(getComputedStyle(other).borderTopColor).toBe(edgeOf(colour.ink3));
    const name = (side: HTMLElement) => side.firstElementChild as HTMLElement;
    expect(getComputedStyle(name(picked)).color).toBe(edgeOf(plateInk));
    expect(getComputedStyle(name(other)).color).toBe(edgeOf(colour.ink));
  });

  // padFit.test.ts: two of `padTossMin` and the gap fit the column at 320, and every word of the doubles names fits a
  // button's text at 320 and 360. The names have no line limit: they wrap, never cut.
  it('stands the sides side by side, wrapping onto a second row when two do not fit, and never cuts a name', () => {
    renderToss(null);
    const row = screen.getByRole('radiogroup');
    expect([
      getComputedStyle(row).flexDirection,
      getComputedStyle(row).flexWrap,
      getComputedStyle(row).gap,
    ]).toEqual(['row', 'wrap', `${space.sm}px`]);
    for (const side of screen.getAllByRole('radio')) {
      const style = getComputedStyle(side);
      expect([style.flexGrow, style.flexBasis, style.minHeight]).toEqual([
        '1',
        `${layout.padTossMin}px`,
        `${layout.padTossHeight}px`,
      ]);
      const name = side.firstElementChild as HTMLElement;
      expect(getComputedStyle(name).whiteSpace).not.toBe('nowrap');
      expect(getComputedStyle(name).webkitLineClamp).toBe('');
    }
  });
});
