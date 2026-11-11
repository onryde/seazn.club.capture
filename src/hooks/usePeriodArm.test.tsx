import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePeriodArm } from '@/hooks/usePeriodArm';

// The controller's ruling, final review (2026-11-08): End of period re-arms 2 s after its label changes, so a second tap
// can never move a match from Half-time straight on to Full time. The labels are the pad's keys; undefined is a pad
// still loading, null a pad that offers no End of period.
const HT = 'scoring.football.end.HT';
const FT = 'scoring.football.end.FT';

type Label = string | null | undefined;

function drawn(first: Label) {
  return renderHook(({ label }: { label: Label }) => usePeriodArm(label), {
    initialProps: { label: first },
  });
}

const pass = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePeriodArm', () => {
  it('is armed at its first drawing, label or none: a pad opened mid-match takes End of period at once', () => {
    expect(drawn(HT).result.current).toBe(true);
    expect(drawn(null).result.current).toBe(true);
  });

  it('a pad that loads (none, then a label) is armed at once: loading is no change', () => {
    const view = drawn(undefined);
    view.rerender({ label: HT });
    expect(view.result.current).toBe(true);
  });

  it('Half-time to Full time: off at once and at 1.9 s, armed at 2.0 s', () => {
    const view = drawn(HT);
    view.rerender({ label: FT });
    expect(view.result.current).toBe(false);
    pass(1_900);
    expect(view.result.current).toBe(false);
    pass(100);
    expect(view.result.current).toBe(true);
  });

  it('the label appearing at kick-off (none, then End of first half) is a change too', () => {
    const view = drawn(null);
    view.rerender({ label: HT });
    expect(view.result.current).toBe(false);
    pass(2_000);
    expect(view.result.current).toBe(true);
  });

  it('a second change while off counts its 2 s from itself', () => {
    const view = drawn(HT);
    view.rerender({ label: FT });
    pass(1_000);
    view.rerender({ label: HT });
    pass(1_900);
    expect(view.result.current).toBe(false);
    pass(100);
    expect(view.result.current).toBe(true);
  });

  it('a pad that goes while off and is drawn again is armed at once, a fresh drawing', () => {
    const view = drawn(HT);
    view.rerender({ label: FT });
    pass(500);
    view.rerender({ label: undefined });
    view.rerender({ label: FT });
    expect(view.result.current).toBe(true);
  });

  it('the same label drawn again changes nothing', () => {
    const view = drawn(HT);
    view.rerender({ label: HT });
    expect(view.result.current).toBe(true);
  });

  it('leaves no timer behind once the pad has gone', () => {
    const view = drawn(HT);
    view.rerender({ label: FT });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
