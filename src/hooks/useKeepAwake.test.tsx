import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { createFakePorts } from '../../test/fakePorts';
import { pairCode } from '../../test/pairCode';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

const keepAwake = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async (_tag?: string) => undefined),
  deactivateKeepAwake: vi.fn(async (_tag?: string) => undefined),
}));
vi.mock('expo-keep-awake', () => keepAwake);

/** The tag `useKeepAwake` holds the screen with: written out, not read from the hook. */
const TAG = 'seazn-capture-session';

/**
 * Lets the hook's import() settle. Each step below settles before the next change of state: vitest 5 hands a second
 * import() of a mocked module, made while the first is in flight, the REAL module (so a session that ends before the
 * module loads cannot be tested here).
 */
const settle = () => act(async () => {});

function mount(paired: boolean) {
  const fakes = createFakePorts();
  if (paired) pairCode(fakes.engine, savedStreamCode());
  renderHook(() => useKeepAwake(), { wrapper: wrapperFor(fakes) });
  return fakes;
}

/** Spec §4.5: keep-awake is unchanged: on for every state but idle and ended. It never had a test. */
describe('useKeepAwake', () => {
  beforeEach(() => {
    keepAwake.activateKeepAwakeAsync.mockClear();
    keepAwake.deactivateKeepAwake.mockClear();
  });

  it('is off while idle', async () => {
    mount(false);
    await settle();
    expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['paired', 'paired-ready'],
    ['armed', 'armed-not-ready'],
    ['live', 'live'],
  ] as const)('is on while %s', async (_kind, scene) => {
    const fakes = mount(true);
    act(() => fakes.engine.scene(scene));
    await settle();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(TAG);
    expect(keepAwake.deactivateKeepAwake).not.toHaveBeenCalled();
  });

  it('turns off when the session ends, and stays off', async () => {
    const fakes = mount(true);
    act(() => fakes.engine.scene('live'));
    await settle();
    act(() => fakes.engine.scene('fatal'));
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledExactlyOnceWith(TAG);
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
  });

  it('turns off on unpair', async () => {
    const fakes = mount(true);
    act(() => fakes.engine.scene('paired-ready'));
    await settle();
    act(() => fakes.engine.forceState({ kind: 'idle' }));
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledExactlyOnceWith(TAG);
  });
});
