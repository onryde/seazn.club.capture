import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCricketMatch } from '@/hooks/useCricketMatch';
import { liveCricketSeed } from '@/services/fakeCricketPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// A cricket sheet that lists people (Players, Out, More) asks the bootstrap again, paced (S2-6 Task 3, ruling 181).
// An extra's step lists nobody and asks nothing.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const LIVE = liveCricketSeed();

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function opened() {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: LIVE });
  await saveScoringLink(fakes.kv, LIVE.fixtureId, LINK, 'stg.seazn.club', 'cricket');
  const view = renderHook(() => useCricketMatch(LIVE.fixtureId), { wrapper: wrapperFor(fakes) });
  await flush();
  await wait(1_000);
  return { fakes, view };
}
type Match = Awaited<ReturnType<typeof opened>>['view'];

function pad(view: Match) {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a cricket sheet that lists people', () => {
  it('Players asks the bootstrap again, once inside the pace, and again after it', async () => {
    const { fakes, view } = await opened();
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.openPlayers());
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => pad(view).actions.cancel());
    await wait(1_000);
    act(() => pad(view).actions.openPlayers());
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => pad(view).actions.cancel());
    await wait(15_000);
    act(() => pad(view).actions.openPlayers());
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('Out and More ask it too', async () => {
    const { fakes, view } = await opened();
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.openOut());
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => pad(view).actions.cancel());
    await wait(15_000);
    act(() => pad(view).actions.openMore());
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('an extra’s step lists nobody and asks nothing', async () => {
    const { fakes, view } = await opened();
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.openExtras('wide'));
    await flush();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('a press that opens nothing asks nothing', () => {
  it('Out and More on the heels of a recorded ball are the second touch: no sheet, no read', async () => {
    const { fakes, view } = await opened();
    await wait(15_000);
    act(() => pad(view).actions.openExtras('wide'));
    await wait(1_000);
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.choose('ran.1'));
    act(() => pad(view).actions.openOut());
    act(() => pad(view).actions.openMore());
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
