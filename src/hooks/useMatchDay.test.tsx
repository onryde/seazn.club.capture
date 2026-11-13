import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchDay } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { MATCHDAY_POLL_MS, useMatchDay } from '@/hooks/useMatchDay';
import { forgetWithCopy } from '@/hooks/useMatchDayHome';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createMatchDayStore, MATCHDAY_KEYS } from '@/services/matchDayStore';
import { STORE_KEYS } from '@/services/modeStore';
import { createRingRecord } from '@/services/sessionRecord';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';
import { refusingStore } from '../../test/refusingStore';
import { wrapperFor } from '../../test/renderWithPorts';
import { queueHolding } from '../../test/scoringHomeFixtures';

// MD-2 Task 4: the list's hook (S4 design §5): the last copy first, then the server every 15 s while the list is on
// screen and the app in the foreground; an answer that lands after the list or its code has gone changes nothing.

const DAY_CODE = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
/** 09:42Z on the fakes' day: 10:42 in London, the copy's own time. */
const COPIED_AT = new Date('2026-10-03T09:42:00.000Z');
/** The copy an earlier read left: the fake day with its first court renamed, so the copy and the server differ. */
const COPY: MatchDay = {
  ...FAKE_DAY,
  courts: FAKE_DAY.courts.map((court, at) =>
    at === 0 ? { ...court, courtName: 'Court A' } : court,
  ),
};

async function copyFiles(day: MatchDay = COPY, at = COPIED_AT): Promise<Record<string, string>> {
  const files = createMemoryQueueFiles();
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const store = createMatchDayStore({ kv: createMemoryKeyValueStore(), files, logger });
  await store.writeCache(DAY_CODE, day, at);
  return Object.fromEntries(files.files);
}

type Setup = {
  readonly copy?: boolean;
  readonly saved?: SavedCode | null;
  readonly kv?: Record<string, string>;
  readonly prepare?: (fakes: FakePorts) => void | Promise<void>;
  readonly ports?: Parameters<typeof createFakePorts>[0];
};

/** The hook on the fake ports with the day code saved and active, and (unless `copy` is false) the copy on disk. */
async function mount(setup: Setup = {}) {
  const saved = setup.saved === undefined ? SAVED_DAY : setup.saved;
  const fakes = createFakePorts({
    kvSeed: {
      ...(saved === null ? {} : { [STORE_KEYS.code('matchday')]: encodeSavedCode(saved) }),
      [STORE_KEYS.active]: 'matchday',
      ...setup.kv,
    },
    dayFilesSeed: setup.copy === false ? {} : await copyFiles(),
    ...setup.ports,
  });
  await fakes.ports.modeStore.load();
  // Home's tile opened the list: the route is Match Day's, so a move Home is one (the fake ignores a repeat).
  fakes.navigation.go('matchday');
  await setup.prepare?.(fakes);
  const view = renderHook(() => useMatchDay(), { wrapper: wrapperFor(fakes) });
  await settle();
  return { ...fakes, ...view };
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
/** Exit's forget, as Task 7 will make it: of the code the store holds, which `forget` checks by identity. */
const forgetSaved = (fakes: FakePorts) => {
  const snapshot = fakes.ports.modeStore.getSnapshot();
  const saved = snapshot.status === 'ready' ? snapshot.saved.codes.matchday : undefined;
  if (saved === undefined) throw new Error('no day code saved');
  return act(async () => {
    expect(await fakes.ports.modeStore.forget(saved)).toBe(true);
  });
};
const dayCalls = (fakes: FakePorts) => fakes.matchDay.calls.filter((call) => call.op === 'day');
const firstCourt = (day: MatchDay | null) => day?.courts[0]?.courtName;

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('useMatchDay: the copy, then the server', () => {
  it('shows the last copy while the first read is out, then the server’s day, read now', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.hold() });
    expect(view.result.current.state).toBe('loading');
    expect(firstCourt(view.result.current.day)).toBe('Court A');
    expect(view.result.current.updatedAt).toEqual(COPIED_AT);
    view.matchDay.release();
    await settle();
    expect(view.result.current.state).toBe('ready');
    expect(firstCourt(view.result.current.day)).toBe('Court 1');
    expect(view.result.current.updatedAt).toEqual(TEST_NOW);
    expect(view.result.current.refusal).toBeNull();
  });

  it('asks the server only once the copy has been read, with the saved code (review M6)', async () => {
    let copyRead: () => void = () => undefined;
    const view = await mount({
      prepare: (fakes) => {
        const read = fakes.ports.matchDayStore.readCache;
        vi.spyOn(fakes.ports.matchDayStore, 'readCache').mockImplementation(
          (code) =>
            new Promise((resolve) => {
              copyRead = () => resolve(read(code));
            }),
        );
      },
    });
    await settle(MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toEqual([]);
    copyRead();
    await settle();
    expect(dayCalls(view)).toEqual([{ op: 'day', code: DAY_CODE }]);
  });

  it('keeps each good answer as the copy, tied to its code', async () => {
    const view = await mount();
    const store = view.ports.matchDayStore;
    expect(firstCourt((await store.readCache(DAY_CODE))?.day ?? null)).toBe('Court 1');
    expect((await store.readCache(DAY_CODE))?.at).toEqual(TEST_NOW);
  });

  it('a copy the phone refuses to write is recorded, and the list still shows the day', async () => {
    const view = await mount({ prepare: (fakes) => fakes.dayFiles.failNext('write') });
    expect(view.result.current.state).toBe('ready');
    expect(firstCourt(view.result.current.day)).toBe('Court 1');
    expect(readRecord(view.record).map((line) => line.event)).toContain('matchday.cache-refused');
  });

  it('with no copy, it is loading with no day until the server answers', async () => {
    const view = await mount({ copy: false, prepare: (fakes) => fakes.matchDay.hold() });
    expect(view.result.current).toMatchObject({ state: 'loading', day: null, updatedAt: null });
    view.matchDay.release();
    await settle();
    expect(view.result.current.state).toBe('ready');
  });
});

