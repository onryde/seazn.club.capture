import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { HistoryCover, type HistoryGroupWords } from '@/ui/components/HistoryCover';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner ruling 21 (2026-10-31), History, view only. The kit's cover takes words already translated (any sport's rows);
// the screen's suite drives it through the fake.
const GROUPS: readonly HistoryGroupWords[] = [
  {
    heading: 'Game 2',
    rows: [
      {
        said: 'Rally recorded — L. Chen',
        score: '0–1',
        by: en['scoring.history.thisPhone'],
        undone: en['scoring.history.undone'],
      },
    ],
  },
  {
    heading: 'Game 1',
    rows: [
      {
        said: 'Sanction recorded — Warning, L. Chen',
        score: null,
        by: en['scoring.history.otherScorer'],
        undone: null,
      },
    ],
  },
];

function renderCover(groups: readonly HistoryGroupWords[] = GROUPS) {
  const onClose = vi.fn();
  renderWithPorts(
    <HistoryCover
      title={en['scoring.history.title']}
      closeLabel={en['panel.close']}
      empty={en['scoring.history.empty']}
      groups={groups}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('HistoryCover', () => {
  it('covers the whole pad on the ground, modal to a screen reader, its list in a scroll view', () => {
    renderCover();
    const cover = screen.getByTestId('history');
    const style = getComputedStyle(cover);
    expect([style.position, style.top, style.bottom, style.left, style.right]).toEqual([
      'absolute',
      '0px',
      '0px',
      '0px',
      '0px',
    ]);
    expect(style.backgroundColor).toBe(fillOf(colour.ground));
    expect(cover.getAttribute('aria-modal')).toBe('true');
    expect(getComputedStyle(screen.getByTestId('history-list')).overflowY).toMatch(/auto|scroll/);
  });

  it('reads each row as one line: sentence, score, recorder, and “Undone” when it applies', () => {
    renderCover();
    expect(
      screen.getAllByTestId('history-row').map((row) => row.getAttribute('aria-label')),
    ).toEqual([
      `Rally recorded — L. Chen, 0–1, ${en['scoring.history.thisPhone']}, ${en['scoring.history.undone']}`,
      `Sanction recorded — Warning, L. Chen, ${en['scoring.history.otherScorer']}`,
    ]);
  });

  it('heads each group in ink2 (a display role with no colour of its own would be black on Fabric)', () => {
    renderCover();
    const headings = screen.getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual(['Game 2', 'Game 1']);
    for (const heading of headings)
      expect(getComputedStyle(heading).color).toBe(edgeOf(colour.ink2));
  });

  it('wraps a sentence to at most two lines; the score, recorder and “Undone” stand beside it, never cut', () => {
    renderCover();
    const [said] = screen.getAllByTestId('history-said');
    if (said === undefined) throw new Error('no row');
    expect(getComputedStyle(said).webkitLineClamp).toBe(String(layout.padHistoryLines));
    const side = screen.getAllByTestId('history-side')[0];
    if (side === undefined) throw new Error('no side');
    for (const word of within(side).getAllByText(/./)) {
      expect(getComputedStyle(word).webkitLineClamp).toBe('');
      expect(getComputedStyle(word).whiteSpace).not.toBe('nowrap');
    }
    expect(getComputedStyle(side).alignItems).toBe('flex-end');
    expect(getComputedStyle(side).width).toBe(`${layout.padHistorySide}px`);
    for (const word of within(side).getAllByText(/./))
      expect(getComputedStyle(word).textAlign).toBe('right');
  });

  it('says “Nothing recorded yet” and draws no row for an empty match', () => {
    renderCover([]);
    expect(screen.getByText(en['scoring.history.empty'])).toBeTruthy();
    expect(screen.queryAllByTestId('history-row')).toEqual([]);
  });

  it('closes on Back, its one button', () => {
    const { onClose } = renderCover();
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual([en['panel.close']]);
    act(() => fireEvent.click(screen.getByRole('button', { name: en['panel.close'] })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
