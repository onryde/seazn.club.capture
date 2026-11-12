import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFootballMatch } from '@/hooks/useFootballMatch';
import { footballSeed, HOME_ENTRANT } from '@/services/fakeFootballPad';
import type { FakeSeedEvent } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// A football step sheet that lists people asks the bootstrap again, paced (S2-6 Task 3, ruling 181): a player the
// organiser added on the web after the pad opened is on the next list, and the list reads by what the match holds.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const START: FakeSeedEvent = { type: 'core.start', payload: {} };
const KICK_OFF: FakeSeedEvent = {
  type: 'football.clock',
  payload: { running: true, at: { period: 'H1', elapsed: 0 } },
};
const LIVE = footballSeed({ events: [START, KICK_OFF] });
const NEW_ID = `${HOME_ENTRANT}-pNew`;

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
  await saveScoringLink(fakes.kv, LIVE.fixtureId, LINK, 'stg.seazn.club', 'football');
  const view = renderHook(() => useFootballMatch(LIVE.fixtureId), { wrapper: wrapperFor(fakes) });
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
const optionIds = (view: Match): string[] => {
  const { sheet } = pad(view);
  return sheet?.kind === 'step' ? sheet.sheet.options.map((option) => option.id) : [];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-08T14:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a football sheet that lists people', () => {
  it('reads the bootstrap again, and the new player is on the list it shows', async () => {
    const { fakes, view } = await opened();
    const { home } = LIVE.sides;
    fakes.scoring.setSide('home', {
      ...home,
      members: [...home.members, { personId: NEW_ID, fullName: 'N. Newcomer' }],
      lineup: [
        ...home.lineup,
        { personId: NEW_ID, pairOrder: null, slot: 'starting', orderNo: 30 },
      ],
    });
    await wait(15_000);
    act(() => pad(view).actions.column('goal.first'));
    await flush();
    await wait(300);
    expect(optionIds(view)).toContain(`p.${NEW_ID}`);
  });

  it('asks once for two sheets inside the pace, and again once it is over', async () => {
    const { fakes, view } = await opened();
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.column('goal.first'));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => pad(view).actions.cancel());
    await wait(300);
    act(() => pad(view).actions.column('goal.first'));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => pad(view).actions.cancel());
    await wait(15_000);
    act(() => pad(view).actions.tool('more'));
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a column button that records at once (no team sheet) asks nothing', async () => {
    const seed = footballSeed({ events: [START, KICK_OFF], sheet: 'none' });
    const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
    await saveScoringLink(fakes.kv, seed.fixtureId, LINK, 'stg.seazn.club', 'football');
    const view = renderHook(() => useFootballMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
    await flush();
    await wait(1_000);
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await wait(15_000);
    act(() => pad(view).actions.column('goal.first'));
    await flush();
    expect(read).not.toHaveBeenCalled();
  });

  it('a re-read that drops a player the ledger names shows the unfoldable card: the server would refuse every tap', async () => {
    const scorer = `${HOME_ENTRANT}-p9`;
    const goal: FakeSeedEvent = {
      type: 'football.goal',
      payload: { by: HOME_ENTRANT, scorer, at: { period: 'H1', elapsed: 20 } },
    };
    const seed = footballSeed({ events: [START, KICK_OFF, goal] });
    const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
    await saveScoringLink(fakes.kv, seed.fixtureId, LINK, 'stg.seazn.club', 'football');
    const view = renderHook(() => useFootballMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
    await flush();
    await wait(1_000);
    expect(view.result.current.kind).toBe('pad');
    const { home } = seed.sides;
    fakes.scoring.setSide('home', {
      ...home,
      lineup: home.lineup.filter((row) => row.personId !== scorer),
    });
    await wait(15_000);
    act(() => pad(view).actions.column('goal.first'));
    await flush();
    expect(view.result.current).toMatchObject({ kind: 'unfoldable', reason: 'ledger' });
  });
});
