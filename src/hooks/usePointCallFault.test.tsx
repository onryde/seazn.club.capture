import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePointCallFault } from '@/hooks/usePointCallFault';
import type { Logger } from '@/services/logger';

const logger = () => {
  const warn = vi.fn<Logger['warn']>();
  const log: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    protect: vi.fn(),
    protectLink: vi.fn(),
    release: vi.fn(),
  };
  return { log, warn };
};

describe('usePointCallFault', () => {
  it('says nothing for no fault, and for a display that has none to give', () => {
    const { log, warn } = logger();
    renderHook(() => usePointCallFault(log, null));
    renderHook(() => usePointCallFault(log, undefined));
    expect(warn).not.toHaveBeenCalled();
  });

  it('records the thrown name once, however often the pad renders, and again for another cause', () => {
    const { log, warn } = logger();
    const { rerender } = renderHook(({ fault }) => usePointCallFault(log, fault), {
      initialProps: { fault: 'TypeError' as string | null },
    });
    rerender({ fault: 'TypeError' });
    rerender({ fault: 'TypeError' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('scoring.pointCall', {
      reason: 'engine',
      cause: 'TypeError',
    });
    rerender({ fault: 'RangeError' });
    expect(warn).toHaveBeenCalledTimes(2);
    rerender({ fault: null });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
