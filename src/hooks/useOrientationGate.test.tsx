import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Gravity, Target } from '@/domain/orientation/orientation';
import type { SessionState } from '@/domain/session/SessionState';
import { routeTarget, useOrientationGate } from '@/hooks/useOrientationGate';
import { createFakePorts } from '../../test/fakePorts';
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
    act(() => fakes.engine.forceState({ kind: 'ended', reason: 'operator-stopped' }));
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
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
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

  it('shows nothing before the first settled reading', async () => {
    const { hook } = await gate('landscape');
    expect(hook.result.current).toEqual({ lock: 'keep', card: 'none' });
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
