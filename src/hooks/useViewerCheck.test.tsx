import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewerCheck } from '@/hooks/useViewerCheck';
import { TurnCardProvider } from '@/hooks/useTurnCard';
import {
  createFakePorts,
  readRecord,
  TEST_NOW,
  timerClock,
  type FakePorts,
} from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

type Input = Parameters<typeof useViewerCheck>[0];
const OPEN: Input = { available: true, shed: false, scoringOpen: false, hideScoring: () => {} };

/** The phone's clock moves with the timers (ledger P7): every wait below is the spec's, not the frozen clock's. */
const ticking = () => createFakePorts({ clock: timerClock });

function mount(input: Input = OPEN, fakes: FakePorts = ticking(), strict = false) {
  const view = renderHook((props: Input) => useViewerCheck(props), {
    initialProps: input,
    wrapper: wrapperFor(fakes),
    reactStrictMode: strict,
  });
  return { ...view, fakes };
}

const viewerLines = (fakes: FakePorts) =>
  readRecord(fakes.record)
    .filter((entry) => entry.event.startsWith('viewer.'))
    .map((entry) => [entry.event, entry.fields]);

describe('useViewerCheck (D2 §4.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('opens on a tap, shows 20 s from the first frame, then closes by itself', () => {
    const { result } = mount();
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('loading');
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.firstFrame());
    expect(result.current.kind).toBe('showing');
    act(() => vi.advanceTimersByTime(19_999));
    expect(result.current.kind).toBe('showing');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.kind).toBe('idle');
  });

  it('with no frame in 5 s, says so for 3 s and closes', () => {
    const { result } = mount();
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(4_999));
    expect(result.current.kind).toBe('loading');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.kind).toBe('notReady');
    act(() => vi.advanceTimersByTime(2_999));
    expect(result.current.kind).toBe('notReady');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.kind).toBe('idle');
  });

  it('a second tap closes it, and a third begins a new view; no tap ever lengthens one', () => {
    const { result } = mount();
    act(() => result.current.toggle());
    act(() => result.current.firstFrame());
    act(() => vi.advanceTimersByTime(10_000));
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('idle');
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('loading');
    // The new view is a new 5 s, counted from the third tap.
    act(() => vi.advanceTimersByTime(4_999));
    expect(result.current.kind).toBe('loading');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.kind).toBe('notReady');
  });

  it.each<[string, Partial<Input>]>([
    ['the ladder sheds', { shed: true }],
    ['it leaves live, or the playback URL goes', { available: false }],
    ['the Remote scoring panel opens', { scoringOpen: true }],
  ])('closes when %s, and a tap then opens nothing while it stands', (_name, change) => {
    const { result, rerender } = mount();
    act(() => result.current.toggle());
    rerender({ ...OPEN, ...change });
    expect(result.current.kind).toBe('idle');
    if (change.scoringOpen === true) return; // a tap with the panel up is the next test's
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('idle');
  });

  it('a tap with the scoring panel up takes the panel down and opens: one cover at a time', () => {
    const hideScoring = vi.fn();
    const { result } = mount({ ...OPEN, scoringOpen: true, hideScoring });
    act(() => result.current.toggle());
    expect(hideScoring).toHaveBeenCalledTimes(1);
    expect(result.current.kind).toBe('loading');
  });

  it('a tap that closes the view leaves the scoring panel alone', () => {
    const hideScoring = vi.fn();
    const { result } = mount({ ...OPEN, hideScoring });
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('idle');
    expect(hideScoring).toHaveBeenCalledTimes(1);
  });

  // Ruling N4: the turn card covers the stage and the controls, so nothing under it plays on.
  it('closes while the turn card covers the stage, opens nothing under it, and opens again once it lifts', () => {
    const fakes = ticking();
    const card = { showing: false };
    const Ports = wrapperFor(fakes);
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <Ports>
          <TurnCardProvider showing={card.showing}>{children}</TurnCardProvider>
        </Ports>
      );
    }
    const { result, rerender } = renderHook((props: Input) => useViewerCheck(props), {
      initialProps: OPEN,
      wrapper: Wrapper,
    });
    act(() => result.current.toggle());
    card.showing = true;
    rerender(OPEN);
    expect(result.current.kind).toBe('idle');
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('idle');
    card.showing = false;
    rerender(OPEN);
    expect(result.current.kind).toBe('idle');
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('loading');
  });

  it('closes when the app leaves the foreground, and stays closed on return', () => {
    const { result, fakes } = mount();
    act(() => result.current.toggle());
    act(() => fakes.foreground.leave());
    expect(result.current.kind).toBe('idle');
    act(() => fakes.foreground.fire());
    expect(result.current.kind).toBe('idle');
  });

  it('stops listening for the app leaving once unmounted', () => {
    const { fakes, unmount } = mount();
    const before = fakes.foreground.leaveListeners();
    expect(before).toBeGreaterThanOrEqual(1);
    unmount();
    expect(fakes.foreground.leaveListeners()).toBe(before - 1);
  });

  it('leaves no timer behind after an unmount mid-view', () => {
    const { result, unmount } = mount();
    // Ledger P8: the fake engine's report interval is not the view's, so the count is against a baseline.
    const before = vi.getTimerCount();
    act(() => result.current.toggle());
    expect(vi.getTimerCount()).toBe(before + 1);
    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });

  it('holds one timer at a time, through every phase, and none once closed', () => {
    const { result } = mount();
    const before = vi.getTimerCount();
    act(() => result.current.toggle());
    expect(vi.getTimerCount()).toBe(before + 1);
    act(() => result.current.firstFrame());
    expect(vi.getTimerCount()).toBe(before + 1);
    act(() => result.current.toggle());
    expect(vi.getTimerCount()).toBe(before);
  });

  it('writes each state, and the time from tap to first frame, to the record (spec §8, the HLS risk)', () => {
    const { result, fakes } = mount();
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.firstFrame());
    expect(viewerLines(fakes)).toEqual([
      ['viewer.check', { state: 'loading' }],
      ['viewer.firstFrame', { ms: 3_000 }],
      ['viewer.check', { state: 'showing' }],
    ]);
  });

  it('writes no first-frame time for a picture after the first, or for a view that never had one', () => {
    const { result, fakes } = mount();
    act(() => result.current.toggle());
    act(() => result.current.firstFrame());
    act(() => result.current.firstFrame());
    act(() => vi.advanceTimersByTime(20_000));
    act(() => result.current.toggle());
    // One act per phase: React renders an act's updates as it exits, so the next phase's timer is set then.
    act(() => vi.advanceTimersByTime(5_000));
    act(() => vi.advanceTimersByTime(3_000));
    expect(viewerLines(fakes)).toEqual([
      ['viewer.check', { state: 'loading' }],
      ['viewer.firstFrame', { ms: 0 }],
      ['viewer.check', { state: 'showing' }],
      ['viewer.check', { state: 'idle' }],
      ['viewer.check', { state: 'loading' }],
      ['viewer.check', { state: 'notReady' }],
      ['viewer.check', { state: 'idle' }],
    ]);
  });

  it('runs the same with every effect run twice (StrictMode): 5 s, 3 s, one line per state', () => {
    const { result, fakes } = mount(OPEN, ticking(), true);
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.kind).toBe('notReady');
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.kind).toBe('idle');
    expect(viewerLines(fakes)).toEqual([
      ['viewer.check', { state: 'loading' }],
      ['viewer.check', { state: 'notReady' }],
      ['viewer.check', { state: 'idle' }],
    ]);
  });
});
