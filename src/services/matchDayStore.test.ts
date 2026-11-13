import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Approval, Court, MatchDay, Row } from '@/domain/matchday/matchDay';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import {
  MATCHDAY_CACHE_VERSION,
  MATCHDAY_DATE_KEYS,
  MATCHDAY_KEYS,
  createMatchDayStore,
} from '@/services/matchDayStore';
import { createRingRecord } from '@/services/sessionRecord';
import { readRecord } from '../../test/fakePorts';
import { FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';
import { createMemoryQueueFiles, type MemoryQueueFiles } from '../../test/memoryQueueFiles';

const CODE: SavedDayCode = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
/** Another code of the same shape: made up. */
const OTHER: SavedDayCode = {
  origin: 'https://stg.seazn.club',
  token: 'md_Other-Day_0123456789abcdefghijklmnopqrstuv',
};
/** The copy's file and its temp, as the controller's ruling names the pattern (write `.tmp`, then move). */
const COPY = 'day.json';
const TEMP = 'day.json.tmp';

const row = (fixtureId: string, scheduledAt: Date | null): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  roundTag: 'R2',
  home: 'Ng',
  away: null,
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  scheduledAt,
  summary: null,
});

/** A made-up day with a date in every place one can be: the code's two instants and a row's time, or none. */
const DAY: MatchDay = {
  competition: { id: '2f0c8a51-6b8e-4d37-9a51-0c1e2d3f4a5b', name: 'SAFE Open' },
  scope: { kind: 'venue', label: 'Hall A' },
  day: '2026-11-07',
  tz: 'Europe/London',
  opensAt: new Date('2026-11-07T00:00:00.000Z'),
  expiresAt: new Date('2026-11-08T00:00:00.000Z'),
  canApprove: true,
  canCall: false,
  courts: [
    {
      courtId: '0e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b',
      courtName: 'Court 1',
      venueName: 'Hall A',
      state: 'playing',
      now: { ...row('7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', null), status: 'inPlay' },
      next: [row('8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f', new Date('2026-11-07T10:40:00.000Z'))],
      finished: [row('9d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f7a', new Date('2026-11-07T09:00:00.000Z'))],
    },
  ],
  noCourt: [row('2a7b8c9d-0e1f-4a2b-ac3d-5e6f7a8b9c0d', new Date('2026-11-07T11:00:00.000Z'))],
  online: [row('3b8c9d0e-1f2a-4b3c-8d4e-6f7a8b9c0d1e', new Date('2026-11-07T12:00:00.000Z'))],
  approvals: [
    {
      kind: 'swiss',
      stageId: '3b8c9d0e-1f2a-4b3c-8d4e-6f7a8b9c0d1e',
      divisionName: 'Open',
      label: 'Swiss',
      round: 4,
      waiting: null,
    },
  ],
};
const LATER: MatchDay = { ...DAY, canApprove: false };
const AT = new Date('2026-11-07T10:42:00.000Z');

/** The store over an in-memory folder and key-value store, with the record it writes to. */
function storeOver(options: { files?: MemoryQueueFiles; kv?: KeyValueStore } = {}) {
  const files = options.files ?? createMemoryQueueFiles();
  const kv = options.kv ?? createMemoryKeyValueStore();
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  return { store: createMatchDayStore({ kv, files, logger }), files, record, kv };
}

