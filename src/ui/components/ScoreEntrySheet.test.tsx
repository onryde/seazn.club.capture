import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { ScoreEntrySheet } from '@/ui/components/ScoreEntrySheet';
import { renderWithPorts } from '../../../test/renderWithPorts';

const label = (side: string) => en['scoring.setScore.field'].replace('{side}', side);
const TITLE = en['scoring.setScore.title'].replace('{game}', '2');

function renderSheet(bound?: number) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  renderWithPorts(
    <ScoreEntrySheet
      title={TITLE}
      labels={[label('A. Sharma'), label('L. Chen')]}
      initial={[0, 0]}
      bound={bound}
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
    expect(screen.getByText(TITLE)).toBeTruthy();
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

  // Plan S2-2 Task 8 (the controller's ruling 2): the most a field may hold is the sport's, not the sheet's. Table tennis
  // gives its engine's bound for the match's rules (31, or 41 for the hardbat variant); badminton gives none.
  describe.each([31, 41])('bounded at %i', (bound) => {
    it('takes the bound itself and enables Confirm', () => {
      renderSheet(bound);
      type('A. Sharma', String(bound));
      expect(confirm().getAttribute('aria-disabled')).not.toBe('true');
    });

    it('keeps Confirm disabled one above the bound, and saves nothing', () => {
      const { onSave } = renderSheet(bound);
      type('L. Chen', String(bound + 1));
      expect(confirm().getAttribute('aria-disabled')).toBe('true');
      act(() => fireEvent.click(confirm()));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('lets a scorer back under the bound after going over it', () => {
      renderSheet(bound);
      type('A. Sharma', String(bound + 1));
      type('A. Sharma', String(bound));
      expect(confirm().getAttribute('aria-disabled')).not.toBe('true');
    });
  });

  it('holds the bound on either field, not only the first', () => {
    renderSheet(31);
    type('A. Sharma', '5');
    type('L. Chen', '32');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
  });

  it('stops typing at the bound’s digits: two for 31, and three with no bound, as before', () => {
    renderSheet(31);
    expect(field('A. Sharma').getAttribute('maxlength')).toBe('2');
    cleanup();
    renderSheet();
    expect(field('A. Sharma').getAttribute('maxlength')).toBe('3');
  });

  it('with no bound takes a three-digit number, as it always has (badminton’s sheet)', () => {
    const { onSave } = renderSheet();
    type('A. Sharma', '999');
    act(() => fireEvent.click(confirm()));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('999', '0');
  });
});
