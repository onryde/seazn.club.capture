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
    // CD37: the camera is open from Pairing on, so the lock holds as it did from Armed.
    ['pairing', { kind: 'pairing' }],
    ['paired', { kind: 'paired' }],
    ['armed', { kind: 'armed', cause: 'operator', notReady: 'sound' }],
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
    // D26's half second is pinned once, here, as a literal; every other wait below is written in the constant.
    expect(LOCK_RETRY_MS).toBe(500);
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS - 1));
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

  it('forgets a lock refused twice, so the next evaluation sends it again, even under a held tilt (R26, R37)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 2;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    const { hook } = await gate('landscape', fakes);
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS));
    expect(fakes.orientationLock.locks).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS)); // no third attempt
    expect(fakes.orientationLock.locks).toEqual([]);
    hold(fakes, UPRIGHT, 1000); // on air, nothing locked (it was forgotten): the target, with its card (finding b)
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'turnSideways' });
    hold(fakes, SIDEWAYS, 2000);
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']); // applied once, not sent again
    const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
    expect(refused.map((e) => e.fields.attempt)).toEqual([1, 2]);
  });

  // Final review m1: a lock refused twice is forgotten (R26), but the view still asks for it. The effect only ran
  // when `view.lock` changed, so a refused landscape lock under a held broadcast on a `free` screen was never sent
  // again, and the activity followed the phone under the camera.
  it('sends a landscape lock refused twice again on the next evaluation, under a held broadcast on a free screen (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 2;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    await gate('free', fakes); // Settings with a broadcast held: landscape (D9), refused
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS)); // the retry, refused too
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS)); // no third attempt on its own
    expect(fakes.orientationLock.locks).toEqual([]);
    const refused = () =>
      readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused').length;
    expect(refused()).toBe(2);
    hold(fakes, UPRIGHT, 1000); // the next evaluation: the phone is upright under the held broadcast
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    expect(refused()).toBe(2); // the re-request was accepted: nothing more was refused
  });

  // The same rule, bounded (R26): a refused `free` unlock is not re-sent on every evaluation. Two attempts, then
  // it waits for a differing lock, as before. The positive pair is the test above.
  it('does not send a refused free unlock again on later evaluations (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.orientationLock.lock = () => Promise.reject(new Error('refused'));
    await gate('free', fakes); // Home, nothing held: the screen follows the phone, refused
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS));
    const refused = () =>
      readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused').length;
    expect(refused()).toBe(2);
    hold(fakes, UPRIGHT, 1000); // evaluations: the phone turns upright, then sideways
    hold(fakes, SIDEWAYS, 2000);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refused()).toBe(2);
  });

  // Finding (a): the effect's cleanup ran on every dependency change, so an on-air keep, which is no lock at all,
  // cancelled the retry of a lock sent with nothing locked, and nothing was applied until the next sideways turn.
  it('keeps a refused lock’s retry alive across an on-air keep, and applies it (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 1;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    await gate('landscape', fakes); // on air, nothing locked: landscape at once (R37), refused; the retry waits
    hold(fakes, UPRIGHT, 0); // the operator tilts up: keep, which is no newer lock
    expect(fakes.orientationLock.locks).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS - 1));
    expect(fakes.orientationLock.locks).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    hold(fakes, SIDEWAYS, 1000); // already applied: not sent again
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  it('retries a lock whose refusal lands after an on-air keep, since a keep supersedes nothing (R26)', async () => {
    vi.useFakeTimers();
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
    hold(fakes, UPRIGHT, 0); // on air: keep, which cancels nothing
    await act(async () => refuse(new Error('refused'))); // then the refusal lands: one retry is owed
    await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS));
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    hold(fakes, SIDEWAYS, 1000);
    await act(async () => undefined);
    expect(fakes.orientationLock.locks).toEqual(['landscape']); // applied once
    const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
    expect(refused.map((e) => e.fields.attempt)).toEqual([1]);
  });

  it('cancels an older lock’s pending retry when a newer, different lock is sent (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    const lock = fakes.orientationLock.lock;
    let refusals = 1;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    await gate('landscape', fakes); // idle, no reading: landscape (R34), refused; the retry waits
    hold(fakes, UPRIGHT, 0); // off air: lock to the hands, portrait, a newer lock
    expect(fakes.orientationLock.locks).toEqual(['portrait']);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fakes.orientationLock.locks).toEqual(['portrait']); // the old landscape retry never ran
  });

  it('cancels the pending retry on unmount, so no lock is sent after the screen is gone', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refusals = 1;
    fakes.orientationLock.lock = (target) =>
      refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
    const { hook } = await gate('landscape', fakes); // refused; the retry waits
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fakes.orientationLock.locks).toEqual([]);
  });

  // The cancel only clears a timer that exists. A lock still pending when it is cancelled has no timer yet, so
  // its late refusal must not schedule one: that is `cancelled` in the catch, and nothing else stops it.
  it('does not retry a superseded lock whose refusal lands late (R26)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    const lock = fakes.orientationLock.lock;
    let refuse: (reason: Error) => void = () => undefined;
    let first = true;
    fakes.orientationLock.lock = (target) => {
      if (!first) return lock(target);
      first = false;
      return new Promise((_, reject) => {
        refuse = reject;
      });
    };
    await gate('landscape', fakes); // idle, no reading: landscape (R34); the platform has not answered
    hold(fakes, UPRIGHT, 0); // off air: lock to the hands, portrait, a newer lock
    expect(fakes.orientationLock.locks).toEqual(['portrait']);
    await act(async () => refuse(new Error('refused'))); // the old landscape refusal lands
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fakes.orientationLock.locks).toEqual(['portrait']); // no landscape retry
    const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
    expect(refused.map((e) => e.fields.attempt)).toEqual([1]); // the refusal did land, once
  });

  it('does not retry a lock whose refusal lands after unmount', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const lock = fakes.orientationLock.lock;
    let refuse: (reason: Error) => void = () => undefined;
    let first = true;
    fakes.orientationLock.lock = (target) => {
      if (!first) return lock(target); // a retry would reach the real port, and be recorded
      first = false;
      return new Promise((_, reject) => {
        refuse = reject;
      });
    };
    const { hook } = await gate('landscape', fakes); // on air: landscape (R37); the platform has not answered
    hook.unmount();
    await act(async () => refuse(new Error('refused'))); // the refusal lands on a screen that is gone
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fakes.orientationLock.locks).toEqual([]);
    const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
    expect(refused.map((e) => e.fields.attempt)).toEqual([1]); // landed once, and no second attempt
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
    act(() => fakes.engine.forceState({ kind: 'paired' })); // keep
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
    fakes.engine.forceState({ kind: 'paired' });
    const { hook } = await gate('landscape', fakes);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  // Spec §7 retires R35's Home case: Home turns with the phone, so a paired engine back on Home is a free
  // lock and no card. Opening Home or Settings covers the viewfinder, native closes the capture (F16), and
  // there is no camera left to hold the landscape lock for.
  it('Home after a paired viewfinder is free, with no upright card (spec §7, retiring R35)', async () => {
    const { fakes, hook } = await gate(routeTarget('/stream'));
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    act(() => fakes.engine.forceState({ kind: 'paired' }));
    hook.rerender({ to: routeTarget('/') });
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['landscape', 'free']);
  });
});

