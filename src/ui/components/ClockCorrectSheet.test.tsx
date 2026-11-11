import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import {
  ClockCorrectSheet,
  type ClockCorrectWords,
  type ClockStep,
} from '@/ui/components/ClockCorrectSheet';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Correct, the clock's sheet (S2-5 design §7.5; plan P Task 10): the reading, four steppers, Set and Cancel. The sheet
// holds no time of its own: the caller says the time and whether it is at the floor. Words are the caller's, so the kit
// names no sport.

const WORDS: ClockCorrectWords = {
  title: en['scoring.football.correct.title'],
  set: en['scoring.football.correct.set'],
  steps: {
    [-60]: en['scoring.football.correct.back60'],
    [-10]: en['scoring.football.correct.back10'],
    10: en['scoring.football.correct.fwd10'],
    60: en['scoring.football.correct.fwd60'],
  },
};
const FLOOR = en['scoring.football.correct.floor'];

function renderSheet(atFloor: boolean, time = '34:12') {
  const onStep = vi.fn<(step: ClockStep) => void>();
  const onSet = vi.fn();
  const onCancel = vi.fn();
  renderWithPorts(
    <ClockCorrectSheet
      time={time}
      atFloor={atFloor}
      floorLine={FLOOR}
      words={WORDS}
      onStep={onStep}
      onSet={onSet}
      onCancel={onCancel}
    />,
  );
  return { onStep, onSet, onCancel };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('ClockCorrectSheet', () => {
  it('shows the title, the time, the four steppers in order, then Set and Cancel', () => {
    renderSheet(false);
    expect(screen.getByText(WORDS.title)).toBeTruthy();
    expect(screen.getByText('34:12')).toBeTruthy();
    expect(screen.getAllByRole('button').map((each) => each.textContent)).toEqual([
      WORDS.steps[-60],
      WORDS.steps[-10],
      WORDS.steps[10],
      WORDS.steps[60],
      WORDS.set,
      en['scoring.sheet.cancel'],
    ]);
    expect(screen.queryByText(FLOOR)).toBeNull();
  });

  it('hands each step back as seconds, and Set and Cancel to their own', () => {
    const { onStep, onSet, onCancel } = renderSheet(false);
    act(() => fireEvent.click(button(WORDS.steps[60])));
    act(() => fireEvent.click(button(WORDS.steps[-10])));
    expect(onStep.mock.calls).toEqual([[60], [-10]]);
    act(() => fireEvent.click(button(WORDS.set)));
    expect(onSet).toHaveBeenCalledTimes(1);
    act(() => fireEvent.click(button(en['scoring.sheet.cancel'])));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledTimes(1);
  });

  it('ClockCorrectSheet’s back steppers are disabled at the floor and it says so', () => {
    const { onStep } = renderSheet(true);
    for (const step of [-60, -10] as const) {
      const back = button(WORDS.steps[step]);
      expect(back.getAttribute('aria-disabled')).toBe('true');
      act(() => fireEvent.click(back));
    }
    expect(onStep).not.toHaveBeenCalled();
    expect(screen.getByText(FLOOR)).toBeTruthy();
    act(() => fireEvent.click(button(WORDS.steps[10])));
    expect(onStep).toHaveBeenCalledExactlyOnceWith(10);
    expect(button(WORDS.set).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('closes on a tap on the dim with nothing set, and is modal to a screen reader', () => {
    const { onSet, onCancel } = renderSheet(false);
    const sheet = screen.getByTestId('clock-correct-sheet');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    const dim = sheet.previousElementSibling;
    if (!(dim instanceof HTMLElement)) throw new Error('no dim');
    act(() => fireEvent.click(dim));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSet).not.toHaveBeenCalled();
  });
});
