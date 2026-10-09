import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectCharging, selectKeepOpen, selectShedding, topAdvisory } from '@/hooks/advisory';
import { selectStatusKey } from '@/hooks/statusKey';
import { useIdleDim } from '@/hooks/useIdleDim';
import { createFakePorts, type FakePorts } from '../../test/fakePorts';
import { pairCode } from '../../test/pairCode';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

/** `before` runs after the pairing and before the hook mounts: the phone's state when Live Stream mounts. */
function mount(
  paired = true,
  strict = false,
  before: (fakes: FakePorts) => void = () => undefined,
) {
  const fakes = createFakePorts();
  if (paired) pairCode(fakes.engine, savedStreamCode());
  before(fakes);
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

  // The 30 s are idle time inside paired-and-waiting: entering it counts as a touch, so a new line gets its full 30 s.
  it('an hour live, then the organiser stops: bright on arrival in paired, and dims only 30 s later', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(5_000));
    act(() => fakes.engine.scene('live'));
    act(() => vi.advanceTimersByTime(3_600_000));
    act(() => fakes.engine.scene('paired-after-organiser-stop'));
    expect(fakes.screen.dimmed).toBe(false);
    expect(fakes.screen.calls).toEqual([]);
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

  it('paired, armed, then paired again after more than 30 s untouched: no dim on arrival', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => fakes.engine.scene('armed-not-ready'));
    act(() => vi.advanceTimersByTime(40_000));
    act(() => fakes.engine.scene('paired-ready'));
    expect(fakes.screen.dimmed).toBe(false);
    expect(fakes.screen.calls).toEqual([]);
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

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

/**
 * B5 fix round 2 (ledger): a change into a new URGENT status line (`LINE_TIER`) counts as a touch. A routine line or an
 * advisory caption never wakes the screen, or a waiting phone would never dim. Each row first pins the line it is about.
 */
describe('useIdleDim and the status line (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a refusal while paired and dimmed wakes it at once, and it dims again 30 s later', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(fakes.screen.dimmed).toBe(true);
    // Native answers a held Go live in Paired: the state stays paired, only the line changes (Pairings.started).
    act(() => fakes.engine.scene('paired-refused'));
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
    expect(selectStatusKey(fakes.engine.getSnapshot())).toBe('stream.status.refusedCredit');
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

  it('a routine line while dimmed (Waiting for Go live, once the destination is set) leaves it dim', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => fakes.engine.setPairing({ destinationName: null }));
    expect(selectStatusKey(fakes.engine.getSnapshot())).toBe('stream.status.waitingDestination');
    act(() => vi.advanceTimersByTime(30_000));
    expect(fakes.screen.dimmed).toBe(true);
    act(() => fakes.engine.setPairing({ destinationName: 'YouTube · Made-up Club' }));
    expect(selectStatusKey(fakes.engine.getSnapshot())).toBe('stream.status.waitingGoLive');
    expect(fakes.screen.dimmed).toBe(true);
    expect(fakes.screen.calls).toEqual(['dim']);
  });

  it('an advisory caption while dimmed (Not charging) leaves it dim', () => {
    const { fakes } = mount();
    act(() => {
      fakes.engine.scene('paired-ready');
      fakes.engine.setSurvivesBackground(true);
      fakes.engine.patch({ charging: true });
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(fakes.screen.dimmed).toBe(true);
    act(() => fakes.engine.patch({ charging: false }));
    const snapshot = fakes.engine.getSnapshot();
    const caption = topAdvisory({
      shed: selectShedding(snapshot),
      charging: selectCharging(snapshot),
      keepOpen: selectKeepOpen(snapshot),
    });
    expect(caption).toBe('notCharging');
    expect(fakes.screen.dimmed).toBe(true);
    expect(fakes.screen.calls).toEqual(['dim']);
  });
});

/**
 * B5 review I1: in the background nothing starts the count, so nothing dims there: not entering paired, not an urgent
 * line, not a remote stop (D3 row 2b, the locked phone). The phone comes back bright, and the 30 s count from the return.
 */