describe('the day’s last good copy: a file of its own (`matchday/day.json`)', () => {
  it('reads back what was written, its Dates as Dates', async () => {
    const { store } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const cached = await store.readCache(CODE);
    expect(cached).toEqual({ day: DAY, at: AT });
    expect(cached?.day.courts[0]?.next[0]?.scheduledAt).toBeInstanceOf(Date);
    expect(cached?.day.courts[0]?.now?.scheduledAt).toBeNull();
  });

  // The controller's ruling: the secure store keeps the code; the copy is a file.
  it('keeps the parsed day in its file and nothing in the secure store, never the token or the wire’s own shape', async () => {
    const kv = createMemoryKeyValueStore();
    const { store, files } = storeOver({ kv });
    await store.writeCache(CODE, DAY, AT);
    expect([...files.files.keys()]).toEqual([COPY]);
    expect([...kv.entries.keys()]).toEqual([]);
    const stored = files.files.get(COPY) ?? '';
    expect(stored).not.toContain('md_');
    expect(stored).not.toContain('expires_at');
    expect(stored).not.toContain('"ok"');
  });

  // A kill mid-write never leaves half a file: the temp is written whole, then moved over the copy.
  it('writes the temp file, then moves it over the copy', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.ops.length = 0;
    await store.writeCache(CODE, LATER, AT);
    expect(files.ops).toEqual([`write ${TEMP}`, `move ${TEMP} ${COPY}`]);
  });

  // The copy belongs to the code that was answered with it: a new code never shows the last code's day.
  it('is no copy for another code', async () => {
    const { store } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    expect(await store.readCache(OTHER)).toBeNull();
  });

  it('a second write replaces the first', async () => {
    const { store } = storeOver();
    await store.writeCache(OTHER, DAY, AT);
    const later = new Date(AT.getTime() + 15_000);
    await store.writeCache(CODE, LATER, later);
    expect(await store.readCache(OTHER)).toBeNull();
    expect(await store.readCache(CODE)).toEqual({ day: LATER, at: later });
  });

  it('nothing written is no copy, and a cleared copy is none, its temp file with it', async () => {
    const { store, files } = storeOver();
    expect(await store.readCache(CODE)).toBeNull();
    await store.writeCache(CODE, DAY, AT);
    files.files.set(TEMP, files.files.get(COPY) ?? '');
    await store.clearCache();
    expect(await store.readCache(CODE)).toBeNull();
    expect(files.files.size).toBe(0);
  });

  it.each([
    ['not JSON', 'nope'],
    ['another version', JSON.stringify({ v: 2, tag: 'x', at: 0, day: {} })],
    ['no day', JSON.stringify({ v: 1, tag: 'x', at: 0 })],
  ])('a stored copy that is %s is no copy', async (_, text) => {
    const files = createMemoryQueueFiles();
    files.files.set(COPY, text);
    expect(await storeOver({ files }).store.readCache(CODE)).toBeNull();
  });

  // Review M4: a copy another version wrote is none, however whole: its shape may not be this one.
  it('a whole copy written by another version is no copy', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const good = files.files.get(COPY) ?? '';
    expect(good.startsWith('{"v":1,')).toBe(true);
    files.files.set(COPY, good.replace('{"v":1,', '{"v":2,'));
    expect(await store.readCache(CODE)).toBeNull();
  });

  it('a stored copy with a date that is no date, a list that is none, or a time that is none is no copy', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const good = files.files.get(COPY) ?? '';
    for (const broken of [
      good.replace('2026-11-08T00:00:00.000Z', 'soon'),
      good.replace('"courts":[', '"courts":"none","x":['),
      good.replace(/"at":\d+/, '"at":"now"'),
    ]) {
      files.files.set(COPY, broken);
      expect(await store.readCache(CODE)).toBeNull();
    }
  });

  it('a read the disk refuses is no copy, never a rejection, and is recorded', async () => {
    const { store, files, record } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.failNext('read');
    expect(await store.readCache(CODE)).toBeNull();
    expect(readRecord(record)).toContainEqual(
      expect.objectContaining({ event: 'matchday.cache-unreadable', fields: { problem: 'read' } }),
    );
    expect(await store.readCache(CODE)).toEqual({ day: DAY, at: AT });
  });

  // Question 3: Android's move deletes the copy, then renames the temp over it. A kill between leaves the temp alone.
  it('a write cut inside its move leaves the temp file, which the next read takes and promotes', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.failNext('moveAfterDelete');
    await expect(store.writeCache(CODE, LATER, AT)).rejects.toThrow();
    expect([...files.files.keys()]).toEqual([TEMP]);
    expect(await store.readCache(CODE)).toEqual({ day: LATER, at: AT });
    expect([...files.files.keys()]).toEqual([COPY]);
  });

  it('a write cut before its move leaves the copy whole: the copy, not the temp, is the answer', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.failNext('move');
    await expect(store.writeCache(CODE, LATER, AT)).rejects.toThrow();
    expect(await store.readCache(CODE)).toEqual({ day: DAY, at: AT });
  });

  it('a garbled copy beside a temp that reads: the temp is the answer, and is promoted', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.files.set(TEMP, files.files.get(COPY) ?? '');
    files.files.set(COPY, 'garbled');
    expect(await store.readCache(CODE)).toEqual({ day: DAY, at: AT });
    expect(files.files.has(TEMP)).toBe(false);
  });

  it('a garbled copy with no temp is none, and is recorded', async () => {
    const { store, files, record } = storeOver();
    files.files.set(COPY, 'garbled');
    expect(await store.readCache(CODE)).toBeNull();
    expect(readRecord(record)).toContainEqual(
      expect.objectContaining({
        event: 'matchday.cache-unreadable',
        fields: { problem: 'garbled' },
      }),
    );
  });

  it('a promotion the disk refuses still answers the temp, and is recorded', async () => {
    const { store, files, record } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.files.set(TEMP, files.files.get(COPY) ?? '');
    files.files.delete(COPY);
    files.failNext('move');
    expect(await store.readCache(CODE)).toEqual({ day: DAY, at: AT });
    expect(readRecord(record)).toContainEqual(
      expect.objectContaining({
        event: 'matchday.cache-unreadable',
        fields: { problem: 'promote' },
      }),
    );
  });

  it('a refused write rejects its own caller and never blocks the next', async () => {
    const { store, files } = storeOver();
    files.failNext('write');
    await expect(store.writeCache(CODE, DAY, AT)).rejects.toThrow('refused');
    await store.writeCache(CODE, LATER, AT);
    expect(await store.readCache(CODE)).toEqual({ day: LATER, at: AT });
  });

  it('a refused clear rejects its own caller', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    files.failNext('remove');
    await expect(store.clearCache()).rejects.toThrow('refused');
  });

  // Question 1: a write and a clear asked together land in the order asked, each whole.
  it('a write and a clear at once land in the order asked', async () => {
    const first = storeOver();
    await Promise.all([first.store.writeCache(CODE, DAY, AT), first.store.clearCache()]);
    expect(await first.store.readCache(CODE)).toBeNull();
    expect(first.files.files.size).toBe(0);
    const second = storeOver();
    await Promise.all([second.store.clearCache(), second.store.writeCache(CODE, DAY, AT)]);
    expect(await second.store.readCache(CODE)).toEqual({ day: DAY, at: AT });
  });

  // A read can promote a temp file, so it waits its turn: it never takes a write's temp file from under the write.
  it('a read asked while a write is writing waits for it, and reads what it wrote', async () => {
    const { store } = storeOver();
    const [, read] = await Promise.all([store.writeCache(CODE, DAY, AT), store.readCache(CODE)]);
    expect(read).toEqual({ day: DAY, at: AT });
  });

  // No build shipped the secure-store copy, but a dev twin may hold one: it goes at the first read, once.
  it('deletes a copy left in the secure store at its first read, once, and a refused delete is no rejection', async () => {
    const memory = createMemoryKeyValueStore({ 'matchday.cache': '{"v":1}' });
    const deletes: string[] = [];
    let refuse = true;
    const kv: KeyValueStore = {
      get: memory.get,
      set: memory.set,
      delete: async (key) => {
        deletes.push(key);
        if (refuse) throw new Error('keystore locked');
        await memory.delete(key);
      },
    };
    const { store } = storeOver({ kv });
    expect(await store.readCache(CODE)).toBeNull();
    refuse = false;
    await store.readCache(CODE);
    expect(deletes).toEqual(['matchday.cache']);
    const fresh = storeOver({ kv });
    await fresh.store.readCache(CODE);
    expect(deletes).toEqual(['matchday.cache', 'matchday.cache']);
    expect(memory.entries.has('matchday.cache')).toBe(false);
  });
});

