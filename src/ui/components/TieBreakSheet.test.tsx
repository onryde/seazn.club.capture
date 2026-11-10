import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { TieBreakSheet } from '@/ui/components/TieBreakSheet';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The sheet of the tie-break steps (S2-3b Task 2): a title, a line of what the step means (the player who advances, the
// lots hint), the choices as rows that move on or as chips of which one is picked, and Cancel; Record only where the caller
// gives it a label. It sends nothing itself. How a picked chip's heavier lime border reads, the wrap at 320 dp and how the
// sheet sits over the pad are the device check's.

const ROWS = [
  { id: 'rapid', label: 'Rapid' },
  { id: 'blitz', label: 'Blitz' },
] as const;

const render = (over: Partial<Parameters<typeof TieBreakSheet>[0]> = {}) => {
  const calls = { pick: vi.fn(), record: vi.fn(), cancel: vi.fn() };
  renderWithPorts(
    <TieBreakSheet
      title="Which tie-break decided it?"
      body={null}
      hint={null}
      layout="rows"
      options={ROWS}
      picked={null}
      recordLabel={null}
      cancelLabel={en['scoring.sheet.cancel']}
      onPick={calls.pick}
      onRecord={calls.record}
      onCancel={calls.cancel}
      {...over}
    />,
  );
  return calls;
};

describe('TieBreakSheet as rows', () => {
  it('shows the title and every choice as a button that moves on, with Cancel and no Record', () => {
    render();
    expect(screen.getByText('Which tie-break decided it?')).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Rapid',
      'Blitz',
      en['scoring.sheet.cancel'],
    ]);
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });

  it('a tap on a row gives its id', () => {
    const { pick } = render();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Blitz' })));
    expect(pick.mock.calls).toEqual([['blitz']]);
  });

  it('shows the hint and the body when given, and neither when not', () => {
    render({ hint: 'Decided by lot?', body: 'L. Chen advances · Rapid' });
    expect(screen.getByText('Decided by lot?')).toBeTruthy();
    expect(screen.getByText('L. Chen advances · Rapid')).toBeTruthy();
  });

  it('with no choices and a Record label is the confirm: the body, Record and Cancel', () => {
    const { record } = render({
      options: [],
      body: 'L. Chen advances · Armageddon',
      recordLabel: en['scoring.chess.how.record'],
    });
    expect(screen.getByText('L. Chen advances · Armageddon')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.how.record'] })),
    );
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('TieBreakSheet as chips', () => {
  const CHIPS = [
    { id: 'none', label: 'No score' },
    { id: '2–0', label: '2–0' },
    { id: '1½–½', label: '1½–½' },
  ] as const;

  it('draws the choices as radios and says which is picked, with Record and Cancel', () => {
    render({
      layout: 'chips',
      options: CHIPS,
      picked: '2–0',
      recordLabel: en['scoring.chess.how.record'],
    });
    const chips = screen.getAllByRole('radio');
    expect(chips.map((chip) => chip.textContent)).toEqual(['No score', '2–0', '1½–½']);
    expect(chips.map((chip) => chip.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(screen.getByRole('button', { name: en['scoring.chess.how.record'] })).toBeTruthy();
  });

  it('a tap on a chip picks it; on the picked one it gives none back', () => {
    const { pick } = render({ layout: 'chips', options: CHIPS, picked: '2–0' });
    act(() => fireEvent.click(screen.getByRole('radio', { name: '1½–½' })));
    act(() => fireEvent.click(screen.getByRole('radio', { name: '2–0' })));
    expect(pick.mock.calls).toEqual([['1½–½'], [null]]);
  });
});

describe('TieBreakSheet, always', () => {
  it('Cancel and the dim are each a cancel, and Record is not', () => {
    const { cancel, record } = render();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    act(() => fireEvent.click(screen.getByTestId('tiebreak-dim')));
    expect([cancel.mock.calls.length, record.mock.calls.length]).toEqual([2, 0]);
  });

  it('is modal to a screen reader, and its dim is hidden from one', () => {
    render();
    expect(screen.getByTestId('tiebreak-sheet').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('tiebreak-dim').getAttribute('aria-hidden')).toBe('true');
  });
});

// Owner rulings 82 and 85 (2026-11-07): the tie-break's rows are the step sheet's (`StepRow`), so they take its lime
// border; its chips are How's. jsdom reads the tokens; how they read on a phone is the device check's (plan Task 19).
describe('TieBreakSheet rows (rulings 82, 85)', () => {
  it('a tie-break row has the lime border', () => {
    render();
    const row = getComputedStyle(screen.getByRole('button', { name: 'Blitz' }));
    expect([row.borderTopColor, row.borderTopWidth]).toEqual([
      edgeOf(colour.lime),
      `${layout.iconBorder}px`,
    ]);
  });

  it('a tie-break chip has the lime border', () => {
    render({ layout: 'chips', options: [{ id: 'none', label: 'No score' }] });
    const chip = getComputedStyle(screen.getByRole('radio', { name: 'No score' }));
    expect(chip.borderTopColor).toBe(edgeOf(colour.lime));
  });
});