describe('useMatchDay: offline', () => {
  it('keeps the last copy and when it was read', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    expect(view.result.current.state).toBe('offline');
    expect(firstCourt(view.result.current.day)).toBe('Court A');
    expect(view.result.current.updatedAt).toEqual(COPIED_AT);
  });

  it('with no copy, is offline with no day (Task 3 re-review N3), and Retry asks again', async () => {
    const view = await mount({
      copy: false,
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    expect(view.result.current).toMatchObject({ state: 'offline', day: null, updatedAt: null });
    view.matchDay.answerDay({ ok: true, value: FAKE_DAY });
    act(() => view.result.current.refresh());
    await settle();
    expect(dayCalls(view)).toHaveLength(2);
    expect(view.result.current.state).toBe('ready');
  });

  it('a fresh day then a lost connection keeps that day, and says it was read then', async () => {
    const view = await mount();
    view.matchDay.answerDay({ ok: false, offline: true });
    await settle(MATCHDAY_POLL_MS);
    expect(view.result.current.state).toBe('offline');
    expect(firstCourt(view.result.current.day)).toBe('Court 1');
    expect(view.result.current.updatedAt).toEqual(TEST_NOW);
  });

  it.each([
    ['gone (a 404 NOT_FOUND)', { ok: false, gone: true } as const],
    ['a refusal that is not about the day', { ok: false, refusal: 'MD_OUT_OF_SCOPE' } as const],
  ])('reads %s as offline, and stays on the list', async (_what, answer) => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerDay(answer) });
    expect(view.result.current.state).toBe('offline');
    expect(view.navigation.history).not.toContain('home');
  });

  it('a port that throws is offline, and recorded without the token', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.throwNext() });
    expect(view.result.current.state).toBe('offline');
    const lines = view.record.lines().join('\n');
    expect(lines).toContain('port-threw');
    expect(lines).not.toContain(FIXTURE_DAY_TOKEN);
  });
});

