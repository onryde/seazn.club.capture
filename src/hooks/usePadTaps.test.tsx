import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAKEN, refusing, type PadLineWords, type PadOutcome } from '@/domain/scoring/padLine';
import { useSettle, useTaps } from '@/hooks/usePadTaps';
import { createFakePorts, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The bounce memory's arm-only path (`useTaps`' `arm`, review round 3): a sheet's close stamps the 250 ms window of an
// opening tap without making a tap, so the second touch of a double tap is refused, and without saying anything, so a
// line the scorer has not read yet is not wiped by the close. Over the real memory and the real `useSettle`.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function mount(undo: () => PadOutcome = () => TAKEN) {
  const said: (PadLineWords | 'cleared')[] = [];
  const say = (words: PadLineWords) => said.push(words ?? 'cleared');
  const view = renderHook(
    () => {
      const settle = useSettle(say);
      return useTaps({ rally: () => TAKEN, undo }, settle, say, () => undefined);
    },
    { wrapper: wrapperFor(createFakePorts({ clock: timerClock })) },
  );
  return { ...view, said };
}

describe('arm: the window of a close, with no tap and no line', () => {
  it('says nothing and makes no tap', () => {
    const undo = vi.fn(() => TAKEN);
    const view = mount(undo);
    act(() => view.result.current.arm('close'));
    expect(view.said).toEqual([]);
    expect(undo).not.toHaveBeenCalled();
  });

  it('leaves a refusal on the line standing: an opening tap would have cleared it', () => {
    const view = mount(() => refusing('nothingToUndo'));
    act(() => view.result.current.undo());
    const refusal = view.said.at(-1);
    expect(refusal).toMatchObject({ kind: 'refusal' });
    tick(1_000);
    act(() => view.result.current.arm('close'));
    expect(view.said.at(-1)).toBe(refusal);
    expect(view.said).toHaveLength(1);
  });

  it('refuses every tap inside its window, with the line the other bounces give, and takes one after it', () => {
    const view = mount();
    act(() => view.result.current.arm('close'));
    let made = 0;
    const make = (): PadOutcome => {
      made += 1;
      return TAKEN;
    };
    act(() => void view.result.current.opening('swap', make));
    expect(made).toBe(0);
    expect(view.said.at(-1)).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    expect(view.result.current.secondTouch()).toBe(true);
    tick(300);
    act(() => void view.result.current.opening('swap', make));
    expect(made).toBe(1);
  });

  it('opens a window that a tool’s second touch sees, and none for a tap that was never armed', () => {
    const view = mount();
    expect(view.result.current.secondTouch()).toBe(false);
    act(() => view.result.current.arm('close'));
    expect(view.result.current.secondTouch()).toBe(true);
  });
});
