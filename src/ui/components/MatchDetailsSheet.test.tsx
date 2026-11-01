import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { MatchDetailsSheet } from '@/ui/components/MatchDetailsSheet';
import { Text } from '@/ui/components/Text';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner ruling 15 (2026-10-31): "a sheet over the pad with the match rules and Close"; owner, 2026-11-01: it becomes
// Match details. The kit's sheet takes what it says already drawn: any sport's block and lines.
function renderSheet() {
  const onClose = vi.fn();
  renderWithPorts(
    <MatchDetailsSheet
      title={en['scoring.details.title']}
      closeLabel={en['panel.close']}
      onClose={onClose}
    >
      <Text variant="body">first</Text>
      <Text variant="body">second</Text>
    </MatchDetailsSheet>,
  );
  return { onClose };
}

describe('MatchDetailsSheet', () => {
  it('shows its title, then what it says in a scroll, then Close', () => {
    renderSheet();
    const sheet = screen.getByTestId('details-sheet');
    expect([...sheet.children].map((child) => child.textContent)).toEqual([
      en['scoring.details.title'],
      'firstsecond',
      en['panel.close'],
    ]);
    expect(sheet.children[1]).toBe(screen.getByTestId('details-scroll'));
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      en['panel.close'],
    ]);
  });

  it('scrolls what is between the title and Close, and the sheet gives way to a short screen', () => {
    renderSheet();
    expect(getComputedStyle(screen.getByTestId('details-scroll')).overflowY).not.toBe('visible');
    expect(getComputedStyle(screen.getByTestId('details-sheet')).flexShrink).toBe('1');
  });

  it('closes on Close and on a tap on the dim; the dim is a touch target only', () => {
    const { onClose } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['panel.close'] })));
    const dim = screen.getByTestId('details-sheet').previousElementSibling;
    if (!(dim instanceof HTMLElement)) throw new Error('no dim');
    act(() => fireEvent.click(dim));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(dim.getAttribute('aria-hidden')).toBe('true');
  });

  it('is modal to a screen reader (the web’s half: native reads accessibilityViewIsModal, a device check)', () => {
    renderSheet();
    expect(screen.getByTestId('details-sheet').getAttribute('aria-modal')).toBe('true');
  });
});
