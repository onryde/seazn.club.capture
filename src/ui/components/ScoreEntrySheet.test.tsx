import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { ScoreEntrySheet } from '@/ui/components/ScoreEntrySheet';
import { renderWithPorts } from '../../../test/renderWithPorts';

const label = (side: string) => en['scoring.setScore.field'].replace('{side}', side);

function renderSheet() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  renderWithPorts(
    <ScoreEntrySheet
      title={en['scoring.setScore.title']}
      labels={[label('A. Sharma'), label('L. Chen')]}
      initial={[0, 0]}
      confirmLabel={en['scoring.setScore.confirm']}
      cancelLabel={en['scoring.sheet.cancel']}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel };
}

const field = (side: string) => screen.getByLabelText(label(side));
const confirm = () => screen.getByRole('button', { name: en['scoring.setScore.confirm'] });
const type = (side: string, value: string) =>
  act(() => fireEvent.change(field(side), { target: { value } }));

describe('ScoreEntrySheet', () => {
  it('starts each side’s field at the points now', () => {
    renderSheet();
    expect((field('A. Sharma') as HTMLInputElement).value).toBe('0');
    expect((field('L. Chen') as HTMLInputElement).value).toBe('0');
    expect(screen.getByText(en['scoring.setScore.title'])).toBeTruthy();
  });

  it('hands both fields back as typed, top side first', () => {
    const { onSave } = renderSheet();
    type('A. Sharma', '7');
    type('L. Chen', '5');
    act(() => fireEvent.click(confirm()));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('7', '5');
  });

  it.each(['', 'abc', '3.5', '-2'])('keeps Confirm disabled while a field reads %j', (value) => {
    const { onSave } = renderSheet();
    type('L. Chen', value);
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    act(() => fireEvent.click(confirm()));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('enables Confirm again once the field reads a whole number', () => {
    renderSheet();
    type('A. Sharma', '');
    type('A. Sharma', '12');
    expect(confirm().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('closes on Cancel with nothing saved', () => {
    const { onSave, onCancel } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('score-sheet').getAttribute('aria-modal')).toBe('true');
  });
});
