import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchDay } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { scoringHubOf } from '@/hooks/scoringHub';
import { useMatchDayExit } from '@/hooks/useMatchDayExit';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { MATCHDAY_KEYS } from '@/services/matchDayStore';
import { STORE_KEYS } from '@/services/modeStore';
import { readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { ledgerOf } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import {
  createFakePorts,
  readRecord,
  timerClock,
  TEST_NOW,
  type FakePorts,
} from '../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';
import { queueHolding } from '../../test/scoringHomeFixtures';
import { wrapperFor } from '../../test/renderWithPorts';

// MD-2 Task 7: leaving Match Day without losing a tap (S4 design §4). The hook over the real hub, the real tap queue and
// the real stores on in-memory files, and the fake scoring server: what Exit asks, what it forgets, what it keeps, and
// that the taps still go. What the screen draws is the screen's own suite; the phone is Task 8's.

const FIXTURE = SINGLES_SEED.fixtureId;
const OTHER = 'fake-doubles';
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const DAY_CODE = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };

/**
 * A made-up match with a real fixture id, Court 2's Now in `DAY`. The day's copy reads back through the day parser
 * (final review M3), whose fixture ids are uuids, so the fake server's 'fake-singles' is on no court a copy can hold.
 */
const ON_COURT_2 = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

/** The fake day with `ON_COURT_2` as Court 2's Now. */
const DAY: MatchDay = {
  ...FAKE_DAY,
  courts: [
    FAKE_DAY.courts[0] as MatchDay['courts'][number],
    {
      ...(FAKE_DAY.courts[1] as MatchDay['courts'][number]),
      state: 'playing',
      now: {
        ...(FAKE_DAY.courts[0]?.now as NonNullable<MatchDay['courts'][number]['now']>),
        fixtureId: ON_COURT_2,
      },
    },
  ],
};

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

const AT = '2026-11-02T09:00:00.000Z';

/** A pad that scored `count` taps while the server was away and was left: a real queue a sender can send, as the hub's. */
async function leaveTaps(fakes: FakePorts, count: number): Promise<void> {
  const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
  await flush();
  fakes.scoring.goOffline(true);
  handle.runner.dispatch({
    kind: 'tap',
    tap: { kind: 'start', server: 'first' },
    key: 'k0',
    at: AT,
  });
  for (let n = 1; n < count; n += 1)
    handle.runner.dispatch({
      kind: 'tap',
      tap: { kind: 'rally', side: 'first' },
      key: `k${n}`,
      at: AT,
    });
  await flush();
  handle.release();
  await flush();
}

type Setup = {
  /** Taps queued for the match, held back by a server that is away. */
  readonly taps?: number;
  readonly saved?: boolean;
  readonly opened?: readonly string[];
  readonly prepare?: (fakes: FakePorts) => void | Promise<void>;
};

async function mount(setup: Setup = {}) {
  const fakes = createFakePorts({
    clock: timerClock,
    kvSeed: {
      ...(setup.saved === false
        ? {}
        : { [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY) }),
      [STORE_KEYS.active]: 'matchday',
    },
  });
  await fakes.ports.modeStore.load();
  fakes.navigation.go('matchday');
  await fakes.ports.matchDayStore.writeCache(DAY_CODE, DAY, TEST_NOW);
  for (const id of setup.opened ?? [FIXTURE]) await fakes.ports.matchDayStore.addOpened(id);
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  const read = await fakes.scoring.bootstrap(LINK);
  if (read.kind !== 'ok') throw new Error('the fake serves the match');
  await fakes.tapQueue.saveBoot(FIXTURE, {
    bootstrap: read.bootstrap,
    toss: null,
    picks: NO_PICKS,
  });
  await fakes.tapQueue.saveLedger(FIXTURE, ledgerOf([]));
  if ((setup.taps ?? 0) > 0) await leaveTaps(fakes, setup.taps ?? 0);
  await setup.prepare?.(fakes);
  const note = vi.fn();
  const view = renderHook(() => useMatchDayExit(note), { wrapper: wrapperFor(fakes) });
  return { ...fakes, ...view, note };
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const savedCode = (fakes: FakePorts) => {
  const snapshot = fakes.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.matchday ?? null) : null;
};
const hasLink = async (fakes: FakePorts, id = FIXTURE) =>
  (await readScoringLink(fakes.kv, id, HOST)).kind === 'link';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
});
afterEach(() => vi.useRealTimers());

