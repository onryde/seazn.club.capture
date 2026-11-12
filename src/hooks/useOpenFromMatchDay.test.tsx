import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { useMatchDayExit } from '@/hooks/useMatchDayExit';
import { useOpenFromMatchDay, type OpenSink } from '@/hooks/useOpenFromMatchDay';
import { FAKE_DAY, FAKE_OPEN_URL } from '@/services/fakeMatchDayPort';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createMatchDayStore } from '@/services/matchDayStore';
import { createRingRecord } from '@/services/sessionRecord';
import { createMemoryQueueFiles } from '../../test/memoryQueueFiles';
import { STORE_KEYS } from '@/services/modeStore';
import { readScoringLink, scoringLinkKey } from '@/services/scoringLinkStore';
import { scoringHubOf } from '@/hooks/scoringHub';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../test/fakePorts';
import { dayLink } from '../../test/fixtures/dayCode';
import { wrapperFor } from '../../test/renderWithPorts';

// MD-2 Task 5: a tap on a Match Day row (S4 design §6), over the fake Match Day port with the real stores. The four
// questions: a second tap while one is out, no day code, the app killed mid-open (a refused write), and another
// answer (a finished match, offline, a refusal).

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const NOW_ROW = FAKE_DAY.courts[0]?.now as Row;
const NEXT_ROW = FAKE_DAY.courts[0]?.next[0] as Row;
const HOST = 'stg.seazn.club';
/** The secret of the fake's link: the last path segment of `FAKE_OPEN_URL`. Compared against, never printed. */
const SECRET = FAKE_OPEN_URL.slice(FAKE_OPEN_URL.lastIndexOf('/') + 1);

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

type Sink = OpenSink & { readonly lines: (string | null)[]; refreshed: number };

async function mount(over: { kv?: KeyValueStore; saved?: boolean | 'foreign' } = {}) {
  const seed =
    over.saved === false
      ? { [STORE_KEYS.active]: 'matchday' }
      : {
          [STORE_KEYS.code('matchday')]: encodeSavedCode(
            over.saved === 'foreign'
              ? { ...SAVED_DAY, raw: dayLink('elsewhere.example') }
              : SAVED_DAY,
          ),
          [STORE_KEYS.active]: 'matchday',
        };
  // `kv` is the secure store the link store and Match Day's store see; the mode store keeps its own, seeded.
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const wiring =
    over.kv === undefined
      ? {}
      : {
          kv: over.kv,
          matchDayStore: createMatchDayStore({
            kv: over.kv,
            files: createMemoryQueueFiles(),
            logger,
          }),
        };
  const fakes = createFakePorts({ kvSeed: seed, ...wiring });
  await fakes.ports.modeStore.load();
  fakes.navigation.go('matchday');
  const sink: Sink = {
    lines: [],
    refreshed: 0,
    say: (line) => void sink.lines.push(line),
    refresh: () => void (sink.refreshed += 1),
  };
  const view = renderHook(() => useOpenFromMatchDay(sink), { wrapper: wrapperFor(fakes) });
  return { ...fakes, sink, open: view.result.current };
}

const tap = async (open: (row: Row, court: string) => Promise<void>, row = NOW_ROW) => {
  await act(() => open(row, 'Court 1'));
};

const stored = (fakes: FakePorts, id: string) => readScoringLink(fakes.ports.kv, id, HOST);

