import { tokenTag } from '@/domain/credentials/tokenTag';
import { isRecord } from '@/domain/credentials/wire';
import type { MatchDay } from '@/domain/matchday/matchDay';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import type { QueueFiles } from '@/services/tapQueueStore';

/** What Match Day keeps in the secure store beside its code (`code.matchday`, the mode store's). */
export const MATCHDAY_KEYS = { opened: 'matchday.opened' } as const;

/** The day's last good copy, and when it was read (S4 design §5: "Offline · updated 10:42"). */
export type CachedDay = { readonly day: MatchDay; readonly at: Date };

/**
 * What Match Day keeps beside its code:
 *
 * - The day's last good copy, as `parseDay` handed it on, never the server's body (the dispatch's ruling 6), in a file
 *   of its own folder (`documentDirectory/matchday`; the controller's ruling, fix round 1): tens of KB rewritten every
 *   15 s do not belong in the Keystore, and it carries no token. It belongs to the code it was read with: tagged with
 *   the code's `tokenTag` (N2: tells two issues apart, gives none away), so a new code never shows the last code's
 *   day, whatever order a save and a write land in. Written to a temp file, then moved over the copy; Android's move
 *   deletes the copy first, so a temp file that reads is the copy when the copy does not (and is promoted).
 * - The matches opened from Match Day, whose scoring links outlive the code (S4 design §3, §4), in the secure store:
 *   the hub spares them until each queue is empty. Clearing the copy leaves them.
 *
 * Every call runs one at a time, in call order, each reading what is there when it runs, so two opens at once both
 * land and a write and a clear never cross. A refused write rejects its own caller and never blocks the next. A read
 * never rejects: what does not read is none, and the record says why.
 */
export type MatchDayStore = {
  readCache(code: SavedDayCode): Promise<CachedDay | null>;
  writeCache(code: SavedDayCode, day: MatchDay, at: Date): Promise<void>;
  clearCache(): Promise<void>;
  opened(): Promise<readonly string[]>;
  addOpened(fixtureId: string): Promise<void>;
  removeOpened(fixtureId: string): Promise<void>;
};

/** Bumped whenever `MatchDay`'s shape changes: an older copy is then none, never misread (`matchDayStore.test.ts`). */
export const MATCHDAY_CACHE_VERSION = 1;
/** Every key of `MatchDay` that holds a Date; JSON writes each as its ISO text. */
export const MATCHDAY_DATE_KEYS: ReadonlySet<string> = new Set([
  'opensAt',
  'expiresAt',
  'scheduledAt',
]);
const LISTS = ['courts', 'noCourt', 'online', 'approvals'] as const;
const COPY = 'day.json';
const TEMP = 'day.json.tmp';
/** Where Task 3's first cut kept the copy: no build shipped it, but a dev twin may still hold one. */
const LEFTOVER_KEY = 'matchday.cache';

type Envelope = { readonly tag: string; readonly copy: CachedDay };
type Problem = 'read' | 'garbled' | 'promote';
type Unreadable = (problem: Problem) => void;

export function createMatchDayStore(deps: {
  readonly kv: KeyValueStore;
  readonly files: QueueFiles;
  readonly logger: Logger;
}): MatchDayStore {
  const { kv, files, logger } = deps;
  const serial = oneAtATime();
  let leftover = true;
  const unreadable: Unreadable = (problem) => logger.warn('matchday.cache-unreadable', { problem });
  const opened = async (): Promise<readonly string[]> =>
    readOpened(await kv.get(MATCHDAY_KEYS.opened).catch(() => null));
  // A read the phone refuses refuses the write too: a list it cannot see is never written over.
  const writeOpened = (change: (ids: readonly string[]) => readonly string[]) =>
    serial(async () => {
      const ids = readOpened(await kv.get(MATCHDAY_KEYS.opened));
      await kv.set(MATCHDAY_KEYS.opened, JSON.stringify(change(ids)));
    });
  return {
    readCache: (code) =>
      serial(async () => {
        if (leftover) {
          leftover = false;
          await kv.delete(LEFTOVER_KEY).catch(() => undefined);
        }
        const found = await recover(files, unreadable);
        return found !== null && found.tag === tokenTag(code.token) ? found.copy : null;
      }),
    writeCache: (code, day, at) =>
      serial(async () => {
        const text = JSON.stringify({
          v: MATCHDAY_CACHE_VERSION,
          tag: tokenTag(code.token),
          at: at.getTime(),
          day,
        });
        await files.write(TEMP, text);
        await files.move(TEMP, COPY);
      }),
    clearCache: () =>
      serial(async () => {
        await files.remove(COPY);
        await files.remove(TEMP);
      }),
    opened,
    addOpened: (fixtureId) =>
      writeOpened((ids) => (ids.includes(fixtureId) ? ids : [...ids, fixtureId])),
    removeOpened: (fixtureId) => writeOpened((ids) => ids.filter((id) => id !== fixtureId)),
  };
}

/**
 * The copy as the files hold it. A copy that reads is the answer, whatever a temp file says (that temp is a write cut
 * before its move). Without one, a temp file that reads is the answer and is promoted: a kill inside Android's move
 * leaves it as the only copy. Never throws.
 */
async function recover(files: QueueFiles, unreadable: Unreadable): Promise<Envelope | null> {
  const main = await peek(files, COPY, unreadable);
  const found = main === null ? null : decode(main);
  if (found !== null) return found;
  const spare = await peek(files, TEMP, unreadable);
  const promoted = spare === null ? null : decode(spare);
  if (promoted === null) {
    if (main !== null || spare !== null) unreadable('garbled');
    return null;
  }
  await files.move(TEMP, COPY).catch(() => unreadable('promote'));
  return promoted;
}

async function peek(
  files: QueueFiles,
  name: string,
  unreadable: Unreadable,
): Promise<string | null> {
  try {
    return await files.read(name);
  } catch {
    unreadable('read');
    return null;
  }
}

/** The copy, if it is this version's and every date in it is a date, with the tag of the code it belongs to. */
function decode(text: string): Envelope | null {
  const data = parse(text);
  if (!isRecord(data) || data.v !== MATCHDAY_CACHE_VERSION || typeof data.tag !== 'string')
    return null;
  if (typeof data.at !== 'number' || !Number.isFinite(data.at)) return null;
  const day = data.day;
  if (!isRecord(day) || !(day.opensAt instanceof Date) || !(day.expiresAt instanceof Date))
    return null;
  if (!LISTS.every((list) => Array.isArray(day[list]))) return null;
  return { tag: data.tag, copy: { day: day as MatchDay, at: new Date(data.at) } };
}

/** JSON with its dates read back; a date that is no date refuses the whole copy. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (!MATCHDAY_DATE_KEYS.has(key) || typeof value !== 'string') return value;
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

/** One call at a time, in call order; a refused one rejects its own caller and never blocks the next. */
function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