describe('the question', () => {
  it('opens only after it has read what is at stake: nothing unsent, then 3 unsent', async () => {
    const none = await mount();
    expect(none.result.current.sheet).toBeNull();
    act(() => none.result.current.ask());
    await settle();
    expect(none.result.current.sheet).toEqual({ count: 0, unreadable: false });
    const three = await mount({ taps: 3 });
    act(() => three.result.current.ask());
    expect(three.result.current.sheet).toBeNull();
    await settle();
    expect(three.result.current.sheet).toEqual({ count: 3, unreadable: false });
  });

  it('counts only the matches Match Day opened', async () => {
    const view = await mount({ taps: 3, opened: [] });
    act(() => view.result.current.ask());
    await settle();
    expect(view.result.current.sheet).toEqual({ count: 0, unreadable: false });
  });

  it('a queue the phone cannot read is taps at risk, never none', async () => {
    const view = await mount({
      prepare: (fakes) => {
        fakes.queueFiles.files.set(`${FIXTURE}.json`, '{garbled');
      },
    });
    act(() => view.result.current.ask());
    await settle();
    expect(view.result.current.sheet).toEqual({ count: 0, unreadable: true });
  });

  it('a second ask while one is out, or while the question shows, changes nothing', async () => {
    const view = await mount({ taps: 2 });
    act(() => {
      view.result.current.ask();
      view.result.current.ask();
    });
    await settle();
    expect(view.result.current.sheet).toEqual({ count: 2, unreadable: false });
    await view.tapQueue.save(queueHolding(FIXTURE, 5));
    act(() => view.result.current.ask());
    await settle();
    expect(view.result.current.sheet?.count).toBe(2);
  });

  it('a second ask reads the queues once, in flight or after the question shows', async () => {
    const view = await mount({ taps: 2 });
    const read = vi.spyOn(view.tapQueue, 'list');
    act(() => {
      view.result.current.ask();
      view.result.current.ask();
    });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => view.result.current.ask());
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('no question opens while Exit is leaving', async () => {
    const view = await mount({ taps: 1 });
    act(() => {
      void view.result.current.exit();
      view.result.current.ask();
    });
    await settle();
    expect(view.result.current.sheet).toBeNull();
  });

  it('Stay closes it, changes nothing and notes the moment once', async () => {
    const view = await mount({ taps: 1 });
    act(() => view.result.current.ask());
    await settle();
    act(() => view.result.current.stay());
    act(() => view.result.current.stay());
    expect(view.result.current.sheet).toBeNull();
    expect(view.note).toHaveBeenCalledTimes(1);
    expect(savedCode(view)).not.toBeNull();
    expect(view.navigation.current()).toBe('matchday');
    expect(await view.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(readRecord(view.record).some((line) => line.event === 'matchday.exit')).toBe(false);
  });

  it('Stay with nothing asked notes nothing', async () => {
    const view = await mount();
    act(() => view.result.current.stay());
    expect(view.note).not.toHaveBeenCalled();
  });

  it('can be asked again after Stay', async () => {
    const view = await mount({ taps: 1 });
    act(() => view.result.current.ask());
    await settle();
    act(() => view.result.current.stay());
    act(() => view.result.current.ask());
    await settle();
    expect(view.result.current.sheet).toEqual({ count: 1, unreadable: false });
  });
});

describe('Exit never discards a tap', () => {
  it('with 3 unsent: the taps are still sent after Exit, and the phone is Home', async () => {
    const view = await mount({ taps: 3 });
    await act(() => view.result.current.exit());
    expect(view.navigation.current()).toBe('home');
    // Nothing has reached the server: it is away, and Exit has not touched the queue.
    expect((await view.tapQueue.load(FIXTURE))?.pending).toHaveLength(3);
    view.scoring.goOffline(false);
    await settle(30_000);
    expect(await view.tapQueue.load(FIXTURE)).toBeNull();
    const events = await view.scoring.events(LINK, FIXTURE, 0);
    expect(Array.isArray(events) ? events.length : -1).toBeGreaterThanOrEqual(3);
  });

  it('the link goes once its queue is empty, not before', async () => {
    const view = await mount({ taps: 2 });
    await act(() => view.result.current.exit());
    expect(await hasLink(view)).toBe(true);
    await settle(30_000);
    expect(await hasLink(view)).toBe(true);
    view.scoring.goOffline(false);
    await settle(30_000);
    expect((await view.tapQueue.load(FIXTURE)) === null || (await hasLink(view)) === false).toBe(
      true,
    );
    expect(await hasLink(view)).toBe(false);
  });

  it('nudges the hub: a sender runs for the match at once', async () => {
    const view = await mount({ taps: 1 });
    const resume = vi.spyOn(scoringHubOf(view.ports), 'resume');
    await act(() => view.result.current.exit());
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('a match with an empty queue is let go: its link goes with the day', async () => {
    const view = await mount();
    await view.tapQueue.save(queueHolding(FIXTURE, 0));
    await act(() => view.result.current.exit());
    await settle(5_000);
    expect(await hasLink(view)).toBe(false);
  });
});

describe('what Exit forgets and keeps', () => {
  it('forgets the code, the copy, the open match and every opened id, and goes Home', async () => {
    const view = await mount({ taps: 1 });
    await view.ports.matchDayStore.setOpen({ fixtureId: FIXTURE, courtName: 'Court 2' });
    expect(await view.ports.matchDayStore.readCache(DAY_CODE)).not.toBeNull();
    await act(() => view.result.current.exit());
    expect(savedCode(view)).toBeNull();
    expect(view.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(await view.ports.matchDayStore.readCache(DAY_CODE)).toBeNull();
    expect(view.kv.entries.has(MATCHDAY_KEYS.open)).toBe(false);
    expect(view.ports.matchDayStore.openMatch()).toBeNull();
    expect(view.kv.entries.has(MATCHDAY_KEYS.opened)).toBe(false);
    expect(view.navigation.current()).toBe('home');
  });

  it('clears an id a dismissed dead-link card left in opened, as well as the live ones (T5 c7)', async () => {
    const view = await mount({ opened: [FIXTURE, 'left-by-a-dismiss'] });
    await act(() => view.result.current.exit());
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
  });

  it('notes the court of each match still sending, and none for a match with nothing unsent', async () => {
    const view = await mount({
      opened: [ON_COURT_2, OTHER],
      prepare: async (fakes) => {
        await fakes.tapQueue.save(
          queueHolding(ON_COURT_2, 2, { askedAbout: [`${ON_COURT_2}-k0`] }),
        );
        await fakes.tapQueue.save(queueHolding(OTHER, 0));
      },
    });
    await act(() => view.result.current.exit());
    expect([...(await view.ports.matchDayStore.sending())]).toEqual([[ON_COURT_2, 'Court 2']]);
  });

  it('a match on no court in the copy is noted with none; no copy at all is the same', async () => {
    const view = await mount({
      taps: 1,
      prepare: async (fakes) => {
        await fakes.ports.matchDayStore.clearCache();
      },
    });
    await act(() => view.result.current.exit());
    expect([...(await view.ports.matchDayStore.sending())]).toEqual([[FIXTURE, '']]);
  });

  it('a queue that cannot be read is not noted as sending (Home has its own card for it)', async () => {
    const view = await mount({
      prepare: (fakes) => {
        fakes.queueFiles.files.set(`${FIXTURE}.json`, '{garbled');
      },
    });
    await act(() => view.result.current.exit());
    expect((await view.ports.matchDayStore.sending()).size).toBe(0);
  });

  it('nothing to send: nothing is noted and the key is never written', async () => {
    const view = await mount();
    await act(() => view.result.current.exit());
    expect(view.kv.entries.has(MATCHDAY_KEYS.sending)).toBe(false);
  });

  it('the hub drops the note when it lets the match go', async () => {
    const view = await mount({ taps: 1 });
    await act(() => view.result.current.exit());
    expect((await view.ports.matchDayStore.sending()).size).toBe(1);
    view.scoring.goOffline(false);
    await settle(30_000);
    expect((await view.ports.matchDayStore.sending()).size).toBe(0);
  });
});

describe('the hub lets go of a match Exit left sending', () => {
  it.each(['dismiss', 'leave'] as const)('%s drops the note', async (way) => {
    const view = await mount({ taps: 1 });
    await view.ports.matchDayStore.addSending(new Map([[FIXTURE, 'Court 2']]));
    await scoringHubOf(view.ports)[way](FIXTURE);
    expect((await view.ports.matchDayStore.sending()).size).toBe(0);
  });

  it('a refused drop of the note is recorded and the match still goes', async () => {
    const view = await mount({ taps: 1 });
    await view.ports.matchDayStore.addSending(new Map([[FIXTURE, 'Court 2']]));
    vi.spyOn(view.ports.matchDayStore, 'forgetSending').mockRejectedValue(new Error('refused'));
    await scoringHubOf(view.ports).dismiss(FIXTURE);
    expect(await hasLink(view)).toBe(false);
    expect(readRecord(view.record).some((l) => l.event === 'matchday.sending-refused')).toBe(true);
    expect(readRecord(view.record).some((l) => l.event === 'scoring.tidy-refused')).toBe(false);
  });
});

/** A kv whose deletes land late, as a secure store's do: what a sweep sees meanwhile is what is left. */
function delayDeletes(fakes: FakePorts, ms = 50): void {
  const real = fakes.kv.delete.bind(fakes.kv);
  vi.spyOn(fakes.kv, 'delete').mockImplementation(async (key: string) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return real(key);
  });
}

describe('Exit clears the list and forgets the day BEFORE it nudges the hub (review I1, I2)', () => {
  it('the hub is nudged when opened and the day code are already gone', async () => {
    const view = await mount({ taps: 1 });
    let seen: { opened: readonly string[]; saved: boolean } | null = null;
    vi.spyOn(scoringHubOf(view.ports), 'resume').mockImplementation(async () => {
      seen = { opened: await view.ports.matchDayStore.opened(), saved: savedCode(view) !== null };
    });
    await act(() => view.result.current.exit());
    expect(seen).toEqual({ opened: [], saved: false });
  });

  it('the list is cleared before the day code is forgotten', async () => {
    const view = await mount({ taps: 1 });
    let openedAtForget: readonly string[] | null = null;
    const real = view.ports.modeStore.forget.bind(view.ports.modeStore);
    vi.spyOn(view.ports.modeStore, 'forget').mockImplementation(async (...args) => {
      openedAtForget = await view.ports.matchDayStore.opened();
      return real(...args);
    });
    await act(() => view.result.current.exit());
    expect(openedAtForget).toEqual([]);
  });

  it('with deletes landing late, a match whose queue is empty is let go by the nudge, link and all', async () => {
    const view = await mount({
      opened: [FIXTURE],
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(FIXTURE, 0));
      },
    });
    delayDeletes(view);
    await act(async () => {
      const left = view.result.current.exit();
      await vi.advanceTimersByTimeAsync(2_000);
      await left;
    });
    await settle(2_000);
    expect(await hasLink(view)).toBe(false);
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
  });

  it('with deletes landing late, 3 unsent taps are still sent, and the link goes only once the queue is empty', async () => {
    const view = await mount({ taps: 3 });
    delayDeletes(view);
    await act(async () => {
      const left = view.result.current.exit();
      await vi.advanceTimersByTimeAsync(2_000);
      await left;
    });
    await settle(2_000);
    expect(view.navigation.current()).toBe('home');
    expect((await view.tapQueue.load(FIXTURE))?.pending).toHaveLength(3);
    expect(await hasLink(view)).toBe(true);
    view.scoring.goOffline(false);
    await settle(60_000);
    expect(await view.tapQueue.load(FIXTURE)).toBeNull();
    expect(await hasLink(view)).toBe(false);
  });

  it('Stay is ignored while Exit is leaving: no bounce noted, the sheet closes with the leave', async () => {
    const view = await mount({ taps: 1 });
    act(() => view.result.current.ask());
    await settle();
    let left: Promise<void> = Promise.resolve();
    act(() => {
      left = view.result.current.exit();
      view.result.current.stay();
    });
    expect(view.note).not.toHaveBeenCalled();
    expect(view.result.current.sheet).not.toBeNull();
    await act(() => left);
    expect(view.result.current.sheet).toBeNull();
    expect(view.note).not.toHaveBeenCalled();
  });

  it('a refused clear of the opened list leaves it, and the next resume clears it, with the match let go', async () => {
    const view = await mount({
      opened: [FIXTURE],
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(FIXTURE, 0));
      },
    });
    // Exit's own clear and the heal in the nudge it sends are both refused; the next launch's resume gets it.
    vi.spyOn(view.ports.matchDayStore, 'clearOpened')
      .mockRejectedValueOnce(new Error('refused'))
      .mockRejectedValueOnce(new Error('refused'));
    await act(() => view.result.current.exit());
    await settle(2_000);
    expect(savedCode(view)).toBeNull();
    expect(await view.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(await hasLink(view)).toBe(false);
    await act(() => scoringHubOf(view.ports).resume());
    await settle(2_000);
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a process that died after the forget (no code, opened ids, a note) heals at the next launch', async () => {
    const view = await mount({
      saved: false,
      opened: [FIXTURE],
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(FIXTURE, 0));
        await fakes.ports.matchDayStore.addSending(new Map([[FIXTURE, 'Court 2']]));
      },
    });
    expect(await view.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    await act(() => scoringHubOf(view.ports).resume());
    await settle(2_000);
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
    expect((await view.ports.matchDayStore.sending()).size).toBe(0);
    expect(await hasLink(view)).toBe(false);
  });

  it('a day still saved keeps its opened list: the heal never fires on a live day', async () => {
    const view = await mount({
      opened: [FIXTURE],
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(FIXTURE, 0));
      },
    });
    await act(() => scoringHubOf(view.ports).resume());
    await settle(2_000);
    expect(await view.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(await hasLink(view)).toBe(true);
  });

  it('a refused clear of the open match is recorded and Exit still goes Home', async () => {
    const view = await mount({ taps: 1 });
    vi.spyOn(view.ports.matchDayStore, 'clearOpen').mockRejectedValue(new Error('refused'));
    await act(() => view.result.current.exit());
    expect(view.navigation.current()).toBe('home');
    expect(readRecord(view.record).some((l) => l.event === 'matchday.open-clear-refused')).toBe(
      true,
    );
  });
});