describe('opening a match from its row', () => {
  it('keeps the match’s link, notes it as opened and open, and goes to the pad: the mode stays Match Day', async () => {
    const m = await mount();
    const calls = vi.spyOn(m.navigation, 'go');
    await tap(m.open);
    const link = await stored(m, NOW_ROW.fixtureId);
    expect(link).toMatchObject({ kind: 'link', sportKey: 'badminton' });
    expect(link.kind === 'link' ? link.link.origin : '').toBe(`https://${HOST}`);
    expect(await m.ports.matchDayStore.opened()).toEqual([NOW_ROW.fixtureId]);
    expect(m.ports.matchDayStore.openMatch()).toEqual({
      fixtureId: NOW_ROW.fixtureId,
      courtName: 'Court 1',
    });
    expect(calls).toHaveBeenCalledWith('scoring');
    const snapshot = m.ports.modeStore.getSnapshot();
    expect(snapshot.status === 'ready' ? snapshot.saved.active : null).toBe('matchday');
  });

  it('the match’s secret is only where a scan’s is, in the scoring link store: no other key, no record line', async () => {
    const m = await mount();
    await tap(m.open);
    const holders = [...m.kv.entries].filter(([, value]) => value.includes(SECRET));
    expect(holders.map(([key]) => key)).toEqual([scoringLinkKey(NOW_ROW.fixtureId)]);
    expect(JSON.stringify(readRecord(m.record))).not.toContain(SECRET);
  });

  it('saves no scoring code: a scan’s saved match is not replaced or made', async () => {
    const m = await mount();
    await tap(m.open);
    const snapshot = m.ports.modeStore.getSnapshot();
    expect(snapshot.status === 'ready' ? snapshot.saved.codes.scoring : 'unready').toBeUndefined();
  });

  it('a link on a host that is not this build’s is never kept: Offline, nothing noted, the pad does not open', async () => {
    const m = await mount();
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({
      ok: true,
      value: {
        kind: 'link',
        url: `https://elsewhere.example/score/${SECRET}`,
        sportKey: 'badminton',
      },
    });
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'matchday.cantOpen']);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    expect(readRecord(m.record).map((line) => line.event)).toContain('matchday.open-foreign-link');
  });

  it('a day code’s link is no match’s link: it is never kept as a scoring link', async () => {
    const m = await mount();
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({
      ok: true,
      value: { kind: 'link', url: dayLink(), sportKey: 'badminton' },
    });
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'matchday.cantOpen']);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
  });

  it('a saved day code this build cannot address says so, and asks nothing', async () => {
    const m = await mount({ saved: 'foreign' });
    await tap(m.open);
    expect(m.matchDay.calls).toEqual([]);
    expect(m.sink.lines).toEqual([null, 'matchday.cantOpen']);
  });

  it('the claim that guards the link while it is written is let go: once Match Day lets the match go, a sweep takes it', async () => {
    const m = await mount();
    await tap(m.open);
    await m.ports.matchDayStore.removeOpened(NOW_ROW.fixtureId);
    await m.ports.tapQueue.save({
      fixtureId: NOW_ROW.fixtureId,
      label: 'Match 4',
      pending: [],
      ownEventIds: [],
      dead: null,
    });
    await scoringHubOf(m.ports).resume();
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
  });

  it('asks the server with the saved day code and the row’s fixture', async () => {
    const m = await mount();
    await tap(m.open, NEXT_ROW);
    expect(m.matchDay.calls.filter((call) => call.op === 'open')).toMatchObject([
      { fixtureId: NEXT_ROW.fixtureId, code: { origin: `https://${HOST}` } },
    ]);
  });

  it('a second tap while one is out is ignored: one ask, one open, and a later tap works', async () => {
    const m = await mount();
    m.matchDay.hold();
    const first = m.open(NOW_ROW, 'Court 1');
    const second = m.open(NEXT_ROW, 'Court 1');
    await act(async () => {
      m.matchDay.release();
      await Promise.all([first, second]);
    });
    expect(m.matchDay.calls.filter((call) => call.op === 'open')).toHaveLength(1);
    expect(m.ports.matchDayStore.openMatch()?.fixtureId).toBe(NOW_ROW.fixtureId);
    await tap(m.open, NEXT_ROW);
    expect(m.matchDay.calls.filter((call) => call.op === 'open')).toHaveLength(2);
  });

  it('with no day code saved nothing is asked and nothing opens', async () => {
    const m = await mount({ saved: false });
    const calls = vi.spyOn(m.navigation, 'go');
    await tap(m.open);
    expect(m.matchDay.calls).toEqual([]);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect(m.sink.lines).toEqual([null, 'matchday.cantOpen']);
    expect(readRecord(m.record).map((line) => line.event)).toContain('matchday.open-no-code');
  });

  it('clears the last line as a new tap starts', async () => {
    const m = await mount();
    await tap(m.open);
    expect(m.sink.lines[0]).toBeNull();
  });
});

