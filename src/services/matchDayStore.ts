import { tokenTag } from '@/domain/credentials/tokenTag';
import { isRecord } from '@/domain/credentials/wire';
import { readStoredDay } from '@/domain/matchday/dayWire';
import type { MatchDay } from '@/domain/matchday/matchDay';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import type { QueueFiles } from '@/services/tapQueueStore';

/** What Match Day keeps in the secure store beside its code (`code.matchday`, the mode store's). */
export const MATCHDAY_KEYS = {
  opened: 'matchday.opened',
  open: 'matchday.open',
  sending: 'matchday.sending',
} as const;

/**
 * The match Match Day has open in Remote Scoring, with the court its row sat on (S4 design §6: the pad's Back reads
 * "‹ Court 1"). No credential: the match's link is the scoring link store's.
 */
export type OpenMatch = { readonly fixtureId: string; readonly courtName: string };

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
  /** Like `opened`, but null when the phone refuses the read: a caller that deletes must not read that as none. */
  openedKnown(): Promise<readonly string[] | null>;
  addOpened(fixtureId: string): Promise<void>;
  removeOpened(fixtureId: string): Promise<void>;
  /** Exit (S4 design §4): Match Day lets go of every match it opened. Their own links and queues stay, by S2's rules. */
  clearOpened(): Promise<void>;
  /**
   * Takes exactly these ids off the list, as it stands when the write runs: an id added since the caller read the list
   * stays (final re-review N1). The key goes with the last id. A refused read or write rejects its caller.
   */
  forgetOpened(fixtureIds: readonly string[]): Promise<void>;
  /**
   * The matches Exit left with taps still sending, each with the court it was opened from ('' for none): what Home's
   * Sending card names it by. Court names only, never a link. A read the phone refuses is none, and the record says so.
   */
  sending(): Promise<ReadonlyMap<string, string>>;
  /** Adds matches to the sending ones, keeping those already there. A refused write rejects its caller. */
  addSending(courts: ReadonlyMap<string, string>): Promise<void>;
  /** A match's queue has emptied and it is let go: its entry goes with it. A refused write rejects its caller. */
  forgetSending(fixtureId: string): Promise<void>;
  /** Reads `matchday.open` into the held value (`openMatch`); never rejects. A reopen decides only after it. */
  loadOpen(): Promise<OpenMatch | null>;
  /** The open match as held now: undefined before `loadOpen` or a `setOpen`, null for none. Safe to read in render. */
  openMatch(): OpenMatch | null | undefined;
  subscribeOpen(listener: () => void): () => void;
  /** Holds the match open, once the write has landed: a refused write rejects and changes nothing. */
  setOpen(match: OpenMatch): Promise<void>;
  /** Back on the list: the match is no longer open. A refused delete rejects and changes nothing. */
  clearOpen(): Promise<void>;
};

/** Bumped whenever `MatchDay`'s shape changes: an older copy is then none, never misread (`matchDayStore.test.ts`). */
export const MATCHDAY_CACHE_VERSION = 1;
/** Every key of `MatchDay` that holds a Date; JSON writes each as its ISO text. */
export const MATCHDAY_DATE_KEYS: ReadonlySet<string> = new Set([
  'opensAt',
  'expiresAt',
  'scheduledAt',
]);
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
  let held: OpenMatch | null | undefined;
  const listeners = new Set<() => void>();
  const hold = (next: OpenMatch | null): void => {
    held = next;
    for (const listener of listeners) listener();
  };
  const unreadable: Unreadable = (problem) => logger.warn('matchday.cache-unreadable', { problem });
  const opened = async (): Promise<readonly string[]> =>
    readOpened(await kv.get(MATCHDAY_KEYS.opened).catch(() => null));
  // A read the phone refuses refuses the write too: a list it cannot see is never written over.
  const writeOpened = (change: (ids: readonly string[]) => readonly string[]) =>
    serial(async () => {
      const ids = readOpened(await kv.get(MATCHDAY_KEYS.opened));
      await kv.set(MATCHDAY_KEYS.opened, JSON.stringify(change(ids)));
    });
  const readSending = async (): Promise<ReadonlyMap<string, string>> =>
    readCourts(await kv.get(MATCHDAY_KEYS.sending).catch(() => null));
  const writeSending = (change: (held: Map<string, string>) => boolean | void) =>
    serial(async () => {
      const held = new Map(readCourts(await kv.get(MATCHDAY_KEYS.sending)));
      if (change(held) === false) return;
      if (held.size === 0) await kv.delete(MATCHDAY_KEYS.sending);
      else await kv.set(MATCHDAY_KEYS.sending, JSON.stringify(Object.fromEntries(held)));
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
    openedKnown: async () => {
      try {
        return readOpened(await kv.get(MATCHDAY_KEYS.opened));
      } catch {
        return null;
      }
    },
    addOpened: (fixtureId) =>
      writeOpened((ids) => (ids.includes(fixtureId) ? ids : [...ids, fixtureId])),
    removeOpened: (fixtureId) => writeOpened((ids) => ids.filter((id) => id !== fixtureId)),
    clearOpened: () => serial(() => kv.delete(MATCHDAY_KEYS.opened)),
    forgetOpened: (fixtureIds) =>
      serial(async () => {
        const left = readOpened(await kv.get(MATCHDAY_KEYS.opened)).filter(
          (id) => !fixtureIds.includes(id),
        );
        if (left.length === 0) await kv.delete(MATCHDAY_KEYS.opened);
        else await kv.set(MATCHDAY_KEYS.opened, JSON.stringify(left));
      }),
    sending: readSending,
    addSending: (courts) =>
      writeSending((held) => {
        for (const [id, court] of courts) held.set(id, court);
      }),
    forgetSending: (fixtureId) => writeSending((held) => held.delete(fixtureId)),
    loadOpen: () =>
      serial(async () => {
        const found = readOpen(await kv.get(MATCHDAY_KEYS.open).catch(() => null));
        hold(found);
        return found;
      }),
    openMatch: () => held,
    subscribeOpen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOpen: (match) =>
      serial(async () => {
        await kv.set(MATCHDAY_KEYS.open, JSON.stringify(match));
        hold(match);
      }),
    clearOpen: () =>
      serial(async () => {
        // The held value is what the session's Back reads: it goes even when the delete is refused (the caller records it).
        try {
          await kv.delete(MATCHDAY_KEYS.open);
        } finally {
          hold(null);
        }
      }),
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

/**
 * The copy, if it is this version's and its day passes the day parser's full check (`readStoredDay`; final review M3:
 * every row, court and approval), with the tag of the code it belongs to.
 */
function decode(text: string): Envelope | null {
  const data = parse(text);
  if (!isRecord(data) || data.v !== MATCHDAY_CACHE_VERSION || typeof data.tag !== 'string')
    return null;
  if (typeof data.at !== 'number' || !Number.isFinite(data.at)) return null;
  const day = readStoredDay(data.day);
  return day === null ? null : { tag: data.tag, copy: { day, at: new Date(data.at) } };
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

function readOpen(text: string | null): OpenMatch | null {
  if (text === null) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || typeof data.fixtureId !== 'string' || data.fixtureId === '') return null;
    return typeof data.courtName === 'string'
      ? { fixtureId: data.fixtureId, courtName: data.courtName }
      : null;
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

function readCourts(text: string | null): ReadonlyMap<string, string> {
  if (text === null) return new Map();
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data)) return new Map();
    const held = Object.entries(data).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return new Map(held);
  } catch {
    return new Map();
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