describe('useMatchDay: polling (S4 design §5, every 15 s while on screen)', () => {
  it('polls at 15 s, not before', async () => {
    const view = await mount();
    expect(dayCalls(view)).toHaveLength(1);
    await settle(MATCHDAY_POLL_MS - 1);
    expect(dayCalls(view)).toHaveLength(1);
    await settle(1);
    expect(dayCalls(view)).toHaveLength(2);
    await settle(MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(3);
  });

  it('refreshes asked while one is in flight ask nothing at once; ONE trailing read follows it, and the next refresh after that asks again', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.hold() });
    act(() => view.result.current.refresh());
    act(() => view.result.current.refresh());
    act(() => view.result.current.refresh());
    expect(dayCalls(view)).toHaveLength(1);
    view.matchDay.release();
    await settle();
    expect(dayCalls(view)).toHaveLength(2);
    await settle();
    expect(dayCalls(view)).toHaveLength(2);
    act(() => view.result.current.refresh());
    await settle();
    expect(dayCalls(view)).toHaveLength(3);
  });

  it('a call that lands while a poll is out: a trailing read follows and the list ends on the day as it is now', async () => {
    const view = await mount();
    // Reads take their answer when asked: the poll's is the day as it was, the trailing read's the day after the call.
    view.matchDay.answerDay(
      {
        ok: true,
        value: {
          ...FAKE_DAY,
          courts: FAKE_DAY.courts.map((c, at) => (at === 0 ? { ...c, courtName: 'Court Z' } : c)),
        },
      },
      { ok: true, value: { ...FAKE_DAY, courts: COPY.courts } },
    );
    view.matchDay.hold();
    await settle(MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(2);
    act(() => view.result.current.refresh());
    expect(dayCalls(view)).toHaveLength(2);
    view.matchDay.release();
    await settle();
    expect(dayCalls(view)).toHaveLength(3);
    expect(firstCourt(view.result.current.day)).toBe('Court A');
  });

  it('a poll that comes due while the last read is still out asks nothing more', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.hold() });
    await settle(3 * MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(1);
  });

  it('stops in the background, asks at once on the way back, then every 15 s again', async () => {
    const view = await mount();
    act(() => view.foreground.leave());
    await settle(4 * MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(1);
    act(() => view.foreground.fire());
    await settle();
    expect(dayCalls(view)).toHaveLength(2);
    await settle(MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(3);
  });

  it('mounted while the app is in the background, it asks nothing until the app comes back', async () => {
    const view = await mount({ prepare: (fakes) => fakes.foreground.leave() });
    await settle(2 * MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(0);
    expect(firstCourt(view.result.current.day)).toBe('Court A');
    act(() => view.foreground.fire());
    await settle();
    expect(dayCalls(view)).toHaveLength(1);
  });

  it('stops when the list goes, and leaves no listener behind', async () => {
    const view = await mount();
    view.unmount();
    await settle(3 * MATCHDAY_POLL_MS);
    expect(dayCalls(view)).toHaveLength(1);
    expect(view.foreground.returnListeners()).toBe(0);
    expect(view.foreground.leaveListeners()).toBe(0);
  });
});

describe('useMatchDay: a read that rejects (review M3)', () => {
  it('reads as offline, is recorded, keeps the copy, and the next read still goes', async () => {
    const view = await mount({
      prepare: (fakes) => {
        vi.spyOn(fakes.ports.matchDayStore, 'opened').mockRejectedValueOnce(new Error('disk'));
      },
    });
    expect(view.result.current.state).toBe('offline');
    expect(firstCourt(view.result.current.day)).toBe('Court A');
    expect(view.result.current.reading).toBe(false);
    expect(readRecord(view.record).map((line) => line.event)).toContain('matchday.read-failed');
    act(() => view.result.current.refresh());
    await settle();
    expect(view.result.current.state).toBe('ready');
    await settle(MATCHDAY_POLL_MS);
    expect(dayCalls(view).length).toBeGreaterThanOrEqual(2);
  });

  it('a move Home that throws is recorded, never left unhandled', async () => {
    const opensAt = new Date('2026-10-04T07:00:00.000Z');
    const view = await mount({
      prepare: (fakes) => {
        fakes.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt });
        vi.spyOn(fakes.ports.navigation, 'go').mockImplementation(() => {
          throw new Error('router');
        });
      },
    });
    expect(view.result.current.state).toBe('refused');
    expect(readRecord(view.record).map((line) => line.event)).toContain('matchday.leave-failed');
  });
});

describe('useMatchDay: reading (review M4)', () => {
  it('is reading while a read is out, and not once it lands', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.hold() });
    expect(view.result.current.reading).toBe(true);
    view.matchDay.release();
    await settle();
    expect(view.result.current.reading).toBe(false);
    act(() => view.result.current.refresh());
    expect(view.result.current.reading).toBe(true);
    await settle();
    expect(view.result.current.reading).toBe(false);
  });
});

