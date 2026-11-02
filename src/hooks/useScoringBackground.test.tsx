import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScoringBackground } from '@/hooks/useScoringBackground';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { queuedOf, rally } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The background sender's mount (plan S2-1 Task 9): taps left queued are looked for at launch and at every return.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

async function leftQueued(fakes: FakePorts, id: string): Promise<void> {
  await saveScoringLink(fakes.kv, id, LINK);
  await fakes.tapQueue.save({
    fixtureId: id,
    label: 'A. Sharma v L. Chen',
    pending: [queuedOf('k1', rally('H'))],
    ownEventIds: [],
    dead: null,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the background sender', () => {
  it('starts a sender at launch for a match left with taps queued', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    fakes.scoring.goOffline(true);
    await leftQueued(fakes, 'm-live');
    renderHook(() => useScoringBackground(), { wrapper: wrapperFor(fakes) });
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(2);
  });

  it('with nothing queued starts none, and listens only for the return', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    renderHook(() => useScoringBackground(), { wrapper: wrapperFor(fakes) });
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(1);
  });

  it('looks again on the return to the foreground: a match left queued meanwhile gets its sender', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    fakes.scoring.goOffline(true);
    renderHook(() => useScoringBackground(), { wrapper: wrapperFor(fakes) });
    await flush();
    await leftQueued(fakes, 'm-late');
    expect(fakes.foreground.returnListeners()).toBe(1);
    fakes.foreground.leave();
    fakes.foreground.fire();
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(2);
  });

  it('stops listening for the return when unmounted', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const view = renderHook(() => useScoringBackground(), { wrapper: wrapperFor(fakes) });
    await flush();
    view.unmount();
    expect(fakes.foreground.returnListeners()).toBe(0);
  });
});
