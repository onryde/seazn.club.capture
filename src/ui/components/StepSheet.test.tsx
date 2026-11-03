import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { StepSheet } from '@/ui/components/StepSheet';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const options = [
  { id: 'warning', label: en['scoring.sanction.warning'], tone: 'standard' },
  { id: 'disqualification', label: en['scoring.sanction.disqualification'], tone: 'destructive' },
] as const;

function renderSheet(body: string | null = 'A. Sharma') {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  renderWithPorts(
    <StepSheet
      title={en['scoring.sanction.title']}
      body={body}
      options={options}
      cancelLabel={en['scoring.sheet.cancel']}
      onChoose={onChoose}
      onCancel={onCancel}
    />,
  );
  return { onChoose, onCancel };
}

describe('StepSheet', () => {
  it('shows the step’s title, what is chosen so far, and each choice', () => {
    renderSheet();
    expect(screen.getByText(en['scoring.sanction.title'])).toBeTruthy();
    expect(screen.getByText('A. Sharma')).toBeTruthy();
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual([
      en['scoring.sanction.warning'],
      en['scoring.sanction.disqualification'],
      en['scoring.sheet.cancel'],
    ]);
  });

  it('hands the chosen id back', () => {
    const { onChoose, onCancel } = renderSheet();
    act(() =>
      fireEvent.click(
        screen.getByRole('button', { name: en['scoring.sanction.disqualification'] }),
      ),
    );
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('disqualification');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('closes on Cancel and on a tap on the dim, with nothing chosen', () => {
    const { onChoose, onCancel } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    const dim = screen.getByTestId('step-sheet').previousElementSibling;
    if (!(dim instanceof HTMLElement)) throw new Error('no dim');
    act(() => fireEvent.click(dim));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
    expect(dim.getAttribute('aria-hidden')).toBe('true');
  });

  it('is modal to a screen reader (the web’s half: native reads accessibilityViewIsModal, a device check)', () => {
    renderSheet();
    expect(screen.getByTestId('step-sheet').getAttribute('aria-modal')).toBe('true');
  });

  it('draws a destructive choice in caution', () => {
    renderSheet(null);
    const edge = getComputedStyle(
      screen.getByRole('button', { name: en['scoring.sanction.disqualification'] }),
    ).borderTopColor;
    expect(edge).toBe(edgeOf(colour.caution));
    expect(screen.queryByText('A. Sharma')).toBeNull();
  });
});
