import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCricketMatch } from '@/hooks/useCricketMatch';
import { cricketSeed } from '@/services/fakeCricketPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// Cricket's setup lists people on two steps, the batting order and the first bowler: each asks the bootstrap again when
// it appears, paced (S2-6 Task 3, ruling 181). The toss lists nobody.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const FRESH = cricketSeed();

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
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: FRESH });
  await saveScoringLink(fakes.kv, FRESH.fixtureId, LINK, 'stg.seazn.club', 'cricket');
  const view = renderHook(() => useCricketMatch(FRESH.fixtureId), { wrapper: wrapperFor(fakes) });
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
const step = (view: Match) => pad(view).setup?.step;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cricket’s setup steps that list people', () => {
  it('the toss asks nothing; the order and then the bowler each ask once as they appear', async () => {
    const { fakes, view } = await opened();
    expect(step(view)).toBe('toss');
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.pickTossWinner('first'));
    await flush();
    expect(read).not.toHaveBeenCalled();
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait(1_000);
    expect(step(view)).toBe('order');
    expect(read).toHaveBeenCalledTimes(1);
    const next = pad(view).setup?.view.nextOpeners;
    if (next === null || next === undefined) throw new Error('expected two openers');
    await wait(15_000);
    act(() => pad(view).actions.setOpeners(next));
    await flush();
    expect(step(view)).toBe('bowler');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
