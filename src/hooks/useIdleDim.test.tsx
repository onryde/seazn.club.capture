import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleDim } from '@/hooks/useIdleDim';
import { createFakePorts } from '../../test/fakePorts';
import { pairCode } from '../../test/pairCode';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

function mount(paired = true, strict = false) {
  const fakes = createFakePorts();
  if (paired) pairCode(fakes.engine, savedStreamCode());
  const view = renderHook(() => useIdleDim(), {
    wrapper: wrapperFor(fakes),
    reactStrictMode: strict,
  });
  return { ...view, fakes };
}

/** Spec §4.5 (R8): 30 s with no touch while paired and waiting dims the window; the rest restore it at once. */
describe('useIdleDim (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dims after 30 s paired with no touch, and a touch restores it and starts the 30 s again', () => {
    const { result, fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
    act(() => result.current());
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
    expect(fakes.screen.calls).toEqual(['dim', 'restore', 'dim']);
  });

  it('a touch before the 30 s are up starts them again: 20 s, a touch, then 29.999 s is still bright', () => {
    const { result, fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(20_000));
    act(() => result.current());
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

  it('a second touch on a bright screen restores nothing: touches only restart the 30 s', () => {
    const { result, fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => result.current());
    act(() => result.current());
    expect(fakes.screen.calls).toEqual([]);
  });

  it.each([
    ['armed', 'armed-not-ready'],
    ['live', 'live'],
    ['ended', 'fatal'],
  ] as const)(
    'restores at once when the engine goes %s, and never dims there (Review Focus 2)',
    (_kind, scene) => {
      const { fakes } = mount();
      act(() => fakes.engine.scene('paired-ready'));
      act(() => vi.advanceTimersByTime(30_000));
      expect(fakes.screen.dimmed).toBe(true);
      act(() => fakes.engine.scene(scene));
      expect(fakes.screen.dimmed).toBe(false);
      act(() => vi.advanceTimersByTime(600_000));
      expect(fakes.screen.dimmed).toBe(false);
    },
  );

  it('restores on unpair', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    act(() => fakes.engine.forceState({ kind: 'idle' }));
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('restores when the app leaves the foreground, and counts 30 s afresh on return', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    act(() => fakes.foreground.leave());
    expect(fakes.screen.dimmed).toBe(false);
    act(() => fakes.foreground.fire());
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

  it('never dims while in the background: leaving before the 30 s are up stops the count', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => fakes.foreground.leave());
    act(() => vi.advanceTimersByTime(600_000));
    expect(fakes.screen.calls).toEqual([]);
  });

  it('restores when it unmounts: leaving Live Stream', () => {
    const { fakes, unmount } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    unmount();
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('leaves no timer behind when it unmounts mid-count', () => {
    const { fakes, unmount } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(10_000));
    const counting = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBe(counting - 1);
  });

  it('never dims an idle engine (no pairing), however long', () => {
    const { fakes } = mount(false);
    act(() => vi.advanceTimersByTime(600_000));
    expect(fakes.screen.calls).toEqual([]);
  });

  it('ends dimmed once under StrictMode’s double effects, and restores once on a touch', () => {
    const { result, fakes } = mount(true, true);
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(fakes.screen.dimmed).toBe(true);
    act(() => result.current());
    expect(fakes.screen.dimmed).toBe(false);
    expect(fakes.screen.calls).toEqual(['dim', 'restore']);
  });
});
