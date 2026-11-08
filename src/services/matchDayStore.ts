import { tokenTag } from '@/domain/credentials/tokenTag';
import { isRecord } from '@/domain/credentials/wire';
import type { MatchDay } from '@/domain/matchday/matchDay';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import type { KeyValueStore } from '@/services/KeyValueStore';

export const MATCHDAY_KEYS = { cache: 'matchday.cache', opened: 'matchday.opened' } as const;

/** The day's last good copy, and when it was read (S4 design §5: "Offline · updated 10:42"). */
export type CachedDay = { readonly day: MatchDay; readonly at: Date };

/**
 * What Match Day keeps beside its code (the code itself is the mode store's `code.matchday`):
 *
 * - The day's last good copy, as `parseDay` handed it on, never the server's body (the dispatch's ruling 6). It
 *   belongs to the code it was read with: tagged with the code's `tokenTag` (N2: tells two issues apart, gives none
 *   away), so a new code never shows the last code's day, whatever order a save and a write land in.
 * - The matches opened from Match Day, whose scoring links outlive the code (S4 design §3, §4): the hub spares them
 *   until each queue is empty. Clearing the copy leaves them.
 *
 * Writes run one at a time, in call order, each reading what is there when it runs, so two opens at once both land. A
 * refused write rejects its own caller and never blocks the next. A read never rejects: what does not read is none.
 */
export type MatchDayStore = {
  readCache(code: SavedDayCode): Promise<CachedDay | null>;
  writeCache(code: SavedDayCode, day: MatchDay, at: Date): Promise<void>;
  clearCache(): Promise<void>;
  opened(): Promise<readonly string[]>;
  addOpened(fixtureId: string): Promise<void>;
  removeOpened(fixtureId: string): Promise<void>;
};

/** Bumped whenever `MatchDay`'s shape changes: an older copy is then none, never misread. */
const VERSION = 1;
/** Every key of `MatchDay` that holds a Date; JSON writes each as its ISO text. */
const DATE_KEYS: ReadonlySet<string> = new Set(['opensAt', 'expiresAt', 'scheduledAt']);
const LISTS = ['courts', 'noCourt', 'online', 'approvals'] as const;

export function createMatchDayStore(kv: KeyValueStore): MatchDayStore {
  const serial = serialWrites();
  const opened = async (): Promise<readonly string[]> =>
    readOpened(await kv.get(MATCHDAY_KEYS.opened).catch(() => null));
  // A read the phone refuses refuses the write too: a list it cannot see is never written over.
  const writeOpened = (change: (ids: readonly string[]) => readonly string[]) =>
    serial(async () => {
      const ids = readOpened(await kv.get(MATCHDAY_KEYS.opened));
      await kv.set(MATCHDAY_KEYS.opened, JSON.stringify(change(ids)));
    });
  return {
    readCache: async (code) => {
      const text = await kv.get(MATCHDAY_KEYS.cache).catch(() => null);
      return text === null ? null : readCache(text, tokenTag(code.token));
    },
    writeCache: (code, day, at) =>
      serial(() =>
        kv.set(
          MATCHDAY_KEYS.cache,
          JSON.stringify({ v: VERSION, tag: tokenTag(code.token), at: at.getTime(), day }),
        ),
      ),
    clearCache: () => serial(() => kv.delete(MATCHDAY_KEYS.cache)),
    opened,
    addOpened: (fixtureId) =>
      writeOpened((ids) => (ids.includes(fixtureId) ? ids : [...ids, fixtureId])),
    removeOpened: (fixtureId) => writeOpened((ids) => ids.filter((id) => id !== fixtureId)),
  };
}

/** The copy, if it is this version's, the code's own, and every date in it is a date. */
function readCache(text: string, tag: string): CachedDay | null {
  const data = parse(text);
  if (!isRecord(data) || data.v !== VERSION || data.tag !== tag) return null;
  if (typeof data.at !== 'number' || !Number.isFinite(data.at)) return null;
  const day = data.day;
  if (!isRecord(day) || !(day.opensAt instanceof Date) || !(day.expiresAt instanceof Date))
    return null;
  if (!LISTS.every((list) => Array.isArray(day[list]))) return null;
  return { day: day as MatchDay, at: new Date(data.at) };
}

/** JSON with its dates read back; a date that is no date refuses the whole copy. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (!DATE_KEYS.has(key) || typeof value !== 'string') return value;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new RangeError('not a date');
      return date;
    }) as unknown;
  } catch {
    return null;
  }
}

function readOpened(text: string | null): readonly string[] {
  if (text === null) return [];
  try {
    const ids: unknown = JSON.parse(text);
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : [];
  } catch {
    return [];
  }
}

/** One write at a time, in call order; a refused write rejects its own caller and never blocks the next. */
function serialWrites(): <T>(write: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (write) => {
    const run = tail.then(write);
    tail = run.catch(() => undefined);
    return run;
  };
}
