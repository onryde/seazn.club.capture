import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAKEN, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import { useTaps } from '@/hooks/usePadTaps';
import { useStartActions } from '@/hooks/usePadMatchParts';
import { createFakePorts, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The Start screen's two buttons (plan S2-3 Task 2): a sport with a serve pick starts with the side picked, once one is;
// a sport with none starts at once, with no side. Over the real bounce memory (`useTaps`), since "pressed twice counts
// once" is its rule and not this hook's.

const noop = () => undefined;

/** The Start button's hook, over the real bounce memory, for a sport whose Start match carries the picked side. */
function mountWithPick(toss: PadSide | null, startWith: (server: PadSide) => PadOutcome) {
  return renderHook(
    () => {
      const taps = useTaps({ rally: () => TAKEN, undo: () => TAKEN }, noop, noop, noop);
      return useStartActions(null, toss, startWith, taps.opening);
    },
    { wrapper: wrapperFor(createFakePorts({ clock: timerClock })) },
  );
}

/** The same, for a sport with no serve pick: `needsToss` false, so the start tap carries no side. */
function mountWithoutPick(toss: PadSide | null, startWith: () => PadOutcome) {
  return renderHook(
    () => {
      const taps = useTaps({ rally: () => TAKEN, undo: () => TAKEN }, noop, noop, noop);
      return useStartActions(null, toss, startWith, taps.opening, false);
    },
    { wrapper: wrapperFor(createFakePorts({ clock: timerClock })) },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useStartActions: a sport with a serve pick', () => {
  it('waits for a side: Start match with none picked starts nothing', () => {
    const startWith = vi.fn(() => TAKEN);
    const { result } = mountWithPick(null, startWith);
    act(() => result.current.start());
    expect(startWith).not.toHaveBeenCalled();
  });

  it('starts once with the side picked, however it is pressed twice', () => {
    const startWith = vi.fn<(server: PadSide) => PadOutcome>(() => TAKEN);
    const { result } = mountWithPick('second', startWith);
    act(() => result.current.start());
    act(() => result.current.start());
    expect(startWith.mock.calls).toEqual([['second']]);
  });
});

describe('useStartActions: a sport with no serve pick', () => {
  it('starts at once with no side, though nothing is picked', () => {
    const startWith = vi.fn(() => TAKEN);
    const { result } = mountWithoutPick(null, startWith);
    act(() => result.current.start());
    expect(startWith.mock.calls).toEqual([[]]);
  });

  it('counts a double press once, and a press after the window as a new start', () => {
    const startWith = vi.fn(() => TAKEN);
    const { result } = mountWithoutPick(null, startWith);
    act(() => result.current.start());
    act(() => result.current.start());
    expect(startWith).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(1_000));
    act(() => result.current.start());
    expect(startWith).toHaveBeenCalledTimes(2);
  });

  it('tries again on a second press when the match refused the first', () => {
    const refused: PadOutcome = { ok: false, refusal: 'notNow' };
    const startWith = vi.fn(() => refused);
    const { result } = mountWithoutPick(null, startWith);
    act(() => result.current.start());
    act(() => result.current.start());
    // A refused start arms no bounce window: the scorer's second press, at once, is a second try.
    expect(startWith).toHaveBeenCalledTimes(2);
  });
});