/**
 * Review M4: the copy is read back by casting, so its version must move with `MatchDay`'s shape. Each list below is
 * checked against the type by tsc; a field added to or taken from `MatchDay`, a court, a row or an approval fails it.
 * Bump `MATCHDAY_CACHE_VERSION` and these lists together, so a phone never misreads an older copy.
 */
// Final review M3: the copy is read back through the day parser's full check. One that parses as JSON but is wrong inside
// its lists is dropped: no copy, recorded as garbled, and a temp beside it that reads is the answer as before.
describe('the copy is read back through the day parser’s full check (final review M3)', () => {
  it.each([
    ['a row status that is no status', '"status":"upcoming"', '"status":"bogus"'],
    ['a row with no fixture', '"fixtureId":"8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f",', ''],
    ['a fixture id that is no id', '8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f', 'not-an-id'],
    ['a court state that is no state', '"state":"playing"', '"state":"busy"'],
    ['a court with no name', '"courtName":"Court 1",', ''],
    ['an approval round that is text', '"round":4', '"round":"4"'],
    ['a scope kind that is no kind', '"kind":"venue"', '"kind":"hall"'],
    ['a list item that is none', '"noCourt":[', '"noCourt":[null,'],
  ])('%s: no copy, recorded', async (_, from, to) => {
    const { store, files, record } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const good = files.files.get(COPY) ?? '';
    expect(good).toContain(from);
    files.files.set(COPY, good.replace(from, to));
    expect(await store.readCache(CODE)).toBeNull();
    expect(readRecord(record)).toContainEqual(
      expect.objectContaining({
        event: 'matchday.cache-unreadable',
        fields: { problem: 'garbled' },
      }),
    );
  });

  it('a spoiled copy beside a temp that reads: the temp is the answer', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const good = files.files.get(COPY) ?? '';
    files.files.set(TEMP, good);
    files.files.set(COPY, good.replace('"status":"upcoming"', '"status":"bogus"'));
    expect(await store.readCache(CODE)).toEqual({ day: DAY, at: AT });
  });

  it('a copy that reads keeps no field the day has not got', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const good = files.files.get(COPY) ?? '';
    files.files.set(COPY, good.replace('"tz":', '"url":"https://example.invalid/x","tz":'));
    const back = await store.readCache(CODE);
    expect(back).toEqual({ day: DAY, at: AT });
    expect(JSON.stringify(back)).not.toContain('example.invalid');
  });
});

