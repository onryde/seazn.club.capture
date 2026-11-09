import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCricketMatch } from '@/hooks/useCricketMatch';
import { cricketSeed } from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { AWAY, HOME, OPENING, summary, type Spec } from '../../test/cricketLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Over totals on the cricket pad's hook (S2-4 plan Task 17): the away side's team sheet is not entered, so the match is
// scored over by over. The real runner, queue, sender and fold under it, on the fake server whose engine judges every
// event. Expected values come from the ledger the test states and the spec, never from the fold.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const NO_AWAY = { ...AWAY, lineup: [] };

const seedOf = (specs: readonly Spec[]): FakeMatchSeed => ({
  ...cricketSeed({ events: specs.map(({ type, payload }) => ({ type, payload })) }),
  sides: { home: HOME, away: NO_AWAY },
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

/** Time passes: the bounce windows (250 ms) of whatever was just tapped are over. */
const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function opened(seed: FakeMatchSeed) {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, 'stg.seazn.club', 'cricket');
  const view = renderHook(() => useCricketMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
  await flush();
  await wait();
  return { fakes, view, seed };
}

type Opened = Awaited<ReturnType<typeof opened>>;

function pad(opened: Opened) {
  const match = opened.view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

async function ledger(opened: Opened) {
  const events = await opened.fakes.scoring.events(LINK, opened.seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const typesOf = async (opened: Opened) => (await ledger(opened)).map((event) => event.type);

const OVER_ONE = { runs: 8, wickets: 0, balls: 6 };

describe('over totals on the hook', () => {
  it('a side with no players is scored in totals: the entry for over 1, no keys, no setup', async () => {
    const match = await opened(seedOf(OPENING));
    const { totals, display, setup } = pad(match);
    expect(display.stage).toBe('totals');
    expect(setup).toBeNull();
    expect(totals?.kind).toBe('entry');
    expect(totals?.kind === 'entry' ? totals.over : 0).toBe(1);
  });

  it('Record over sends the innings’ running totals, partial, and the next over is over 2', async () => {
    const match = await opened(seedOf(OPENING));
    act(() => pad(match).actions.enterTotals(OVER_ONE));
    await flush();
    const events = await ledger(match);
    expect(events.at(-1)).toMatchObject({
      type: 'cricket.innings.summary',
      payload: { runs: 8, wickets: 0, legalBalls: 6, partial: true },
    });
    const { totals, board } = pad(match);
    expect(board.score?.runs).toBe(8);
    expect(totals?.kind === 'entry' ? totals.over : 0).toBe(2);
  });

  it('two overs: 8/0 then 15/1, the second over’s own figures added', async () => {
    const match = await opened(seedOf(OPENING));
    act(() => pad(match).actions.enterTotals(OVER_ONE));
    await flush();
    await wait();
    act(() => pad(match).actions.enterTotals({ runs: 7, wickets: 1, balls: 6 }));
    await flush();
    const sent = (await ledger(match)).filter((event) => event.type === 'cricket.innings.summary');
    expect(sent.map((event) => event.payload)).toEqual([
      { runs: 8, wickets: 0, legalBalls: 6, partial: true },
      { runs: 15, wickets: 1, legalBalls: 12, partial: true },
    ]);
  });

  // The four questions, a second call: the entry starts again at the next over's defaults at once, under the same thumb,
  // so a double tap on Record would record an extra maiden over. Record is an opening tap: the second touch counts once.
  it('a double tap on Record records one over, and a later tap records the next', async () => {
    const match = await opened(seedOf(OPENING));
    act(() => pad(match).actions.enterTotals(OVER_ONE));
    await flush();
    const before = (await typesOf(match)).length;
    act(() => pad(match).actions.enterTotals({ runs: 0, wickets: 0, balls: 6 }));
    await flush();
    expect((await typesOf(match)).length).toBe(before);
    await wait();
    act(() => pad(match).actions.enterTotals({ runs: 0, wickets: 0, balls: 6 }));
    await flush();
    expect((await typesOf(match)).length).toBe(before + 1);
  });

  // The four questions, an empty input: nothing the engine would refuse reaches the ledger.
  it.each([
    ['more wickets than the side has', { runs: 0, wickets: 11, balls: 6 }],
    ['no balls', { runs: 0, wickets: 0, balls: 0 }],
    ['runs that are not a number', { runs: Number.NaN, wickets: 0, balls: 6 }],
  ])('%s records nothing', async (_, over) => {
    const match = await opened(seedOf(OPENING));
    const before = (await typesOf(match)).length;
    act(() => pad(match).actions.enterTotals(over));
    await flush();
    expect((await typesOf(match)).length).toBe(before);
  });

  it('Undo takes the over back: the ledger voids it and the entry is over 1 again', async () => {
    const match = await opened(seedOf(OPENING));
    act(() => pad(match).actions.enterTotals(OVER_ONE));
    await flush();
    await wait();
    act(() => pad(match).actions.undo());
    await flush();
    expect((await typesOf(match)).at(-1)).toBe('core.void');
    const { totals, board } = pad(match);
    expect(board.score?.runs).toBe(0);
    expect(totals?.kind === 'entry' ? totals.over : 0).toBe(1);
  });

  it('a tie nobody can bat a super over for has no entry, and records nothing', async () => {
    const tied = seedOf([...OPENING, summary(8, 0, 12), summary(8, 1, 12)]);
    const match = await opened(tied);
    expect(pad(match).display.stage).toBe('tiedNoPlayers');
    expect(pad(match).totals?.kind).toBe('tied');
    const before = (await typesOf(match)).length;
    act(() => pad(match).actions.enterTotals({ runs: 1, wickets: 0, balls: 1 }));
    await flush();
    expect((await typesOf(match)).length).toBe(before);
  });

  // Both teams entered and the innings not yet opened: the engine would take a summary here, but no entry stands on the
  // pad (the ball pad's), so a stray call records nothing and never turns the innings into one scored in totals.
  it('a match with both teams entered has no totals entry on the pad, and a stray call records nothing', async () => {
    const both: FakeMatchSeed = { ...seedOf(OPENING), sides: { home: HOME, away: AWAY } };
    const match = await opened(both);
    expect(pad(match).totals).toBeNull();
    const before = (await typesOf(match)).length;
    act(() => pad(match).actions.enterTotals(OVER_ONE));
    await flush();
    expect((await typesOf(match)).length).toBe(before);
  });
});
