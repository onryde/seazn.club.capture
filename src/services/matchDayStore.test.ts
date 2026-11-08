import { describe, expect, it } from 'vitest';
import type { MatchDay, Row } from '@/domain/matchday/matchDay';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { MATCHDAY_KEYS, createMatchDayStore } from '@/services/matchDayStore';
import { FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';

const CODE: SavedDayCode = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
/** Another code of the same shape: made up. */
const OTHER: SavedDayCode = {
  origin: 'https://stg.seazn.club',
  token: 'md_Other-Day_0123456789abcdefghijklmnopqrstuv',
};

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
      finished: [],
    },
  ],
  noCourt: [row('2a7b8c9d-0e1f-4a2b-ac3d-5e6f7a8b9c0d', new Date('2026-11-07T11:00:00.000Z'))],
  online: [],
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
const AT = new Date('2026-11-07T10:42:00.000Z');

describe('the day’s last good copy (`matchday.cache`)', () => {
  it('reads back what was written, its Dates as Dates', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
    await store.writeCache(CODE, DAY, AT);
    const cached = await store.readCache(CODE);
    expect(cached).toEqual({ day: DAY, at: AT });
    expect(cached?.day.courts[0]?.next[0]?.scheduledAt).toBeInstanceOf(Date);
    expect(cached?.day.courts[0]?.now?.scheduledAt).toBeNull();
  });

  it('keeps the parsed day under its key, never the token or the wire’s own shape', async () => {
    const kv = createMemoryKeyValueStore();
    await createMatchDayStore(kv).writeCache(CODE, DAY, AT);
    expect([...kv.entries.keys()]).toEqual([MATCHDAY_KEYS.cache]);
    const stored = kv.entries.get(MATCHDAY_KEYS.cache) ?? '';
    expect(stored).not.toContain('md_');
    expect(stored).not.toContain('expires_at');
    expect(stored).not.toContain('"ok"');
    expect(MATCHDAY_KEYS).toEqual({ cache: 'matchday.cache', opened: 'matchday.opened' });
  });

  // The copy belongs to the code that was answered with it: a new code never shows the last code's day.
  it('is no copy for another code', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
    await store.writeCache(CODE, DAY, AT);
    expect(await store.readCache(OTHER)).toBeNull();
  });

  it('a second write replaces the first', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
    await store.writeCache(OTHER, DAY, AT);
    const later = new Date(AT.getTime() + 15_000);
    await store.writeCache(CODE, { ...DAY, canApprove: false }, later);
    expect(await store.readCache(OTHER)).toBeNull();
    expect(await store.readCache(CODE)).toEqual({ day: { ...DAY, canApprove: false }, at: later });
  });

  it('nothing written is no copy, and a cleared copy is none', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
    expect(await store.readCache(CODE)).toBeNull();
    await store.writeCache(CODE, DAY, AT);
    await store.clearCache();
    expect(await store.readCache(CODE)).toBeNull();
  });

  it.each([
    ['not JSON', 'nope'],
    ['another version', JSON.stringify({ v: 2, tag: 'x', at: 0, day: {} })],
    ['no day', JSON.stringify({ v: 1, tag: 'x', at: 0 })],
  ])('a stored copy that is %s is no copy', async (_, text) => {
    const store = createMatchDayStore(createMemoryKeyValueStore({ [MATCHDAY_KEYS.cache]: text }));
    expect(await store.readCache(CODE)).toBeNull();
  });

  it('a stored copy with a date that is no date is no copy', async () => {
    const kv = createMemoryKeyValueStore();
    const store = createMatchDayStore(kv);
    await store.writeCache(CODE, DAY, AT);
    const good = kv.entries.get(MATCHDAY_KEYS.cache) ?? '';
    for (const broken of [
      good.replace('2026-11-08T00:00:00.000Z', 'soon'),
      good.replace('"courts":[', '"courts":"none","x":['),
      good.replace(/"at":\d+/, '"at":"now"'),
    ]) {
      await kv.set(MATCHDAY_KEYS.cache, broken);
      expect(await store.readCache(CODE)).toBeNull();
    }
  });

  it('a read the phone refuses is no copy, never a rejection', async () => {
    const kv: KeyValueStore = {
      get: async () => {
        throw new Error('keystore locked');
      },
      set: async () => undefined,
      delete: async () => undefined,
    };
    expect(await createMatchDayStore(kv).readCache(CODE)).toBeNull();
  });
});

describe('the matches opened from Match Day (`matchday.opened`)', () => {
  const A = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const B = '8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f';

  it('none at first; each once, in the order opened; one removed', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
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

  // A second call while the first is still writing: both land (one write at a time, each reading what is there).
  it('two opens at once both land', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
    await Promise.all([store.addOpened(A), store.addOpened(B)]);
    expect(await store.opened()).toEqual([A, B]);
    await Promise.all([store.removeOpened(A), store.addOpened(A), store.removeOpened(B)]);
    expect(await store.opened()).toEqual([A]);
  });

  it('a list that does not read is none', async () => {
    for (const text of ['nope', '{"a":1}', '[1,2]']) {
      const store = createMatchDayStore(
        createMemoryKeyValueStore({ [MATCHDAY_KEYS.opened]: text }),
      );
      expect(await store.opened()).toEqual([]);
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
    const store = createMatchDayStore(kv);
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
    const store = createMatchDayStore(kv);
    await expect(store.addOpened(B)).rejects.toThrow('keystore locked');
    refuse = false;
    expect(await store.opened()).toEqual([A]);
  });

  it('clearing the copy leaves the opened matches: their links outlive the code (S4 design §4)', async () => {
    const store = createMatchDayStore(createMemoryKeyValueStore());
    await store.addOpened(A);
    await store.writeCache(CODE, DAY, AT);
    await store.clearCache();
    expect(await store.opened()).toEqual([A]);
  });
});