describe('useOrientationGate: Home and Settings turn with the phone (spec §7, D9)', () => {
  afterEach(() => vi.useRealTimers());

  it('Home while idle locks free, shows no card, and stays free as the phone turns', async () => {
    const { fakes, hook } = await gate(routeTarget('/'));
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free']);
    hold(fakes, SIDEWAYS, 0);
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    hold(fakes, UPRIGHT, 1000);
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    // Positive pair: the free lock is sent once, never per reading, and the gate is not simply dead.
    expect(fakes.orientationLock.locks).toEqual(['free']);
  });

  it('Home after a live broadcast that just ended locks free, with no card (retires R35)', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const { hook } = await gate(routeTarget('/stream'), fakes);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    act(() =>
      fakes.engine.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: 5 }),
    );
    hook.rerender({ to: routeTarget('/') });
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['landscape', 'free']);
  });

  it('Settings while live keeps the viewfinder’s landscape lock: no card, no lock call, whatever the hands do', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
    const { hook } = await gate(routeTarget('/stream'), fakes);
    hold(fakes, SIDEWAYS, 0);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
    hook.rerender({ to: routeTarget('/stream/settings') });
    expect(hook.result.current).toEqual({ lock: 'keep', card: 'none' });
    hold(fakes, UPRIGHT, 1000); // a tilt upright in Settings, mid-broadcast
    expect(hook.result.current).toEqual({ lock: 'keep', card: 'none' });
    hold(fakes, SIDEWAYS, 2000);
    expect(fakes.orientationLock.locks).toEqual(['landscape']);
  });

  it.each<[string, SessionState]>([
    ['arming', { kind: 'arming', cause: 'organiser', retrying: false }],
    ['armed', { kind: 'armed', cause: 'operator', notReady: 'sound' }],
    ['connecting', { kind: 'connecting', transport: 'srt' }],
    [
      'reconnecting',
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
    ],
  ])(
    'Settings while %s also keeps the lock: a broadcast is held from Arming on',
    async (_name, state) => {
      const fakes = createFakePorts();
      fakes.engine.forceState(state);
      const { hook } = await gate(routeTarget('/stream/settings'), fakes);
      // Nothing locked yet, a broadcast held: landscape at once (R37, for a free target).
      expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
      expect(fakes.orientationLock.locks).toEqual(['landscape']);
      hold(fakes, UPRIGHT, 0);
      hold(fakes, SIDEWAYS, 1000);
      hold(fakes, UPRIGHT, 2000);
      expect(hook.result.current).toEqual({ lock: 'keep', card: 'none' });
      expect(fakes.orientationLock.locks).toEqual(['landscape']);
    },
  );

  it.each<[string, SessionState]>([
    ['pairing', { kind: 'pairing' }],
    ['paired', { kind: 'paired' }],
  ])(
    'Settings while %s turns with the phone: no broadcast is held (Q3, F16)',
    async (_name, state) => {
      const fakes = createFakePorts();
      fakes.engine.forceState(state);
      const { hook } = await gate(routeTarget('/stream/settings'), fakes);
      hold(fakes, UPRIGHT, 0);
      expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
      hold(fakes, SIDEWAYS, 1000);
      expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
      expect(fakes.orientationLock.locks).toEqual(['free']);
    },
  );

  it('leaving paired Settings for the viewfinder upright: the hands lock portrait with the turn card, then landscape once turned (F16)', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'paired' });
    const { hook } = await gate(routeTarget('/stream/settings'), fakes);
    hold(fakes, UPRIGHT, 0);
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    hook.rerender({ to: routeTarget('/stream') });
    expect(hook.result.current).toEqual({ lock: 'portrait', card: 'turnSideways' });
    expect(fakes.orientationLock.locks).toEqual(['free', 'portrait']);
    hold(fakes, SIDEWAYS, 1000);
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free', 'portrait', 'landscape']);
  });

  it('leaving paired Settings for the viewfinder sideways locks landscape at once, no card (F16)', async () => {
    const fakes = createFakePorts();
    fakes.engine.forceState({ kind: 'paired' });
    const { hook } = await gate(routeTarget('/stream/settings'), fakes);
    hold(fakes, SIDEWAYS, 0);
    hook.rerender({ to: routeTarget('/stream') });
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free', 'landscape']);
  });

  it('sequence: free on Settings while idle, a remote Go live locks landscape once, and the end frees it again', async () => {
    const { fakes, hook } = await gate(routeTarget('/stream/settings'));
    hold(fakes, UPRIGHT, 0);
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free']);
    act(() => fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }));
    expect(hook.result.current).toEqual({ lock: 'landscape', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free', 'landscape']);
    hold(fakes, SIDEWAYS, 1000);
    hold(fakes, UPRIGHT, 2000); // mid-broadcast: the camera never rotates under it
    expect(hook.result.current).toEqual({ lock: 'keep', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free', 'landscape']);
    act(() =>
      fakes.engine.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: 5 }),
    );
    expect(hook.result.current).toEqual({ lock: 'free', card: 'none' });
    expect(fakes.orientationLock.locks).toEqual(['free', 'landscape', 'free']);
  });
});

describe('routeTarget', () => {
  // Spec §7: Live Stream's viewfinder is the only landscape-locked route; Home and Settings follow the phone.
  const ROWS = [
    ['/', 'free'],
    ['/stream', 'landscape'],
    ['/stream/settings', 'free'],
    // The Streaming help route is not Live Stream.
    ['/streaming-help', 'free'],
    // R2, P8: Stream Settings from Home is outside the mode and follows the phone; a prefix rule would lock it.
    ['/stream-settings', 'free'],
  ] as const;

  it('has its five rows (anti-vacuity)', () => {
    expect(ROWS).toHaveLength(5);
  });

  it.each(ROWS)('%s wants %s', (pathname, target) => {
    expect(routeTarget(pathname)).toBe(target);
  });
});