describe('forgetOpened takes off exactly the ids it is given (final re-review N1)', () => {
  const A = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const B = '8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f';
  const C = '9d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f7a';

  it('an id added after the caller read the list stays; the others given go', async () => {
    const { store } = storeOver();
    await store.addOpened(A);
    await store.addOpened(B);
    const read = await store.opened();
    await store.addOpened(C);
    await store.forgetOpened(read);
    expect(await store.opened()).toEqual([C]);
  });

  it('the last id taken takes the key; none given changes nothing', async () => {
    const { store, kv } = storeOver();
    await store.addOpened(A);
    await store.forgetOpened([]);
    expect(await store.opened()).toEqual([A]);
    await store.forgetOpened([A, B]);
    expect(
      (kv as ReturnType<typeof createMemoryKeyValueStore>).entries.has(MATCHDAY_KEYS.opened),
    ).toBe(false);
  });

  it('a refused write rejects its caller and leaves the list', async () => {
    const memory = createMemoryKeyValueStore();
    const kv: KeyValueStore = {
      ...memory,
      delete: () => Promise.reject(new Error('keystore refused')),
    };
    const { store } = storeOver({ kv });
    await store.addOpened(A);
    await expect(store.forgetOpened([A])).rejects.toThrow('keystore refused');
    expect(await store.opened()).toEqual([A]);
  });
});

