import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Gravity, Target } from '@/domain/orientation/orientation';
import type { SessionState } from '@/domain/session/SessionState';
import { LOCK_RETRY_MS, routeTarget, useOrientationGate } from '@/hooks/useOrientationGate';
import { createFakePorts, readRecord } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

const tilted = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad), z: 0 };
};
const UPRIGHT = tilted(0);
const SIDEWAYS = tilted(90);
const FLAT: Gravity = { x: 0.05, y: 0.05, z: 0.99 };

/** Hold one reading for 400 ms, sampled every 100 ms, as the phone would. */
function hold(fakes: ReturnType<typeof createFakePorts>, g: Gravity, fromMs: number) {
  act(() => {
    for (let t = 0; t <= 400; t += 100) fakes.motion.emit(g, fromMs + t);
  });
}

async function gate(target: Target, fakes = createFakePorts()) {
  const hook = renderHook(({ to }) => useOrientationGate(to), {
    initialProps: { to: target },
    wrapper: wrapperFor(fakes),
  });
  await act(async () => undefined); // let isAvailable() resolve and the subscription start
  return { fakes, hook };
}

describe('useOrientationGate', () => {
  afterEach(() => vi.useRealTimers());

  it('locks portrait and asks for sideways when Stream is tilted upright while idle (R24)', async () => {
    const { fakes, hook } = await gate('landscape');
    hold(fakes, SIDEWAYS, 0);
    hold(fakes, UPRIGHT, 1000);
    expect(hook.result.current).toEqual({ lock: 'portrait', card: 'turnSideways' });
    expect(fakes.orientationLock.locks).toEqual(['landscape', 'portrait']);
  });

  it.each<[string, SessionState]>([
    ['armed', { kind: 'armed' }],
    ['live', { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }],
  ])(
    'on air (%s), a tilt upright shows the card without locking, and the turn back does not re-lock',
    async (_status, state) => {
      const fakes = createFakePorts();
      fakes.engine.forceState(state);
      const { hook } = await gate('landscape', fakes);
      hold(fakes, SIDEWAYS, 0);
      hold(fakes, UPRIGHT, 1000); // the operator tilts up mid-broadcast: card, lock kept
      expect(hook.result.current).toEqual({ lock: 'keep', card: 'turnSideways' });
      hold(fakes, SIDEWAYS, 2000);
      expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
      expect(fakes.orientationLock.locks).toEqual(['landscape']);
    },
  );

  it('follows the hands again once the broadcast ends', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const { hook } = await gate('landscape', fakes);
    hold(fakes, SIDEWAYS, 0);
    hold(fakes, UPRIGHT, 1000);
    act(() =>
      fakes.engine.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: null }),
    );
    expect(hook.result.current).toEqual({ lock: 'portrait', card: 'turnSideways' });
    expect(fakes.orientationLock.locks).toEqual(['landscape', 'portrait']);
  });

  it('locks landscape on Home held sideways, and portrait once turned upright (R24)', async () => {
    const { fakes, hook } = await gate('portrait');
    hold(fakes, UPRIGHT, 0);
    hold(fakes, SIDEWAYS, 1000);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'turnUpright' });
    hold(fakes, UPRIGHT, 2000);
    expect(hook.result.current).toEqual({ lock: 'portrait', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['portrait', 'landscape', 'portrait']);
  });

  it('locks to how the phone is held at a cold start held sideways (R24)', async () => {
    const { fakes, hook } = await gate('portrait');
    hold(fakes, SIDEWAYS, 0);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'turnUpright' });
    // Portrait first, before any reading has settled (R34).
    expect(fakes.orientationLock.locks).toEqual(['portrait', 'landscape']);
  });

  it('never blocks a phone lying flat', async () => {
    const { fakes, hook } = await gate('landscape');
    hold(fakes, FLAT, 0);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
  });

  it('treats a phone with no accelerometer as flat', async () => {
    const fakes = createFakePorts();
    fakes.motion.available = false;
    const { hook } = await gate('landscape', fakes);
    await waitFor(() => expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' }));
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  it('asks for upright on the way back to Home', async () => {
    const { fakes, hook } = await gate('landscape');
    hold(fakes, SIDEWAYS, 0);
    hook.rerender({ to: 'portrait' });
    // The landscape lock already matches the hands (R24): card, no new lock.
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'turnUpright' });
    hold(fakes, UPRIGHT, 1000);
    expect(fakes.orientationLock.locks).toEqual(['landscape', 'portrait']);
  });

  it('never starts the accelerometer when unmounted before it answers', async () => {
    const fakes = createFakePorts();
    const subscribe = fakes.motion.subscribe;
    let subscriptions = 0;
    fakes.motion.subscribe = (onSample) => {
      subscriptions += 1;
      return subscribe(onSample);
    };
    const hook = renderHook(() => useOrientationGate('landscape'), { wrapper: wrapperFor(fakes) });
    hook.unmount();
    await act(async () => undefined);
    expect(subscriptions).toBe(0);
  });

  it('treats a failed accelerometer check as no accelerometer (R26)', async () => {
    const fakes = createFakePorts();
    fakes.motion.isAvailable = () => Promise.reject(new Error('sensor service died'));
    const { hook } = await gate('landscape', fakes);
    await waitFor(() => expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' }));
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    expect(readRecord(fakes.record).map((e) => e.event)).toContain('motion.check-failed');
  });

  it('retries a refused lock once, half a second later, and logs it (D26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 1;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    await gate('landscape', fakes); // on air, nothing locked: landscape at once (R37), refused
    expect(fakes.orientationLock.locks).toEqual([]);
    // D26's 500 ms as literals, never the module's own constant.
    expect(LOCK_RETRY_MS).toBe(500);
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(fakes.orientationLock.locks).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    hold(fakes, UPRIGHT, 0); // on air: keep
    hold(fakes, SIDEWAYS, 1000); // the retry was applied, so it is remembered: not re-sent
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    expect(readRecord(fakes.record)).toContainEqual(
      expect.objectContaining({
        event: 'orientation.lock-refused',
        fields: { lock: 'landscape', attempt: 1 },
      }),
    );
  });

  it('forgets a lock refused twice, so the next differing lock is sent again (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 2;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    await gate('landscape', fakes);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fakes.orientationLock.locks).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(500)); // no third attempt
    expect(fakes.orientationLock.locks).toEqual([]);
    hold(fakes, UPRIGHT, 1000); // on air: keep
    hold(fakes, SIDEWAYS, 2000); // the same lock again: sent, not deduped
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
    expect(refused.map((e) => e.fields.attempt)).toEqual([1, 2]);
  });

  it('forgets a refused lock whose retry an on-air keep cancelled, so it is sent again (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 1;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    await gate('landscape', fakes); // refused; the retry waits 500 ms
    hold(fakes, UPRIGHT, 0); // on air: keep, which is no newer lock, cancels the retry
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fakes.orientationLock.locks).toEqual([]);
    hold(fakes, SIDEWAYS, 1000); // landscape wanted again: never applied, so sent
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  it('forgets a lock refused after a newer view cancelled it, so it is sent again (R26)', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    let refuse: (reason: Error) => void = () => undefined;
    const lock = fakes.orientationLock.lock;
    let first = true;
    fakes.orientationLock.lock = (target) => {
      if (!first) return lock(target);
      first = false;
      return new Promise((_, reject) => {
        refuse = reject;
      });
    };
    await gate('landscape', fakes); // landscape asked for; the platform has not answered
    hold(fakes, UPRIGHT, 0); // on air: keep cancels the pending attempt
    await act(async () => refuse(new Error('refused'))); // then the refusal lands
    hold(fakes, SIDEWAYS, 1000);
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    expect(readRecord(fakes.record).map((e) => e.event)).toContain('orientation.lock-refused');
  });

  it('keeps a newer applied lock when an older, superseded lock is refused late (R26)', async () => {
    const fakes = createFakePorts();
    let refuse: (reason: Error) => void = () => undefined;
    const lock = fakes.orientationLock.lock;
    let first = true;
    fakes.orientationLock.lock = (target) => {
      if (!first) return lock(target);
      first = false;
      return new Promise((_, reject) => {
        refuse = reject;
      });
    };
    await gate('landscape', fakes); // landscape asked for; the platform has not answered
    hold(fakes, UPRIGHT, 0); // off air: lock to the hands, portrait applied
    expect(fakes.orientationLock.locks).toEqual(['portrait']);
    await act(async () => refuse(new Error('refused'))); // the old landscape refusal lands
    act(() => fakes.engine.forceState({ kind: 'armed' })); // keep
    act(() => fakes.engine.forceState({ kind: 'idle' })); // portrait again: still applied
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['portrait']);
  });

  it('stops the accelerometer on unmount', async () => {
    const fakes = createFakePorts();
    const subscribe = fakes.motion.subscribe;
    let stopped = 0;
    fakes.motion.subscribe = (onSample) => {
      const off = subscribe(onSample);
      return () => {
        stopped += 1;
        off();
      };
    };
    const { hook } = await gate('landscape', fakes);
    hook.unmount();
    expect(stopped).toBe(1);
  });

  it('does not re-render on a telemetry tick (AGENTS §8)', async () => {
    const fakes = createFakePorts();
    const live: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 };
    fakes.engine.forceState(live);
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useOrientationGate('landscape');
      },
      { wrapper: wrapperFor(fakes) },
    );
    await act(async () => undefined);
    const settled = renders;
    act(() => {
      for (let tick = 0; tick < 3; tick += 1) fakes.engine.forceState(live);
    });
    expect(renders).toBe(settled);
  });

  it('locks the route target with no card before the first settled reading (R34)', async () => {
    const { fakes, hook } = await gate('landscape');
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  it.each<[Target]>([['portrait'], ['landscape']])(
    'locks %s when the phone never leaves a dead band (R34)',
    async (target) => {
      const { fakes, hook } = await gate(target);
      // The Redmi face down, tilted about 20°: between flat and held, for good.
      const DEAD_BAND: Gravity = { x: -3.39 / 9.81, y: -0.53 / 9.81, z: -9.39 / 9.81 };
      hold(fakes, DEAD_BAND, 0);
      hold(fakes, DEAD_BAND, 1000);
      expect(hook.result.current).toEqual({ lock: target, card: 'none' });
      expect(fakes.orientationLock.locks).toEqual([target]);
    },
  );

  it('locks the target on air when nothing is locked yet, then keeps it (R37)', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'armed' });
    const { hook } = await gate('landscape', fakes);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  it('shows the upright card on Home while an armed engine keeps the landscape lock (R35)', async () => {
    const { fakes, hook } = await gate('landscape');
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    act(() => fakes.engine.forceState({ kind: 'armed' }));
    hook.rerender({ to: 'portrait' });
    expect(hook.result.current).toEqual({ lock: 'keep', card: 'turnUpright' });
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });
});

describe('routeTarget', () => {
  it.each([
    ['/', 'portrait'],
    ['/stream', 'landscape'],
    ['/stream/settings', 'landscape'],
    ['/streaming-help', 'portrait'],
  ])('%s wants %s', (pathname, target) => {
    expect(routeTarget(pathname)).toBe(target);
  });
});
