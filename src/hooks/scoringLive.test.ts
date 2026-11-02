import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchEvent } from '@/domain/scoring/scoringMatch';
import { startLive, type LiveRunner } from '@/hooks/scoringLive';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// The one owner of a focused match's Realtime channel (plan S2-1 Task 9) over the fake channel and the fake server. The
// waits are the ones `liveBackoff.ts` pins: 15 s, 30 s, 60 s, 2 min, 5 min; polling is every 15 s.

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const SECOND = 1_000;

type Rig = {
  readonly fakes: FakePorts;
  readonly reads: MatchEvent[];
  readonly token: ReturnType<typeof vi.spyOn>;
  readonly stop: () => void;
};

/** `before` runs on the fakes ahead of the first join, which starts with `startLive`. */
function rig(
  options: { link?: ScoringLink | null; before?: (fakes: FakePorts) => void } = {},
): Rig {
  const fakes = createFakePorts({ clock: timerClock });
  options.before?.(fakes);
  const token = vi.spyOn(fakes.scoring, 'realtimeToken');
  const reads: MatchEvent[] = [];
  const link = options.link === undefined ? LINK : options.link;
  const runner: LiveRunner = {
    fixtureId: 'fake-singles',
    link: () => link,
    dispatch: (event) => {
      reads.push(event);
      return null;
    },
  };
  return { fakes, reads, token, stop: startLive(fakes.ports, runner) };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};
const opens = (fakes: FakePorts): boolean[] => fakes.realtime.subscriptions.map((one) => one.open);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('joining', () => {
  it('asks the server for a grant and joins the match’s channel with it', async () => {
    const { fakes } = rig();
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(1);
    expect(fakes.realtime.subscriptions[0].grant).toEqual({
      token: 'fake-realtime-token',
      channel: 'fixture:fake-singles',
      url: 'https://fake.supabase.test',
      apikey: 'fake-anon-key',
    });
  });

  it('with no link yet joins nothing and asks nothing', async () => {
    const { fakes, token } = rig({ link: null });
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(0);
    expect(token).not.toHaveBeenCalled();
  });

  it('with the app in the background joins nothing until it returns', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    fakes.foreground.leave();
    const stop = startLive(fakes.ports, {
      fixtureId: 'fake-singles',
      link: () => LINK,
      dispatch: () => null,
    });
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(0);
    fakes.foreground.fire();
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(1);
    stop();
  });

  it('a return while a grant is on its way joins once, with the latest grant', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const asked: Array<() => void> = [];
    vi.spyOn(fakes.scoring, 'realtimeToken').mockImplementation(
      (_link, fixtureId) =>
        new Promise((resolve) =>
          asked.push(() =>
            resolve({
              token: `t${asked.length}`,
              channel: `fixture:${fixtureId}`,
              url: 'https://x.test',
              apikey: 'k',
            }),
          ),
        ),
    );
    const stop = startLive(fakes.ports, {
      fixtureId: 'fake-singles',
      link: () => LINK,
      dispatch: () => null,
    });
    fakes.foreground.leave();
    fakes.foreground.fire();
    await flush();
    expect(asked).toHaveLength(2);
    asked.forEach((answer) => answer());
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(1);
    stop();
  });
});

describe('hearing', () => {
  it('a ping is a read', async () => {
    const { fakes, reads } = rig();
    await flush();
    fakes.realtime.ping();
    expect(reads).toEqual([{ kind: 'read' }]);
  });

  it('every time the channel comes up is a read, because the pings in the gap were lost', async () => {
    const { fakes, reads } = rig();
    await flush();
    fakes.realtime.restore();
    expect(reads).toHaveLength(1);
    fakes.realtime.drop();
    fakes.realtime.restore();
    expect(reads).toHaveLength(2);
  });
});

describe('a channel that drops', () => {
  it('is polled every 15 s until it is back, and not after', async () => {
    const { fakes, reads } = rig();
    await flush();
    fakes.realtime.restore();
    reads.length = 0;
    fakes.realtime.drop();
    await vi.advanceTimersByTimeAsync(14 * SECOND);
    expect(reads).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SECOND);
    expect(reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(reads).toHaveLength(2);
    fakes.realtime.restore();
    expect(reads).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(reads).toHaveLength(3);
  });

  it('is joined again with a fresh grant after 15 s, then 30 s, and a good join starts the waits over', async () => {
    const { fakes, token } = rig();
    await flush();
    fakes.realtime.restore();
    fakes.realtime.drop();
    await vi.advanceTimersByTimeAsync(14 * SECOND);
    expect(token).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SECOND);
    expect(token).toHaveBeenCalledTimes(2);
    expect(opens(fakes)).toEqual([false, true]);
    fakes.realtime.drop();
    await vi.advanceTimersByTimeAsync(29 * SECOND);
    expect(token).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SECOND);
    expect(token).toHaveBeenCalledTimes(3);
    fakes.realtime.restore();
    fakes.realtime.drop();
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(token).toHaveBeenCalledTimes(4);
  });

  it('a second drop while a join is waiting does not stack a second wait', async () => {
    const { fakes, token } = rig();
    await flush();
    fakes.realtime.restore();
    fakes.realtime.drop();
    fakes.realtime.restore();
    fakes.realtime.drop();
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(token).toHaveBeenCalledTimes(2);
  });
});