describe('the copy’s version follows the shape it was written in', () => {
  const AT_VERSION_1 = {
    day: {
      competition: 1,
      scope: 1,
      day: 1,
      tz: 1,
      opensAt: 1,
      expiresAt: 1,
      canApprove: 1,
      canCall: 1,
      courts: 1,
      noCourt: 1,
      online: 1,
      approvals: 1,
    } satisfies Record<keyof MatchDay, 1>,
    court: {
      courtId: 1,
      courtName: 1,
      venueName: 1,
      state: 1,
      now: 1,
      next: 1,
      finished: 1,
    } satisfies Record<keyof Court, 1>,
    row: {
      fixtureId: 1,
      sportKey: 1,
      divisionName: 1,
      roundLabel: 1,
      roundTag: 1,
      home: 1,
      away: 1,
      homeSlot: 1,
      awaySlot: 1,
      status: 1,
      scheduledAt: 1,
      summary: 1,
    } satisfies Record<keyof Row, 1>,
    approval: {
      kind: 1,
      stageId: 1,
      divisionName: 1,
      label: 1,
      round: 1,
      waiting: 1,
    } satisfies Record<keyof Approval, 1>,
  };

  /** Every key, at any depth, whose value can be a Date: the ones JSON writes as text and the read must revive. */
  type DateKeys<T> = T extends Date
    ? never
    : T extends readonly (infer Item)[]
      ? DateKeys<Item>
      : T extends object
        ? { [K in keyof T]-?: (Date extends T[K] ? K : never) | DateKeys<T[K]> }[keyof T]
        : never;

  it('is version 1 for the shape above', () => {
    expect(Object.keys(AT_VERSION_1)).toEqual(['day', 'court', 'row', 'approval']);
    expect(MATCHDAY_CACHE_VERSION).toBe(1);
  });

  it('revives every Date in the shape, and nothing else', () => {
    expectTypeOf<DateKeys<MatchDay>>().toEqualTypeOf<'opensAt' | 'expiresAt' | 'scheduledAt'>();
    expect([...MATCHDAY_DATE_KEYS].sort()).toEqual(['expiresAt', 'opensAt', 'scheduledAt']);
  });

  it('round-trips a day with a Date in every place one can be', async () => {
    const { store } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    const back = await store.readCache(CODE);
    const dates = [
      back?.day.opensAt,
      back?.day.expiresAt,
      back?.day.courts[0]?.next[0]?.scheduledAt,
      back?.day.courts[0]?.finished[0]?.scheduledAt,
      back?.day.noCourt[0]?.scheduledAt,
      back?.day.online[0]?.scheduledAt,
    ];
    expect(dates.every((date) => date instanceof Date)).toBe(true);
  });
});

describe('the matches opened from Match Day (`matchday.opened`, in the secure store)', () => {
  const A = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const B = '8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f';

  it('none at first; each once, in the order opened; one removed', async () => {
    const { store } = storeOver();
    expect(await store.opened()).toEqual([]);
    await store.addOpened(A);
    await store.addOpened(B);
    await store.addOpened(A);
    expect(await store.opened()).toEqual([A, B]);
    await store.removeOpened(A);
    expect(await store.opened()).toEqual([B]);
    await store.removeOpened(A);
    expect(await store.opened()).toEqual([B]);
  });

  it('keeps the list under its key', async () => {
    const kv = createMemoryKeyValueStore();
    await storeOver({ kv }).store.addOpened(A);
    expect(MATCHDAY_KEYS).toEqual({
      opened: 'matchday.opened',
      open: 'matchday.open',
      sending: 'matchday.sending',
      opensAt: 'matchday.opensAt',
    });
    expect(kv.entries.get('matchday.opened')).toBe(JSON.stringify([A]));
  });

  // A second call while the first is still writing: both land (one write at a time, each reading what is there).
  it('two opens at once both land', async () => {
    const { store } = storeOver();
    await Promise.all([store.addOpened(A), store.addOpened(B)]);
    expect(await store.opened()).toEqual([A, B]);
    await Promise.all([store.removeOpened(A), store.addOpened(A), store.removeOpened(B)]);
    expect(await store.opened()).toEqual([A]);
  });

  it('a list that does not read is none', async () => {
    for (const text of ['nope', '{"a":1}', '[1,2]']) {
      const kv = createMemoryKeyValueStore({ [MATCHDAY_KEYS.opened]: text });
      expect(await storeOver({ kv }).store.opened()).toEqual([]);
    }
  });

  it('a refused write rejects its own caller and never blocks the next', async () => {
    const memory = createMemoryKeyValueStore();
    let refuse = true;
    const kv: KeyValueStore = {
      get: memory.get,
      delete: memory.delete,
      set: async (key, value) => {
        if (refuse) throw new Error('keystore refused');
        await memory.set(key, value);
      },
    };
    const { store } = storeOver({ kv });
    await expect(store.addOpened(A)).rejects.toThrow('keystore refused');
    refuse = false;
    await store.addOpened(B);
    expect(await store.opened()).toEqual([B]);
  });

  it('a read refused while adding refuses the add: a list the phone cannot see is never written over', async () => {
    const memory = createMemoryKeyValueStore({ [MATCHDAY_KEYS.opened]: JSON.stringify([A]) });
    let refuse = true;
    const kv: KeyValueStore = {
      get: async (key) => {
        if (refuse) throw new Error('keystore locked');
        return memory.get(key);
      },
      set: memory.set,
      delete: memory.delete,
    };
    const { store } = storeOver({ kv });
    await expect(store.addOpened(B)).rejects.toThrow('keystore locked');
    refuse = false;
    expect(await store.opened()).toEqual([A]);
  });

  it('clearing the copy leaves the opened matches: their links outlive the code (S4 design §4)', async () => {
    const { store } = storeOver();
    await store.addOpened(A);
    await store.writeCache(CODE, DAY, AT);
    await store.clearCache();
    expect(await store.opened()).toEqual([A]);
  });
});

