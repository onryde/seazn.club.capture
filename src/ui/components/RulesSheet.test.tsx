import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { RulesSheet } from '@/ui/components/RulesSheet';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner ruling 15 (2026-10-31): "a sheet over the pad with the match rules and Close". The kit's sheet takes words
// already translated: any sport's lines.
const LINES = ['Best of 3 games', '21 points a game, win by 2', 'Game capped at 30'] as const;

function renderSheet() {
  const onClose = vi.fn();
  renderWithPorts(
    <RulesSheet
      title={en['scoring.rules.title']}
      lines={LINES}
      closeLabel={en['panel.close']}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('RulesSheet', () => {
  it('shows its title, each line in order, and Close', () => {
    renderSheet();
    const sheet = screen.getByTestId('rules-sheet');
    expect(sheet.firstElementChild?.textContent).toBe(en['scoring.rules.title']);
    const lines = screen.getAllByTestId('rules-line').map((line) => line.textContent);
    expect(lines).toEqual(LINES);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      en['panel.close'],
    ]);
  });

  it('closes on Close and on a tap on the dim; the dim is a touch target only', () => {
    const { onClose } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['panel.close'] })));
    const dim = screen.getByTestId('rules-sheet').previousElementSibling;
    if (!(dim instanceof HTMLElement)) throw new Error('no dim');
    act(() => fireEvent.click(dim));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(dim.getAttribute('aria-hidden')).toBe('true');
  });

  it('is modal to a screen reader (the web’s half: native reads accessibilityViewIsModal, a device check)', () => {
    renderSheet();
    expect(screen.getByTestId('rules-sheet').getAttribute('aria-modal')).toBe('true');
  });

  it('shows a sheet with no lines as its title and Close (empty input)', () => {
    const onClose = vi.fn();
    renderWithPorts(
      <RulesSheet
        title={en['scoring.rules.title']}
        lines={[]}
        closeLabel="Close"
        onClose={onClose}
      />,
    );
    expect(screen.queryAllByTestId('rules-line')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