describe('a channel that comes back before the wait is over', () => {
  it('is not joined again: the wait is cancelled, and the working channel is left alone', async () => {
    const { fakes, token } = rig();
    await flush();
    fakes.realtime.restore();
    fakes.realtime.drop();
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    fakes.realtime.restore();
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(token).toHaveBeenCalledTimes(1);
    expect(opens(fakes)).toEqual([true]);
  });

  it('a drop said twice is one drop: one wait, one more grant', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const heard: Array<{ onDown: () => void }> = [];
    fakes.ports.realtime.subscribe = (_grant, handlers) => {
      heard.push(handlers);
      return () => undefined;
    };
    const token = vi.spyOn(fakes.scoring, 'realtimeToken');
    const stop = startLive(fakes.ports, {
      fixtureId: 'fake-singles',
      link: () => LINK,
      dispatch: () => null,
    });
    await flush();
    heard[0].onDown();
    heard[0].onDown();
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(token).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(token).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a grant refused when it is asked again closes the channel that dropped, which would retry for ever', async () => {
    const { fakes } = rig();
    await flush();
    fakes.realtime.restore();
    fakes.realtime.drop();
    fakes.scoring.revoke();
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(opens(fakes)).toEqual([false]);
  });
});

describe('no grant', () => {
  it('polls every 15 s and asks again after 15 s, 30 s, 60 s: it never loops hot', async () => {
    const { fakes, reads, token } = rig({ before: (fakes) => fakes.scoring.revoke() });
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(0);
    expect(token).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(reads).toHaveLength(1);
    expect(token).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    expect(token).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(token).toHaveBeenCalledTimes(4);
    expect(reads).toHaveLength(7);
  });
});

describe('leaving', () => {
  it('the background closes the channel, stops the polling and the wait; the return joins with a new grant', async () => {
    const { fakes, reads } = rig();
    await flush();
    fakes.realtime.restore();
    fakes.realtime.drop();
    const timers = vi.getTimerCount();
    fakes.foreground.leave();
    expect(opens(fakes)).toEqual([false]);
    expect(vi.getTimerCount()).toBeLessThan(timers);
    reads.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60 * SECOND);
    expect(reads).toHaveLength(0);
    fakes.foreground.fire();
    await flush();
    expect(opens(fakes)).toEqual([false, true]);
  });

  it('a grant that arrives after the background is not joined', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    let answer: () => void = () => undefined;
    vi.spyOn(fakes.scoring, 'realtimeToken').mockImplementation(
      (_link, fixtureId) =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              token: 't',
              channel: `fixture:${fixtureId}`,
              url: 'https://x.test',
              apikey: 'k',
            });
        }),
    );
    const stop = startLive(fakes.ports, {
      fixtureId: 'fake-singles',
      link: () => LINK,
      dispatch: () => null,
    });
    await flush();
    fakes.foreground.leave();
    answer();
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(0);
    stop();
  });

  it('stopping closes the channel, clears every timer and hears nothing more', async () => {
    const { fakes, reads, stop } = rig();
    const timers = vi.getTimerCount();
    await flush();
    fakes.realtime.restore();
    fakes.realtime.drop();
    stop();
    expect(opens(fakes)).toEqual([false]);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timers);
    expect(fakes.foreground.returnListeners()).toBe(0);
    expect(fakes.foreground.leaveListeners()).toBe(0);
    reads.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60 * SECOND);
    fakes.foreground.fire();
    await flush();
    expect(reads).toHaveLength(0);
    expect(fakes.realtime.subscriptions).toHaveLength(1);
  });

  it('a grant that arrives after the stop is not joined', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    let answer: () => void = () => undefined;
    vi.spyOn(fakes.scoring, 'realtimeToken').mockImplementation(
      (_link, fixtureId) =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              token: 't',
              channel: `fixture:${fixtureId}`,
              url: 'https://x.test',
              apikey: 'k',
            });
        }),
    );
    const stop = startLive(fakes.ports, {
      fixtureId: 'fake-singles',
      link: () => LINK,
      dispatch: () => null,
    });
    stop();
    answer();
    await flush();
    expect(fakes.realtime.subscriptions).toHaveLength(0);
  });
});