describe('a second call, an empty input and an interruption', () => {
  it('a second Exit while the first is out leaves once: one record line, one nudge', async () => {
    const view = await mount({ taps: 1 });
    const resume = vi.spyOn(scoringHubOf(view.ports), 'resume');
    await act(async () => {
      await Promise.all([view.result.current.exit(), view.result.current.exit()]);
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(readRecord(view.record).filter((line) => line.event === 'matchday.exit')).toHaveLength(
      1,
    );
  });

  it('Exit with no code saved (it went already) still lets go of the opened matches and goes Home', async () => {
    const view = await mount({ saved: false, taps: 1 });
    await act(() => view.result.current.exit());
    expect(view.navigation.current()).toBe('home');
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
    expect(view.ports.homeNews.peek()).toBeNull();
    expect(readRecord(view.record).some((l) => l.event === 'store.write-refused')).toBe(false);
  });

  it('a refused forget keeps the code, says so on Home, and still lets go and goes Home', async () => {
    const view = await mount({ taps: 1 });
    const real = view.ports.modeStore.forget;
    vi.spyOn(view.ports.modeStore, 'forget').mockRejectedValue(new Error('keystore refused'));
    await act(() => view.result.current.exit());
    expect(real).toBeDefined();
    expect(savedCode(view)).not.toBeNull();
    expect(view.ports.homeNews.peek()).toBe('store.saveFailed');
    expect(view.navigation.current()).toBe('home');
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
    expect(readRecord(view.record).some((l) => l.event === 'store.write-refused')).toBe(true);
  });

  it('a refused clear of the opened ids is recorded and Exit still goes Home', async () => {
    const view = await mount({ taps: 1 });
    vi.spyOn(view.ports.matchDayStore, 'clearOpened').mockRejectedValue(new Error('refused'));
    await act(() => view.result.current.exit());
    expect(view.navigation.current()).toBe('home');
    expect(
      readRecord(view.record).some(
        (l) => l.event === 'store.write-refused' && l.fields.action === 'exit',
      ),
    ).toBe(true);
  });

  it('a refused note of the courts is recorded, and Exit still goes Home', async () => {
    const view = await mount({ taps: 1 });
    vi.spyOn(view.ports.matchDayStore, 'addSending').mockRejectedValue(new Error('refused'));
    await act(() => view.result.current.exit());
    expect(view.navigation.current()).toBe('home');
    expect(readRecord(view.record).some((l) => l.event === 'matchday.sending-refused')).toBe(true);
  });

  it('a hub that refuses to resume is recorded, and Exit still goes Home', async () => {
    const view = await mount({ taps: 1 });
    vi.spyOn(scoringHubOf(view.ports), 'resume').mockRejectedValue(new Error('refused'));
    await act(() => view.result.current.exit());
    await settle();
    expect(view.navigation.current()).toBe('home');
    expect(readRecord(view.record).some((l) => l.event === 'matchday.exit-send-refused')).toBe(
      true,
    );
  });

  it('a tap queue that rejects when asked reads as at risk (the parts say they never do; none is not assumed)', async () => {
    const view = await mount({ taps: 1 });
    vi.spyOn(view.ports.tapQueue, 'list').mockRejectedValue(new Error('disk'));
    act(() => view.result.current.ask());
    await settle();
    expect(view.result.current.sheet).toEqual({ count: 0, unreadable: true });
    expect(readRecord(view.record).some((l) => l.event === 'matchday.exit-unreadable')).toBe(true);
  });

  it('unmounted before the read lands, the question does not open', async () => {
    const view = await mount({ taps: 1 });
    act(() => view.result.current.ask());
    view.unmount();
    await settle();
    expect(view.result.current.sheet).toBeNull();
  });
});

describe('the record', () => {
  it('gets matchday.exit {unsent}: the count at the moment of Exit, and no token, link or fixture', async () => {
    const view = await mount({ taps: 3 });
    await act(() => view.result.current.exit());
    const lines = readRecord(view.record).filter((l) => l.event === 'matchday.exit');
    expect(lines).toEqual([expect.objectContaining({ fields: { unsent: 3 } })]);
    const text = view.record.lines().join('\n');
    for (const secret of [FIXTURE_DAY_TOKEN, FAKE_SCORING_SECRET, FIXTURE, 'dl_', 'md_'])
      expect(text).not.toContain(secret);
  });

  it('records the count read at Exit, not the one the question showed', async () => {
    const view = await mount({ taps: 3 });
    act(() => view.result.current.ask());
    await settle();
    await view.tapQueue.save(queueHolding(FIXTURE, 1));
    await act(() => view.result.current.exit());
    const line = readRecord(view.record).find((l) => l.event === 'matchday.exit');
    expect(line?.fields).toEqual({ unsent: 1 });
  });

  it('records null, never a made-up 0, for a queue that cannot be read', async () => {
    const view = await mount({
      prepare: (fakes) => {
        fakes.queueFiles.files.set(`${FIXTURE}.json`, '{garbled');
      },
    });
    await act(() => view.result.current.exit());
    const line = readRecord(view.record).find((l) => l.event === 'matchday.exit');
    expect(line?.fields).toEqual({ unsent: null });
  });
});

describe('Exit lets go of a match it opened that was never tapped (final review I1)', () => {
  /** The nudge's own heal would also let go once the day is gone: held off, so what is seen is Exit's own pass. */
  const holdNudge = (view: FakePorts) =>
    vi.spyOn(scoringHubOf(view.ports), 'resume').mockResolvedValue(undefined);
  const nothingLeft = async (view: FakePorts, id = FIXTURE) =>
    !(await hasLink(view, id)) &&
    (await view.tapQueue.loadBoot(id)) === null &&
    (await view.tapQueue.loadLedger(id)) === null;

  it('viewed with no taps: Exit itself takes its link, boot cache and ledger, and the list', async () => {
    const view = await mount();
    holdNudge(view);
    await act(() => view.result.current.exit());
    expect(await nothingLeft(view)).toBe(true);
    expect(view.kv.entries.has(MATCHDAY_KEYS.opened)).toBe(false);
    expect(view.navigation.current()).toBe('home');
  });

  it('with the nudge running too: nothing is left of the untapped match after Exit', async () => {
    const view = await mount();
    await act(() => view.result.current.exit());
    await settle(2_000);
    expect(await nothingLeft(view)).toBe(true);
  });

  it('a match with taps keeps its link until its queue empties; the untapped one beside it goes at Exit', async () => {
    const view = await mount({
      taps: 2,
      opened: [FIXTURE, OTHER],
      prepare: async (fakes) => {
        await saveScoringLink(fakes.kv, OTHER, LINK, HOST, 'badminton');
      },
    });
    const nudge = holdNudge(view);
    await act(() => view.result.current.exit());
    expect(await hasLink(view, OTHER)).toBe(false);
    expect(await hasLink(view)).toBe(true);
    expect((await view.tapQueue.load(FIXTURE))?.pending).toHaveLength(2);
    nudge.mockRestore();
    view.scoring.goOffline(false);
    await act(() => scoringHubOf(view.ports).resume());
    await settle(60_000);
    expect(await view.tapQueue.load(FIXTURE)).toBeNull();
    expect(await hasLink(view)).toBe(false);
  });

  it('a match on screen is untouched by Exit and stays on the list; its release lets it go', async () => {
    const view = await mount();
    const handle = scoringHubOf(view.ports).focus(FIXTURE);
    await settle(1_000);
    const nudge = holdNudge(view);
    await act(() => view.result.current.exit());
    expect(await hasLink(view)).toBe(true);
    expect(await view.tapQueue.loadBoot(FIXTURE)).not.toBeNull();
    expect(await view.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    nudge.mockRestore();
    act(() => handle.release());
    await settle(2_000);
    expect(await nothingLeft(view)).toBe(true);
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a refused delete of its link is recorded, keeps it on the list, Exit still goes Home, and a later resume lets it go', async () => {
    const view = await mount();
    const real = view.kv.delete.bind(view.kv);
    const refuse = vi
      .spyOn(view.kv, 'delete')
      .mockImplementation((key: string) =>
        key === `scoring.link.${FIXTURE}` ? Promise.reject(new Error('refused')) : real(key),
      );
    await act(() => view.result.current.exit());
    await settle(2_000);
    expect(view.navigation.current()).toBe('home');
    expect(savedCode(view)).toBeNull();
    expect(await hasLink(view)).toBe(true);
    expect(await view.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(readRecord(view.record).some((l) => l.event === 'matchday.let-go-refused')).toBe(true);
    refuse.mockRestore();
    await act(() => scoringHubOf(view.ports).resume());
    await settle(2_000);
    expect(await nothingLeft(view)).toBe(true);
    expect(await view.ports.matchDayStore.opened()).toEqual([]);
  });
});