describe('a refusal, a gone match and a port that fails', () => {
  it('MD_OUT_OF_SCOPE says "This match isn’t on your courts" and does not navigate, keep or note anything', async () => {
    const m = await mount();
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: true, value: { kind: 'refused', code: 'MD_OUT_OF_SCOPE' } });
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'matchday.outOfScope']);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    expect(m.ports.matchDayStore.openMatch()).toBeUndefined();
  });

  it.each(['MD_ENDED', 'MD_WITHDRAWN', 'MD_UNKNOWN', 'MD_NOT_OPEN'] as const)(
    'the code’s own refusal %s reads the day again and says nothing',
    async (refusal) => {
      const m = await mount();
      const calls = vi.spyOn(m.navigation, 'go');
      m.matchDay.answerOpen({ ok: false, refusal });
      await tap(m.open);
      expect(m.sink.refreshed).toBe(1);
      expect(m.sink.lines).toEqual([null]);
      expect(calls).not.toHaveBeenCalledWith('scoring');
    },
  );

  it('a match that is gone reads the day again', async () => {
    const m = await mount();
    m.matchDay.answerOpen({ ok: false, gone: true });
    await tap(m.open);
    expect(m.sink.refreshed).toBe(1);
    expect(m.sink.lines).toEqual([null]);
  });

  it('a port that throws is recorded, says the open failed, and the next tap goes through', async () => {
    const m = await mount();
    m.matchDay.throwNext();
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'matchday.offlineEmpty']);
    expect(readRecord(m.record).map((line) => line.event)).toContain('matchday.open-threw');
    await tap(m.open);
    expect(m.ports.matchDayStore.openMatch()?.fixtureId).toBe(NOW_ROW.fixtureId);
  });
});

describe('offline, and a match already held on this phone', () => {
  const held = async (m: Awaited<ReturnType<typeof mount>>) => {
    await m.ports.kv.set(
      scoringLinkKey(NOW_ROW.fixtureId),
      JSON.stringify({
        origin: `https://${HOST}`,
        token: 'dl_madeUpTokenForOpenTests01',
        sportKey: 'badminton',
      }),
    );
  };

  it('offline with a stored link opens it, without asking for another', async () => {
    const m = await mount();
    await held(m);
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: false, offline: true });
    await tap(m.open);
    expect(calls).toHaveBeenCalledWith('scoring');
    expect(m.ports.matchDayStore.openMatch()?.fixtureId).toBe(NOW_ROW.fixtureId);
    expect(await m.ports.matchDayStore.opened()).toEqual([NOW_ROW.fixtureId]);
    expect(m.sink.lines).toEqual([null]);
  });

  it('offline without one says "Offline" and does not navigate', async () => {
    const m = await mount();
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: false, offline: true });
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'matchday.offlineEmpty']);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect(m.ports.matchDayStore.openMatch()).toBeUndefined();
  });

  it('a store that will not answer is no link: Offline, not a pad with nothing behind it', async () => {
    const memory = createMemoryKeyValueStore({
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    });
    const kv: KeyValueStore = {
      get: async (key) => {
        if (key.startsWith('scoring.link.')) throw new Error('locked');
        return memory.get(key);
      },
      set: memory.set,
      delete: memory.delete,
    };
    const m = await mount({ kv });
    m.matchDay.answerOpen({ ok: false, offline: true });
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'matchday.offlineEmpty']);
  });

  it('a finished match opens view-only from the link already held', async () => {
    const m = await mount();
    await held(m);
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: true, value: { kind: 'finished' } });
    await tap(m.open);
    expect(calls).toHaveBeenCalledWith('scoring');
    expect(m.ports.matchDayStore.openMatch()?.fixtureId).toBe(NOW_ROW.fixtureId);
  });

  it('a finished match with no link held has nothing to open: it is recorded, never silent', async () => {
    const m = await mount();
    const calls = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: true, value: { kind: 'finished' } });
    await tap(m.open);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect(readRecord(m.record).map((line) => line.event)).toContain(
      'matchday.open-finished-no-link',
    );
  });
});