describe('the match open in Remote Scoring (MD-2 Task 5)', () => {
  const A = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const OPEN = { fixtureId: A, courtName: 'Court 1' };

  it('holds nothing known until it is read, and none when nothing is stored', async () => {
    const { store } = storeOver();
    expect(store.openMatch()).toBeUndefined();
    expect(await store.loadOpen()).toBeNull();
    expect(store.openMatch()).toBeNull();
  });

  it('a set open is held at once for a render, tells its listeners and survives a restart', async () => {
    const { store, kv } = storeOver();
    let told = 0;
    store.subscribeOpen(() => (told += 1));
    await store.setOpen(OPEN);
    expect(store.openMatch()).toEqual(OPEN);
    expect(told).toBe(1);
    const again = storeOver({ kv }).store;
    expect(await again.loadOpen()).toEqual(OPEN);
  });

  it('a refused write holds nothing, and the next one lands', async () => {
    const memory = createMemoryKeyValueStore();
    let refuse = true;
    const kv: KeyValueStore = {
      get: memory.get,
      delete: memory.delete,
      set: async (key, value) => {
        if (refuse) throw new Error('keystore refused');
        await memory.set(key, value);
      },
    };
    const { store } = storeOver({ kv });
    await expect(store.setOpen(OPEN)).rejects.toThrow('keystore refused');
    expect(store.openMatch()).toBeUndefined();
    refuse = false;
    await store.setOpen(OPEN);
    expect(store.openMatch()).toEqual(OPEN);
  });

  it('clearing deletes it, tells the listeners and leaves the opened matches', async () => {
    const { store, kv } = storeOver();
    await store.addOpened(A);
    await store.setOpen(OPEN);
    let told = 0;
    store.subscribeOpen(() => (told += 1));
    await store.clearOpen();
    expect(store.openMatch()).toBeNull();
    expect(told).toBe(1);
    expect(await kv.get(MATCHDAY_KEYS.open)).toBeNull();
    expect(await store.opened()).toEqual([A]);
  });

  it('an unsubscribed listener is not told', async () => {
    const { store } = storeOver();
    let told = 0;
    const off = store.subscribeOpen(() => (told += 1));
    off();
    await store.setOpen(OPEN);
    expect(told).toBe(0);
  });

  it.each([
    ['garbage', 'not json'],
    ['no court', JSON.stringify({ fixtureId: A })],
    ['an empty fixture', JSON.stringify({ fixtureId: '', courtName: 'Court 1' })],
    ['a number', '7'],
  ])('a stored value that is %s reads as none', async (_name, text) => {
    const { store } = storeOver({
      kv: createMemoryKeyValueStore({ [MATCHDAY_KEYS.open]: text }),
    });
    expect(await store.loadOpen()).toBeNull();
  });

  it('a store that will not answer reads as none, never a rejection', async () => {
    const kv: KeyValueStore = {
      get: async () => {
        throw new Error('locked');
      },
      set: async () => undefined,
      delete: async () => undefined,
    };
    const { store } = storeOver({ kv });
    expect(await store.loadOpen()).toBeNull();
  });
});