describe('useMatchDay: a late answer (Review Focus 5)', () => {
  it('an answer after unmount is dropped: no copy is written', async () => {
    const view = await mount({ copy: false, prepare: (fakes) => fakes.matchDay.hold() });
    view.unmount();
    view.matchDay.release();
    await settle();
    expect(view.dayFiles.written).toEqual([]);
    expect(view.navigation.history).toEqual(['matchday']);
  });

  it('an answer after Exit (the code forgotten) is dropped: no list, no copy', async () => {
    const view = await mount({ copy: false, prepare: (fakes) => fakes.matchDay.hold() });
    await forgetSaved(view);
    view.matchDay.release();
    await settle();
    expect(view.result.current.day).toBeNull();
    expect(view.result.current.state).toBe('loading');
    expect(view.dayFiles.written).toEqual([]);
  });

  it('a read that rejects after Exit changes nothing: no Offline (review M3)', async () => {
    let fail: (why: Error) => void = () => undefined;
    const view = await mount({
      copy: false,
      prepare: (fakes) => {
        vi.spyOn(fakes.ports.matchDayStore, 'opened').mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              fail = reject;
            }),
        );
      },
    });
    await forgetSaved(view);
    fail(new Error('disk'));
    await settle();
    expect(view.result.current.state).toBe('loading');
    expect(view.result.current.reading).toBe(false);
  });

  it('a withdrawn answer after Exit forgets nothing more and leaves no news', async () => {
    const view = await mount({
      prepare: (fakes) => {
        fakes.matchDay.hold();
        fakes.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' });
      },
    });
    await forgetSaved(view);
    view.matchDay.release();
    await settle();
    expect(view.ports.homeNews.peek()).toBeNull();
    expect(view.result.current.state).toBe('loading');
  });
});

describe('useMatchDay: the code’s end (S4 design §4)', () => {
  it.each([
    ['MD_WITHDRAWN', 'matchday.withdrawn'],
    ['MD_ENDED', 'matchday.ended'],
    ['MD_UNKNOWN', 'matchday.unknown'],
  ] as const)(
    '%s forgets the code and its copy, leaves %s for Home, and goes Home',
    async (refusal, line) => {
      const view = await mount({
        kv: { [MATCHDAY_KEYS.opened]: JSON.stringify(['m-1']) },
        prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, refusal }),
      });
      expect(view.result.current).toMatchObject({ state: 'refused', refusal });
      expect(view.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
      expect(view.dayFiles.files.size).toBe(0);
      // The opened matches' links outlive the code (S4 design §4): their list stays.
      expect(view.kv.entries.get(MATCHDAY_KEYS.opened)).toBe(JSON.stringify(['m-1']));
      expect(view.ports.homeNews.peek()).toBe(line);
      expect(view.navigation.current()).toBe('home');
    },
  );

  it('MD_NOT_OPEN keeps the code and its copy, and tells Home when the day opens', async () => {
    const opensAt = new Date('2026-10-04T07:00:00.000Z');
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt }),
    });
    expect(view.result.current).toMatchObject({ state: 'refused', refusal: 'MD_NOT_OPEN' });
    expect(view.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(true);
    expect(view.dayFiles.files.size).toBeGreaterThan(0);
    expect(view.ports.homeNews.peek()).toEqual({ key: 'matchday.opens', at: opensAt });
    expect(view.navigation.current()).toBe('home');
  });

  it('a forget the phone refuses says so on Home, keeps the copy, and records it', async () => {
    const seed = {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    };
    const view = await mount({
      ports: { modeStore: refusingStore(seed, (key) => key === STORE_KEYS.code('matchday')) },
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' }),
    });
    expect(view.ports.homeNews.peek()).toBe('store.saveFailed');
    expect(view.dayFiles.files.size).toBeGreaterThan(0);
    expect(readRecord(view.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'forget' } }),
    );
    expect(view.navigation.current()).toBe('home');
  });
});