describe('useIdleDim in the background (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('entering paired while in the background never dims, and it is bright on return', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => fakes.foreground.leave());
    act(() => fakes.engine.scene('armed-not-ready'));
    act(() => vi.advanceTimersByTime(40_000));
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(31_000));
    expect(fakes.screen.calls).toEqual([]);
    act(() => fakes.foreground.fire());
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('an urgent line while in the background never dims, and it is bright on return', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(5_000));
    act(() => fakes.foreground.leave());
    act(() => fakes.engine.scene('paired-refused'));
    expect(selectStatusKey(fakes.engine.getSnapshot())).toBe('stream.status.refusedCredit');
    act(() => vi.advanceTimersByTime(31_000));
    expect(fakes.screen.calls).toEqual([]);
    act(() => fakes.foreground.fire());
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('a remote stop while in the background (the locked phone) never dims, and it is bright on return', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(5_000));
    act(() => fakes.engine.scene('live'));
    act(() => fakes.foreground.leave());
    act(() => vi.advanceTimersByTime(600_000));
    act(() => fakes.engine.scene('paired-after-organiser-stop'));
    expect(selectStatusKey(fakes.engine.getSnapshot())).toBe('stream.status.stoppedOrganiser');
    act(() => vi.advanceTimersByTime(31_000));
    expect(fakes.screen.calls).toEqual([]);
    act(() => fakes.foreground.fire());
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('after a remote stop in the background, the 30 s count from the return', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('live'));
    act(() => fakes.foreground.leave());
    act(() => vi.advanceTimersByTime(600_000));
    act(() => fakes.engine.scene('paired-after-organiser-stop'));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => fakes.foreground.fire());
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });
});

/**
 * B5 fix round 4: Live Stream can MOUNT in the background. A paired phone sits on Home with the screen locked, and a
 * remote Go live routes it to Live Stream (`useEngineFollow`). The clock starts paused there, so nothing dims until the
 * return, and the 30 s count from the return.
 */
describe('useIdleDim mounted in the background (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Paired and waiting on Home, the phone locked, then a remote Go live: Live Stream mounts while live. */
  function mountLiveInBackground(strict = false) {
    return mount(true, strict, (fakes) => {
      fakes.engine.scene('paired-ready');
      fakes.foreground.leave();
      fakes.engine.scene('live');
      expect(fakes.foreground.isForeground()).toBe(false);
    });
  }

  it('a remote stop after a remote Go live on a locked phone never dims it, and it is bright on return', () => {
    const { fakes } = mountLiveInBackground();
    act(() => vi.advanceTimersByTime(600_000));
    act(() => fakes.engine.scene('paired-after-organiser-stop'));
    expect(selectStatusKey(fakes.engine.getSnapshot())).toBe('stream.status.stoppedOrganiser');
    act(() => vi.advanceTimersByTime(31_000));
    expect(fakes.screen.calls).toEqual([]);
    act(() => fakes.foreground.fire());
    expect(fakes.screen.dimmed).toBe(false);
    expect(fakes.screen.calls).toEqual([]);
  });

  it.each([false, true])(
    'mounted in the background, it dims 30 s after the return to the foreground (StrictMode: %s)',
    (strict) => {
      const { fakes } = mountLiveInBackground(strict);
      act(() => fakes.engine.scene('paired-after-organiser-stop'));
      act(() => vi.advanceTimersByTime(600_000));
      expect(fakes.screen.calls).toEqual([]);
      act(() => fakes.foreground.fire());
      act(() => vi.advanceTimersByTime(29_999));
      expect(fakes.screen.dimmed).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(fakes.screen.dimmed).toBe(true);
      expect(fakes.screen.calls).toEqual(['dim']);
    },
  );

  it('mounted in the foreground, it counts from mount as before: paired and waiting dims 30 s later', () => {
    const { fakes } = mount(true, false, (fakes) => {
      fakes.engine.scene('paired-ready');
      expect(fakes.foreground.isForeground()).toBe(true);
    });
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
    expect(fakes.screen.calls).toEqual(['dim']);
  });
});
