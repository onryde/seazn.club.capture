import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { LeaveCourtSheet } from '@/ui/components/LeaveCourtSheet';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Court stream (spec 2026-11-14 §6.4): the Leave question over the waiting screen, on Exit's own shape: Stay is the
// lime plate and first, Leave the outline, and the dim means Stay.
const sheet = (onStay = vi.fn(), onLeave = vi.fn(), options = {}) => {
  const view = renderWithPorts(
    <LeaveCourtSheet court="Court 2" onStay={onStay} onLeave={onLeave} />,
    options,
  );
  return { view, onStay, onLeave };
};

describe('the Leave question', () => {
  it('names the court in its title and says what leaving costs', () => {
    sheet();
    expect(screen.getByText('Leave Court 2?')).toBeTruthy();
    expect(screen.getByText(en['stream.court.leaveBody'])).toBeTruthy();
  });

  it('puts Stay first, then Leave, and presses each once', () => {
    const { onStay, onLeave } = sheet();
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual([en['stream.court.stay'], en['stream.court.leave']]);
    fireEvent.click(screen.getByRole('button', { name: en['stream.court.stay'] }));
    expect(onStay).toHaveBeenCalledOnce();
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en['stream.court.leave'] }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('means Stay when the dim is pressed', () => {
    const { onStay, onLeave } = sheet();
    fireEvent.click(screen.getByTestId('leave-court-dim'));
    expect(onStay).toHaveBeenCalledOnce();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('is a modal: the sheet is marked modal and the dim is hidden from a screen reader', () => {
    sheet();
    expect(screen.getByTestId('leave-court-sheet').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('leave-court-dim').getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('reads in %s', (lang, dictionary) => {
    sheet(vi.fn(), vi.fn(), { deviceLanguages: [lang] });
    // getByText normalises a no-break space (French sets one before the question mark) to a plain one in the node's text.
    const title = (dictionary['stream.court.leaveTitle'] as string)
      .replace('{court}', 'Court 2')
      .replaceAll(String.fromCodePoint(0x00a0), ' ');
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByRole('button', { name: dictionary['stream.court.stay'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: dictionary['stream.court.leave'] })).toBeTruthy();
  });
});