describe('forgetWithCopy: a code that is over goes with its copy (S4 design §4)', () => {
  async function held() {
    const fakes = createFakePorts({
      kvSeed: { [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY) },
      dayFilesSeed: await copyFiles(),
    });
    await fakes.ports.modeStore.load();
    const snapshot = fakes.ports.modeStore.getSnapshot();
    const saved = snapshot.status === 'ready' ? snapshot.saved.codes.matchday : undefined;
    if (saved === undefined) throw new Error('no day code saved');
    return { fakes, saved };
  }

  it('forgets the code the store holds, and clears the copy', async () => {
    const { fakes, saved } = await held();
    await forgetWithCopy(fakes.ports, saved);
    expect(fakes.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(fakes.dayFiles.files.size).toBe(0);
  });

  it('a code the store no longer holds (another scanned since) is not forgotten, and the copy stays', async () => {
    const { fakes, saved } = await held();
    await forgetWithCopy(fakes.ports, { ...saved });
    expect(fakes.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(true);
    expect(fakes.dayFiles.files.size).toBeGreaterThan(0);
  });
});

describe('useMatchDay: no day code to list', () => {
  it('goes Home when no day code is saved, and asks nothing', async () => {
    const view = await mount({ saved: null });
    expect(view.navigation.history).toEqual(['matchday', 'home']);
    expect(view.matchDay.calls).toEqual([]);
  });

  it('goes Home when the saved code is not one this build can address', async () => {
    const view = await mount({ saved: { ...SAVED_DAY, raw: dayLink('evil.example') } });
    expect(view.navigation.history).toEqual(['matchday', 'home']);
    expect(view.matchDay.calls).toEqual([]);
  });

  it('waits for the store: mounted before it has loaded, it goes nowhere, then lists the day', async () => {
    const fakes = createFakePorts({
      kvSeed: {
        [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
        [STORE_KEYS.active]: 'matchday',
      },
    });
    fakes.navigation.go('matchday');
    const view = renderHook(() => useMatchDay(), { wrapper: wrapperFor(fakes) });
    await settle();
    expect(fakes.navigation.history).toEqual(['matchday']);
    expect(fakes.matchDay.calls).toEqual([]);
    await act(() => fakes.ports.modeStore.load());
    await settle();
    expect(fakes.navigation.history).toEqual(['matchday']);
    expect(view.result.current.state).toBe('ready');
  });

  it('stays while the code is saved', async () => {
    const view = await mount();
    expect(view.navigation.history).toEqual(['matchday']);
  });
});

describe('useMatchDay: the taps still sending (S4 design §5 "Sending N")', () => {
  it('reads the unsent taps of each match opened from Match Day, with each read of the day', async () => {
    const view = await mount({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify(['m-1', 'm-2', 'm-3']) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding('m-1', 3));
        await fakes.tapQueue.save(queueHolding('m-2', 0));
        await fakes.tapQueue.save(queueHolding('other', 4));
      },
    });
    expect(Object.fromEntries(view.result.current.unsent)).toEqual({ 'm-1': 3 });
    await act(() => view.tapQueue.save(queueHolding('m-1', 1)));
    await settle(MATCHDAY_POLL_MS);
    expect(Object.fromEntries(view.result.current.unsent)).toEqual({ 'm-1': 1 });
  });

  it('with no match opened from Match Day, never reads the tap queues', async () => {
    const view = await mount();
    await settle(MATCHDAY_POLL_MS);
    expect(view.queueFiles.ops.filter((op) => op.startsWith('names'))).toEqual([]);
    expect(view.result.current.unsent.size).toBe(0);
  });

  it('a queue it cannot read is null, its taps at risk (review I1), and the others still count', async () => {
    const view = await mount({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify(['m-1', 'm-2', 'm-3']) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding('m-1', 3));
        fakes.queueFiles.files.set('m-2.json', '{garbled');
        // Not opened from Match Day: Home's card speaks for it, the list does not.
        fakes.queueFiles.files.set('other.json', '{garbled');
      },
    });
    expect(Object.fromEntries(view.result.current.unsent)).toEqual({ 'm-1': 3, 'm-2': null });
  });

  it('a listing the phone refuses counts none, and the day still shows', async () => {
    const view = await mount({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify(['m-1']) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding('m-1', 3));
        fakes.queueFiles.failNext('names');
      },
    });
    expect(view.result.current.unsent.size).toBe(0);
    expect(view.result.current.state).toBe('ready');
    await settle(MATCHDAY_POLL_MS);
    expect(Object.fromEntries(view.result.current.unsent)).toEqual({ 'm-1': 3 });
  });

  it('reads them offline too: that is when taps wait', async () => {
    const view = await mount({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify(['m-1']) },
      prepare: async (fakes) => {
        fakes.matchDay.answerDay({ ok: false, offline: true });
        await fakes.tapQueue.save(queueHolding('m-1', 2));
      },
    });
    expect(Object.fromEntries(view.result.current.unsent)).toEqual({ 'm-1': 2 });
  });
});
