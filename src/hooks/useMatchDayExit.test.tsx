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

/** The fake day with the fake singles match as Court 2's Now: the one fixture the fake server serves. */
const DAY: MatchDay = {
  ...FAKE_DAY,
  courts: [
    FAKE_DAY.courts[0] as MatchDay['courts'][number],
    {
      ...(FAKE_DAY.courts[1] as MatchDay['courts'][number]),
      state: 'playing',
      now: {
        ...(FAKE_DAY.courts[0]?.now as NonNullable<MatchDay['courts'][number]['now']>),
        fixtureId: FIXTURE,
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
      taps: 2,
      opened: [FIXTURE, OTHER],
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(OTHER, 0));
      },
    });
    await act(() => view.result.current.exit());
    expect([...(await view.ports.matchDayStore.sending())]).toEqual([[FIXTURE, 'Court 2']]);
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
