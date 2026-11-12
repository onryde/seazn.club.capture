import { act, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { usePullRefresh } from '@/hooks/usePullRefresh';

// Review M4 of MD-2 Task 4: react-native-web drops RefreshControl's props, so the pull's spinner rule is tested here,
// on the hook the list binds to it. That the spinner draws on a phone is the device check's.

/** The list's read as `useMatchDay` keeps it: `refresh` starts a read (unless `starts` is false), `land` ends it. */
function useHarness(starts: boolean) {
  const [reading, setReading] = useState(false);
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => {
    setAsked((n) => n + 1);
    if (starts) setReading(true);
  }, [starts]);
  const pull = usePullRefresh(refresh, reading);
  return { pull, asked, poll: () => setReading(true), land: () => setReading(false) };
}

const mount = (starts = true) => renderHook(() => useHarness(starts));

describe('usePullRefresh', () => {
  it('a pull asks for a read and spins while it is out, and stops when it lands', () => {
    const view = mount();
    act(() => view.result.current.pull.onRefresh());
    expect(view.result.current.asked).toBe(1);
    expect(view.result.current.pull.refreshing).toBe(true);
    act(() => view.result.current.land());
    expect(view.result.current.pull.refreshing).toBe(false);
  });

  it('a poll’s read shows no spinner: nobody pulled', () => {
    const view = mount();
    act(() => view.result.current.poll());
    expect(view.result.current.pull.refreshing).toBe(false);
  });

  it('a pull while a read is already out spins until that read lands', () => {
    const view = mount(false);
    act(() => view.result.current.poll());
    act(() => view.result.current.pull.onRefresh());
    expect(view.result.current.pull.refreshing).toBe(true);
    act(() => view.result.current.land());
    expect(view.result.current.pull.refreshing).toBe(false);
  });

  it('a pull that starts no read ends at once: the next poll shows no spinner', () => {
    const view = mount(false);
    act(() => view.result.current.pull.onRefresh());
    expect(view.result.current.pull.refreshing).toBe(false);
    act(() => view.result.current.poll());
    expect(view.result.current.pull.refreshing).toBe(false);
  });
});