describe('the opened list read for a delete, and a refused clear (MD-2 Task 5 fix round 1)', () => {
  const A = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

  it('openedKnown is the list, empty when none is stored, and null when the phone refuses the read', async () => {
    expect(await storeOver().store.openedKnown()).toEqual([]);
    const seeded = createMemoryKeyValueStore({ [MATCHDAY_KEYS.opened]: JSON.stringify([A]) });
    expect(await storeOver({ kv: seeded }).store.openedKnown()).toEqual([A]);
    const locked: KeyValueStore = {
      get: async () => {
        throw new Error('locked');
      },
      set: async () => undefined,
      delete: async () => undefined,
    };
    expect(await storeOver({ kv: locked }).store.openedKnown()).toBeNull();
  });

  it('a refused delete of matchday.open still clears the held value, tells the listeners and rejects', async () => {
    const memory = createMemoryKeyValueStore();
    const kv: KeyValueStore = {
      get: memory.get,
      set: memory.set,
      delete: async () => {
        throw new Error('keystore refused');
      },
    };
    const { store } = storeOver({ kv });
    await store.setOpen({ fixtureId: A, courtName: 'Court 1' });
    let told = 0;
    store.subscribeOpen(() => (told += 1));
    await expect(store.clearOpen()).rejects.toThrow('keystore refused');
    expect(store.openMatch()).toBeNull();
    expect(told).toBe(1);
  });
});

