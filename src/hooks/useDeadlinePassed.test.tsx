import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeadlinePassed } from '@/hooks/useDeadlinePassed';
import { createFakePorts, TEST_NOW } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

const MINUTE = 60_000;
const at = (offsetMs: number) => TEST_NOW.getTime() + offsetMs;

function deadlineHook(deadlineMs: number | null) {
  const fakes = createFakePorts();
  const hook = renderHook((deadline: number | null) => useDeadlinePassed(deadline), {
    initialProps: deadlineMs,
    wrapper: wrapperFor(fakes),
  });
  return { ...fakes, hook };
}

/** M8: the return to the foreground re-reads the clock, and never leaks its listener. */
describe('useDeadlinePassed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes on a return after the deadline, with no timer fired', () => {
    const { hook, foreground, setNow } = deadlineHook(at(10 * MINUTE));
    expect(hook.result.current).toBe(false);
    setNow(new Date(at(10 * MINUTE)));
    act(() => foreground.fire());
    expect(hook.result.current).toBe(true);
  });

  it.each([
    ['open', at(10 * MINUTE)],
    ['passed', at(-MINUTE)],
    ['unknown', null],
  ] as const)('lets go of the return when unmounted with the gate %s', (_, deadline) => {
    const { hook, foreground } = deadlineHook(deadline);
    expect(foreground.returnListeners()).toBe(1);
    hook.unmount();
    expect(foreground.returnListeners()).toBe(0);
  });

  it('listens once for a new deadline, not once per deadline', () => {
    const { hook, foreground } = deadlineHook(at(10 * MINUTE));
    hook.rerender(at(20 * MINUTE));
    hook.rerender(at(-MINUTE));
    expect(foreground.returnListeners()).toBe(1);
  });
});
