import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { HowSheet } from '@/ui/components/HowSheet';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The sheet that asks How a game ended (plan S2-3 Task 3): a title, the methods as one choice among them or none, Record
// and Cancel. It sends nothing itself; the caller holds the pick. How the picked chip's heavier lime border reads, the wrap
// of the chips at 320 dp and how the sheet sits over the pad are the device check's.

const OPTIONS = [
  { id: 'checkmate', label: 'Checkmate' },
  { id: 'resign', label: 'Resignation' },
  { id: 'time', label: 'Time' },
] as const;

const render = (over: Partial<Parameters<typeof HowSheet>[0]> = {}) => {
  const calls = { pick: vi.fn(), record: vi.fn(), cancel: vi.fn() };
  renderWithPorts(
    <HowSheet
      title="How did A. Sharma win?"
      options={OPTIONS}
      picked={null}
      recordLabel={en['scoring.chess.how.record']}
      cancelLabel={en['scoring.sheet.cancel']}
      onPick={calls.pick}
      onRecord={calls.record}
      onCancel={calls.cancel}
      {...over}
    />,
  );
  return calls;
};

describe('HowSheet', () => {
  it('shows the title and every method as a choice, none picked, with Record and Cancel', () => {
    render();
    expect(screen.getByText('How did A. Sharma win?')).toBeTruthy();
    const choices = screen.getAllByRole('radio');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'Checkmate',
      'Resignation',
      'Time',
    ]);
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
    ]);
    expect(screen.getByRole('button', { name: en['scoring.chess.how.record'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })).toBeTruthy();
  });

  it('says which method is picked, to a screen reader as well as the eye', () => {
    render({ picked: 'resign' });
    const choices = screen.getAllByRole('radio');
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('a tap on a method picks it', () => {
    const { pick } = render();
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'Time' })));
    expect(pick.mock.calls).toEqual([['time']]);
  });

  it('a tap on the picked method gives none back', () => {
    const { pick } = render({ picked: 'time' });
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'Time' })));
    expect(pick.mock.calls).toEqual([[null]]);
  });

  it('Record, Cancel and the dim are each their own call', () => {
    const { record, cancel } = render();
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.how.record'] })),
    );
    expect([record.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 0]);
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    expect([record.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 1]);
    act(() => fireEvent.click(screen.getByTestId('how-dim')));
    expect([record.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 2]);
  });

  it('is modal to a screen reader, and its dim is hidden from one', () => {
    render();
    expect(screen.getByTestId('how-sheet').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('how-dim').getAttribute('aria-hidden')).toBe('true');
  });

  it('offers no method when the list is empty, and still Record and Cancel', () => {
    render({ options: [] });
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

// Owner rulings 82 and 85 (2026-11-07): How's methods are rows that take a tap, as every sport's sheets have them: a lime
// border, and the picked one the heavier lime border on surface (the shared row style, `sheetRow.ts`). jsdom reads the
// tokens; how they read on a phone is the device check's (plan Task 19).
describe('HowSheet rows (rulings 82, 85)', () => {
  it('a How row has the lime border, and the picked one the heavier lime border on surface', () => {
    render({ picked: 'resign' });
    const plain = getComputedStyle(screen.getByRole('radio', { name: 'Time' }));
    expect([plain.borderTopColor, plain.borderTopWidth]).toEqual([
      edgeOf(colour.lime),
      `${layout.iconBorder}px`,
    ]);
    const picked = getComputedStyle(screen.getByRole('radio', { name: 'Resignation' }));
    expect([picked.borderTopColor, picked.borderTopWidth, picked.backgroundColor]).toEqual([
      edgeOf(colour.lime),
      `${layout.iconBorderOn}px`,
      fillOf(colour.surface),
    ]);
  });
});