describe('a write the phone refuses', () => {
  /** A secure store that refuses `matchday.open`, as a full disk or a locked keystore would. */
  const refusing = (key: string): KeyValueStore => {
    const memory = createMemoryKeyValueStore({
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    });
    return {
      get: memory.get,
      delete: memory.delete,
      set: async (k, value) => {
        if (k === key) throw new Error('keystore refused');
        await memory.set(k, value);
      },
    };
  };

  it('a refused "open" write takes the fresh link back, says so, and does not navigate', async () => {
    const m = await mount({ kv: refusing('matchday.open') });
    const calls = vi.spyOn(m.navigation, 'go');
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'store.saveFailed']);
    expect(calls).not.toHaveBeenCalledWith('scoring');
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
    expect(m.ports.matchDayStore.openMatch()).toBeUndefined();
  });

  it('a refused link write opens nothing and notes nothing', async () => {
    const m = await mount({ kv: refusing(scoringLinkKey(NOW_ROW.fixtureId)) });
    await tap(m.open);
    expect(m.sink.lines).toEqual([null, 'store.saveFailed']);
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
  });

  it('the failed tap leaves the guard down: the next tap asks again', async () => {
    const m = await mount({ kv: refusing('matchday.open') });
    await tap(m.open);
    await tap(m.open);
    expect(m.matchDay.calls.filter((call) => call.op === 'open')).toHaveLength(2);
  });
});

