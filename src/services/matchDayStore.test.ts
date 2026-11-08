import { describe, expect, expectTypeOf, it } from 'vitest';
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
  home: 'Ng',
  away: null,
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
  return { store: createMatchDayStore({ kv, files, logger }), files, record };
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
      home: 1,
      away: 1,
      status: 1,
      scheduledAt: 1,
      summary: 1,
    } satisfies Record<keyof Row, 1>,
    approval: { kind: 1, stageId: 1, divisionName: 1, label: 1, round: 1 } satisfies Record<
      keyof Approval,
      1
    >,
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
    expect(MATCHDAY_KEYS).toEqual({ opened: 'matchday.opened' });
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