describe('Exit’s part of the store (MD-2 Task 7)', () => {
  const A = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const B = '8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f';
  const refusing = (over: Partial<KeyValueStore>): KeyValueStore => ({
    ...createMemoryKeyValueStore(),
    ...over,
  });

  it('clearOpened empties the opened matches, leaves the open match and the copy, and is safe twice', async () => {
    const { store, files } = storeOver();
    await store.writeCache(CODE, DAY, AT);
    await store.addOpened(A);
    await store.addOpened(B);
    await store.setOpen({ fixtureId: A, courtName: 'Court 1' });
    await store.clearOpened();
    expect(await store.opened()).toEqual([]);
    expect(store.openMatch()).toEqual({ fixtureId: A, courtName: 'Court 1' });
    expect([...files.files.keys()]).toEqual([COPY]);
    await store.clearOpened();
    expect(await store.opened()).toEqual([]);
    // The list can be added to again afterwards: Exit does not break the next day's code.
    await store.addOpened(B);
    expect(await store.opened()).toEqual([B]);
  });

  it('a refused delete rejects its own caller and the next call still goes', async () => {
    let refuse = true;
    const memory = createMemoryKeyValueStore();
    const kv = refusing({
      get: memory.get,
      set: memory.set,
      delete: async (key) => {
        if (refuse) throw new Error('keystore refused');
        await memory.delete(key);
      },
    });
    const { store } = storeOver({ kv });
    await store.addOpened(A);
    await expect(store.clearOpened()).rejects.toThrow('keystore refused');
    expect(await store.opened()).toEqual([A]);
    refuse = false;
    await store.clearOpened();
    expect(await store.opened()).toEqual([]);
  });

  it('keeps the courts of the matches still sending, merged, in a key of their own', async () => {
    const kv = createMemoryKeyValueStore();
    const { store } = storeOver({ kv });
    expect([...(await store.sending())]).toEqual([]);
    await store.addSending(new Map([[A, 'Court 2']]));
    await store.addSending(new Map([[B, '']]));
    expect([...(await store.sending())]).toEqual([
      [A, 'Court 2'],
      [B, ''],
    ]);
    await store.addSending(new Map([[A, 'Court 3']]));
    expect((await store.sending()).get(A)).toBe('Court 3');
    expect(kv.entries.get('matchday.sending')).toBe(JSON.stringify({ [A]: 'Court 3', [B]: '' }));
  });

  it('forgetting one leaves the rest, and the last takes the key away', async () => {
    const kv = createMemoryKeyValueStore();
    const { store } = storeOver({ kv });
    await store.addSending(
      new Map([
        [A, 'Court 2'],
        [B, ''],
      ]),
    );
    await store.forgetSending(A);
    expect([...(await store.sending())]).toEqual([[B, '']]);
    await store.forgetSending(A);
    await store.forgetSending(B);
    expect(kv.entries.has('matchday.sending')).toBe(false);
  });

  it('forgetting a match that was never noted touches nothing', async () => {
    const kv = createMemoryKeyValueStore();
    const { store } = storeOver({ kv });
    const del = vi.spyOn(kv, 'delete');
    const set = vi.spyOn(kv, 'set');
    await store.forgetSending(A);
    await store.addSending(new Map([[B, '']]));
    set.mockClear();
    await store.forgetSending(A);
    expect(del).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('two at once both land', async () => {
    const { store } = storeOver();
    await Promise.all([
      store.addSending(new Map([[A, 'Court 2']])),
      store.addSending(new Map([[B, 'Court 3']])),
    ]);
    expect((await store.sending()).size).toBe(2);
  });

  it('a value that does not read is none, never a throw and never a half-read map', async () => {
    for (const text of ['nope', '[1]', '"x"', 'null']) {
      const kv = createMemoryKeyValueStore({ [MATCHDAY_KEYS.sending]: text });
      expect((await storeOver({ kv }).store.sending()).size).toBe(0);
    }
    const mixed = createMemoryKeyValueStore({
      [MATCHDAY_KEYS.sending]: JSON.stringify({ [A]: 'Court 1', [B]: 7 }),
    });
    expect([...(await storeOver({ kv: mixed }).store.sending())]).toEqual([[A, 'Court 1']]);
  });

  it('a refused read is none for the reader, and refuses the write (a list it cannot see is never written over)', async () => {
    const kv = refusing({
      get: async () => {
        throw new Error('locked');
      },
    });
    const { store } = storeOver({ kv });
    expect((await store.sending()).size).toBe(0);
    await expect(store.addSending(new Map([[A, 'Court 1']]))).rejects.toThrow('locked');
  });
});

describe('the opening kept for a code kept before its day (owner, 2026-11-12)', () => {
  const OPENS = new Date('2026-11-13T00:00:00.000Z');

  it('reads back what was written, and nothing for another code', async () => {
    const { store } = storeOver();
    expect(await store.readOpensAt(CODE)).toBeNull();
    await store.writeOpensAt(CODE, OPENS);
    expect(await store.readOpensAt(CODE)).toEqual(OPENS);
    expect(await store.readOpensAt(OTHER)).toBeNull();
  });

  it('keeps no token in the secure store', async () => {
    const { store, kv } = storeOver();
    await store.writeOpensAt(CODE, OPENS);
    expect(await kv.get('matchday.opensAt')).not.toContain(FIXTURE_DAY_TOKEN);
  });

  it('is gone with the copy, and a stored value that is not its shape reads as none', async () => {
    const { store, kv } = storeOver();
    await store.writeOpensAt(CODE, OPENS);
    await store.clearCache();
    expect(await store.readOpensAt(CODE)).toBeNull();
    await kv.set('matchday.opensAt', 'not json');
    expect(await store.readOpensAt(CODE)).toBeNull();
  });

  it('a copy the phone refuses to remove still loses the kept opening', async () => {
    const { store, files, kv } = storeOver();
    await store.writeOpensAt(CODE, OPENS);
    files.failNext('remove');
    await expect(store.clearCache()).rejects.toBeDefined();
    expect(await kv.get('matchday.opensAt')).toBeNull();
  });
});