// Final review M1: Exit while an open is in flight (a slow network: up to 8 s) cancels it. The late answer writes
// nothing (no link, no opened, no open match, no `matchday.open` line) and never navigates, wherever in the open the
// Exit lands: before the answer, while the link is written, or while Match Day notes the match.
describe('Exit cancels an open still in flight (final review M1)', () => {
  const exitOf = (m: Awaited<ReturnType<typeof mount>>) =>
    renderHook(() => useMatchDayExit(), { wrapper: wrapperFor(m) }).result;
  const nothingWritten = async (
    m: Awaited<ReturnType<typeof mount>>,
    go: ReturnType<typeof vi.spyOn>,
  ) => {
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    expect(m.kv.entries.has('matchday.open')).toBe(false);
    expect(m.ports.matchDayStore.openMatch() ?? null).toBeNull();
    expect(readRecord(m.record).some((l) => l.event === 'matchday.open')).toBe(false);
    expect(go).not.toHaveBeenCalledWith('scoring');
    expect(m.navigation.current()).toBe('home');
  };

  it('a link answered after Exit is never kept, noted or opened', async () => {
    const m = await mount();
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    const set = vi.spyOn(m.kv, 'set');
    m.matchDay.hold();
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(() => exit.current.exit());
    m.matchDay.release();
    await act(() => opening);
    await nothingWritten(m, go);
    expect(m.sink.lines).toEqual([null]);
    // Cancelled as the answer lands: the link is never even written.
    expect(set).not.toHaveBeenCalledWith(scoringLinkKey(NOW_ROW.fixtureId), expect.anything());
  });

  it('an offline answer after Exit never opens the link already held', async () => {
    const m = await mount();
    await m.ports.kv.set(
      scoringLinkKey(NOW_ROW.fixtureId),
      JSON.stringify({
        origin: `https://${HOST}`,
        token: 'dl_madeUpTokenForOpenTests01',
        sportKey: 'badminton',
      }),
    );
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: false, offline: true });
    m.matchDay.hold();
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(() => exit.current.exit());
    m.matchDay.release();
    await act(() => opening);
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    expect(m.ports.matchDayStore.openMatch() ?? null).toBeNull();
    expect(go).not.toHaveBeenCalledWith('scoring');
    expect(readRecord(m.record).some((l) => l.event === 'matchday.open')).toBe(false);
  });

  it('Exit while the link is being written: the link is taken back, and nothing opens', async () => {
    const m = await mount();
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    const real = m.kv.set.bind(m.kv);
    let land = (): void => undefined;
    vi.spyOn(m.kv, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === scoringLinkKey(NOW_ROW.fixtureId))
        await new Promise<void>((resolve) => {
          land = resolve;
        });
      return real(key, value);
    });
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(async () => {
      for (let i = 0; i < 50; i += 1) await Promise.resolve();
    });
    await act(() => exit.current.exit());
    land();
    await act(() => opening);
    await nothingWritten(m, go);
    // Cancelled before Match Day noted it: the note is never even written.
    expect(m.kv.set).not.toHaveBeenCalledWith('matchday.opened', expect.anything());
  });

  it('Exit while Match Day notes the match: the link and the open match are taken back, and the hub lets the match go', async () => {
    const m = await mount();
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    const real = m.kv.set.bind(m.kv);
    let land = (): void => undefined;
    vi.spyOn(m.kv, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === 'matchday.open')
        await new Promise<void>((resolve) => {
          land = resolve;
        });
      return real(key, value);
    });
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(async () => {
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
    });
    let left: Promise<void> = Promise.resolve();
    act(() => {
      left = exit.current.exit();
    });
    land();
    await act(() => Promise.all([opening, left]));
    // The note stays for the hub, which lets go of it with the day's other matches at the next resume.
    await act(() => scoringHubOf(m.ports).resume());
    await nothingWritten(m, go);
  });

  it('an open match written after Exit’s own clear of it is taken back by the open', async () => {
    const m = await mount();
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    // Exit's clear of the open match landed first: modelled as one that changes nothing.
    vi.spyOn(m.ports.matchDayStore, 'clearOpen').mockResolvedValueOnce(undefined);
    const real = m.kv.set.bind(m.kv);
    let land = (): void => undefined;
    vi.spyOn(m.kv, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === 'matchday.open')
        await new Promise<void>((resolve) => {
          land = resolve;
        });
      return real(key, value);
    });
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(async () => {
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
    });
    let left: Promise<void> = Promise.resolve();
    act(() => {
      left = exit.current.exit();
    });
    land();
    await act(() => Promise.all([opening, left]));
    await act(() => scoringHubOf(m.ports).resume());
    await nothingWritten(m, go);
  });

  it('Exit while a held link is read offline: nothing is noted and the pad does not open', async () => {
    const m = await mount();
    await m.ports.kv.set(
      scoringLinkKey(NOW_ROW.fixtureId),
      JSON.stringify({
        origin: `https://${HOST}`,
        token: 'dl_madeUpTokenForOpenTests01',
        sportKey: 'badminton',
      }),
    );
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    m.matchDay.answerOpen({ ok: false, offline: true });
    const realGet = m.kv.get.bind(m.kv);
    let land = (): void => undefined;
    let held = false;
    vi.spyOn(m.kv, 'get').mockImplementation(async (key: string) => {
      if (key === scoringLinkKey(NOW_ROW.fixtureId) && !held) {
        held = true;
        await new Promise<void>((resolve) => {
          land = resolve;
        });
      }
      return realGet(key);
    });
    const set = vi.spyOn(m.kv, 'set');
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(async () => {
      for (let i = 0; i < 50; i += 1) await Promise.resolve();
    });
    expect(held).toBe(true);
    await act(() => exit.current.exit());
    land();
    await act(() => opening);
    expect(set).not.toHaveBeenCalledWith('matchday.opened', expect.anything());
    expect(m.ports.matchDayStore.openMatch() ?? null).toBeNull();
    expect(go).not.toHaveBeenCalledWith('scoring');
    expect(readRecord(m.record).some((l) => l.event === 'matchday.open')).toBe(false);
  });

  it('Exit while a held link is noted offline: the open match is taken back, and the hub lets the match go', async () => {
    const m = await mount();
    await m.ports.kv.set(
      scoringLinkKey(NOW_ROW.fixtureId),
      JSON.stringify({
        origin: `https://${HOST}`,
        token: 'dl_madeUpTokenForOpenTests01',
        sportKey: 'badminton',
      }),
    );
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    // Exit's clear of the open match landed first: modelled as one that changes nothing.
    vi.spyOn(m.ports.matchDayStore, 'clearOpen').mockResolvedValueOnce(undefined);
    m.matchDay.answerOpen({ ok: false, offline: true });
    const real = m.kv.set.bind(m.kv);
    let land = (): void => undefined;
    vi.spyOn(m.kv, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === 'matchday.open')
        await new Promise<void>((resolve) => {
          land = resolve;
        });
      return real(key, value);
    });
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(async () => {
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
    });
    let left: Promise<void> = Promise.resolve();
    act(() => {
      left = exit.current.exit();
    });
    land();
    await act(() => Promise.all([opening, left]));
    await act(() => scoringHubOf(m.ports).resume());
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    expect(m.ports.matchDayStore.openMatch() ?? null).toBeNull();
    expect(go).not.toHaveBeenCalledWith('scoring');
    expect(readRecord(m.record).some((l) => l.event === 'matchday.open')).toBe(false);
  });

  it('a link already held, Exit passing while the open holds it: never left unnamed, the next resume lets it go', async () => {
    const m = await mount();
    await m.ports.kv.set(
      scoringLinkKey(NOW_ROW.fixtureId),
      JSON.stringify({
        origin: `https://${HOST}`,
        token: 'dl_madeUpTokenForOpenTests01',
        sportKey: 'badminton',
      }),
    );
    const exit = exitOf(m);
    const go = vi.spyOn(m.navigation, 'go');
    const real = m.kv.set.bind(m.kv);
    let land = (): void => undefined;
    vi.spyOn(m.kv, 'set').mockImplementation(async (key: string, value: string) => {
      if (key === 'matchday.open')
        await new Promise<void>((resolve) => {
          land = resolve;
        });
      return real(key, value);
    });
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(async () => {
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
    });
    let left: Promise<void> = Promise.resolve();
    act(() => {
      left = exit.current.exit();
    });
    // Exit's let-go passes while the open still claims the match, so it keeps the match on the list for a later pass.
    await act(async () => {
      for (let i = 0; i < 400; i += 1) await Promise.resolve();
    });
    land();
    await act(() => Promise.all([opening, left]));
    await act(() => scoringHubOf(m.ports).resume());
    expect((await stored(m, NOW_ROW.fixtureId)).kind).toBe('none');
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    expect(m.ports.matchDayStore.openMatch() ?? null).toBeNull();
    expect(go).not.toHaveBeenCalledWith('scoring');
  });

  it('an open started after a cancelled one goes through (Exit refused its forget: the day is still saved)', async () => {
    const m = await mount();
    const exit = exitOf(m);
    vi.spyOn(m.ports.modeStore, 'forget').mockRejectedValue(new Error('keystore refused'));
    m.matchDay.hold();
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = m.open(NOW_ROW, 'Court 1');
    });
    await act(() => exit.current.exit());
    m.matchDay.release();
    await act(() => opening);
    expect(await m.ports.matchDayStore.opened()).toEqual([]);
    const go = vi.spyOn(m.navigation, 'go');
    await tap(m.open);
    expect(go).toHaveBeenCalledWith('scoring');
    expect(await m.ports.matchDayStore.opened()).toEqual([NOW_ROW.fixtureId]);
  });
});
