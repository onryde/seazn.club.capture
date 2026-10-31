import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenAwake } from '@/hooks/useScreenAwake';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

const keepAwake = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async (_tag?: string) => undefined),
  deactivateKeepAwake: vi.fn(async (_tag?: string) => undefined),
}));
vi.mock('expo-keep-awake', () => keepAwake);

/** The tag the pad holds the screen with: written out, not read from the hook, and not Live Stream's. */
const TAG = 'seazn-capture-pad';

/** Lets the hook's import() settle (useKeepAwake.test.tsx says why each step settles before the next). */
const settle = () => act(async () => {});

/** Owner rulings, 2026-10-31: the screen stays on while the pad shows, and its brightness is untouched. */
describe('useScreenAwake', () => {
  beforeEach(() => {
    keepAwake.activateKeepAwakeAsync.mockClear();
    keepAwake.deactivateKeepAwake.mockClear();
  });

  it('holds the screen on while mounted and lets it go on unmount', async () => {
    const fakes = createFakePorts();
    const view = renderHook(() => useScreenAwake(), { wrapper: wrapperFor(fakes) });
    await settle();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledExactlyOnceWith(TAG);
    expect(keepAwake.deactivateKeepAwake).not.toHaveBeenCalled();
    view.unmount();
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledExactlyOnceWith(TAG);
  });

  it('holds it once across re-renders, and never touches the brightness', async () => {
    const fakes = createFakePorts();
    const view = renderHook(() => useScreenAwake(), { wrapper: wrapperFor(fakes) });
    await settle();
    view.rerender();
    await settle();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(fakes.screen.calls).toEqual([]);
  });

  it('is quiet when the native module is missing: the screen may dim, the pad still works', async () => {
    keepAwake.activateKeepAwakeAsync.mockRejectedValueOnce(new Error('no native module'));
    const fakes = createFakePorts();
    const view = renderHook(() => useScreenAwake(), { wrapper: wrapperFor(fakes) });
    await settle();
    view.unmount();
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });
});
