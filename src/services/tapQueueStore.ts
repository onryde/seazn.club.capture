import { isRecord } from '@/domain/credentials/wire';
import { NO_PICKS, readPicks } from '@/domain/scoring/pendingPicks';
import {
  QUEUE_DEAD_WORDS,
  keptStillMine,
  type BootCache,
  type MatchQueue,
  type QueueDead,
  type QueuedEvent,
  type TapReading,
} from '@/domain/scoring/queue';
import {
  bootstrapToWire,
  parseBootstrap,
  readList,
  readText,
  readWhole,
  type LedgerEvent,
} from '@/domain/scoring/wire';
import type { Logger } from '@/services/logger';

/** The queue's shapes live in the domain, which `sync.ts` reads; callers may take them from here too. */
export type { BootCache, MatchQueue, QueueDead, QueuedEvent } from '@/domain/scoring/queue';

/**
 * The queue's durable store (design §6.3, plan S2-1 Task 5): one small JSON file per match, so a tap made at once
 * survives the app being killed before its send. Not the secure store: the queue holds no secret, and that store is
 * the wrong place for a growing list. The scoring link's token never comes here: `encode` refuses a queue that
 * carries one, wherever it hides.
 *
 * A save is a temp file moved over the old one, but that move is not one step where it matters: on Android
 * expo-file-system 57.0.7 deletes the target and then renames (`CopyMoveStrategy.kt`, `prepareAsDestination` and
 * `tryNativeMove`), so a kill between the two leaves the new queue only as `{id}.json.tmp`. A read therefore treats a
 * temp file that decodes as the queue when the main file is missing or garbled, and promotes it.
 */

/**
 * The folder the files live in, as the store needs it. The production one is `createExpoQueueFiles`; tests use an
 * in-memory one (`test/memoryQueueFiles.ts`).
 */
export interface QueueFiles {
  /** Every file name in the folder. */
  names(): Promise<readonly string[]>;
  /** The text of a file, or null when there is none. */
  read(name: string): Promise<string | null>;
  /** Writes a file, replacing what was there. */
  write(name: string, text: string): Promise<void>;
  /**
   * Moves a file onto another name, replacing it. NOT atomic over an existing file on every platform: Android deletes
   * the target first, so a kill in between leaves the source alone. The store reads for that.
   */
  move(from: string, to: string): Promise<void>;
  /** Deletes a file; one that is not there is not a failure. */
  remove(name: string): Promise<void>;
}

/** One match on Home's list: a queue to continue, or one that could not be read and was set aside. */
export type QueueEntry =
  | { readonly kind: 'queue'; readonly queue: MatchQueue }
  | { readonly kind: 'unreadable'; readonly fixtureId: string };

/** What Home's Continue card and the match hook keep of unsent taps. Methods never reject but `save*`, `remove*`, `leave` and `expireKept`. */
export interface TapQueueStore {
  /**
   * Every match with a queue, by fixture id, in a stable order. A match is never skipped: one whose files exist but
   * whose queue cannot be read is an `unreadable` entry. That is a garbled file (kept aside as `.bad`), and also a read
   * the disk refused (the main file, or a temp file that may be the only copy) or a garbled file that could not be set
   * aside. It stands until the match is removed or saved again, or, for a refused read, until the next list reads it.
   */
  list(): Promise<readonly QueueEntry[]>;
  /**
   * `list`, but null when the folder cannot be listed: a caller that lets go of a match because it has NO queue must not
   * read a folder it could not see as an empty one (MD-2 final review I1). Never rejects.
   */
  listKnown(): Promise<readonly QueueEntry[] | null>;
  /** A match's queue, or null when it has none or it cannot be read (reported once, never thrown). */
  load(fixtureId: string): Promise<MatchQueue | null>;
  /**
   * Atomic as far as the platform allows: the whole queue is written to a temporary file and moved over the old one,
   * so a save cut short leaves the old file whole, and one cut inside the move leaves the temp file, which a read promotes. Rejects when it
   * could not be written, so the caller never shows a tap as stored that is not. Why is `queueSaveProblemOf(error)`.
   */
  save(queue: MatchQueue): Promise<void>;
  /**
   * Deletes everything of a match: its queue, its ledger and its boot cache (Dismiss). Rejects when the disk refuses;
   * a match with none is not a failure.
   */
  remove(fixtureId: string): Promise<void>;
  /** The ledger last fetched for a match, from seq 1, or null: none cached or it cannot be read (reported once). */
  loadLedger(fixtureId: string): Promise<readonly LedgerEvent[] | null>;
  /** Replaces a match's cached ledger, written the same way as a queue. Rejects on a ledger with a hole or the disk's refusal. */
  saveLedger(fixtureId: string, events: readonly LedgerEvent[]): Promise<void>;
  /** Deletes a match's cached ledger. Rejects when the disk refuses; none is not a failure. */
  removeLedger(fixtureId: string): Promise<void>;
  /**
   * The bootstrap last read for a match and the Start screen's pick (plan S2-1 Task 9), so a reopened match shows with
   * no signal; null when none is cached or it cannot be read (reported once). Kept as the endpoint's own envelope.
   */
  loadBoot(fixtureId: string): Promise<BootCache | null>;
  /** Replaces a match's boot cache, written the same way as a queue. Rejects on a bootstrap that is not this match's, or that names a link's secret, and on the disk's refusal. */
  saveBoot(fixtureId: string, cache: BootCache): Promise<void>;
  /** Deletes a match's boot cache. Rejects when the disk refuses; none is not a failure. */
  removeBoot(fixtureId: string): Promise<void>;
  /**
   * Lets a match go with nothing left to send (scanning another match, a drained sender's clean-up), keeping the ids of
   * this phone's own taps for a day (owner ruling 46, 2026-11-03): its queue, ledger and boot cache are deleted as
   * `remove` does, but the ids, stamped `now` (epoch ms), are first written to a small file of their own. That file is
   * no queue: `list` never names it, so it is no leftover card and no unsent work. Having none to keep, it keeps none (an
   * older kept file of the match goes). Rejects when the disk refuses, and deletes nothing if the ids could not be kept.
   */
  leave(fixtureId: string, now: number): Promise<void>;
  /** The own-tap ids kept for a match left within the last day, or null: none, too old, or unreadable (reported once). */
  loadKept(fixtureId: string, now: number): Promise<readonly string[] | null>;
  /** Deletes every kept file older than a day, and any that cannot be read. Rejects when the disk refuses a delete. */
  expireKept(now: number): Promise<void>;
}

/**
 * Why a queue save failed, for the record line `scoring.queue.saveFailed {problem}`: `secret` (the text names a scoring
 * link's secret), `readback` (the text would not read back as the queue), `name` (the fixture id is no file name) or
 * `file` (the file port's write or move threw, or anything else). Each is a word, never a message, path or queue text.
 */
export type QueueSaveProblem = 'secret' | 'readback' | 'name' | 'file';

/**
 * A queue the store itself will not write, refused before any file is touched. It carries its reason, so a caller never
 * matches on the message. The file port's own failures are not this class, and read as `file`.
 */
export class QueueSaveRefused extends Error {
  constructor(
    readonly problem: Exclude<QueueSaveProblem, 'file'>,
    message: string,
  ) {
    super(message);
  }
}

/** The word for whatever a queue `save` rejected with: the store's own refusals carry theirs, the rest is `file`. */
export function queueSaveProblemOf(error: unknown): QueueSaveProblem {
  return error instanceof QueueSaveRefused ? error.problem : 'file';
}

const FILE_VERSION = 1;
/** A fixture id is a file name: letters, digits, `_` and `-` only, so no id can name another folder or a temp file. */
const FIXTURE_ID = /^[A-Za-z0-9_-]{1,100}$/;
/** A queue's own files: `{id}.json`, its temp `{id}.json.tmp` and its set-aside `{id}.json.bad`. A ledger's dot breaks it. */
const QUEUE_FILE = /^([A-Za-z0-9_-]{1,100})\.json(?:\.tmp|\.bad)?$/;
/**
 * The kept ids of a left match: `{id}.own.json` and its temp. A queue's regex never matches them: its id has no dot.
 * That is a second fence, not the load-bearing one: `listEntries` lists only an id with a queue main file, so a kept
 * file alone is never a card, unsent work, a sender or a poll (review of 956ce30).
 */
const KEPT_FILE = /^([A-Za-z0-9_-]{1,100})\.own\.json(?:\.tmp)?$/;
/** The shape of a scoring link's secret (`dl_` and base64url), matched loosely: better a refusal than a leak. */
const LINK_SECRET = /dl_[A-Za-z0-9_-]{20,}/;
/** The key a folder-level failure is reported under: no file name can be empty. */
const FOLDER = '';

const fileName = (fixtureId: string): string => `${fixtureId}.json`;
const tempName = (fixtureId: string): string => `${fileName(fixtureId)}.tmp`;
const asideName = (fixtureId: string): string => `${fileName(fixtureId)}.bad`;
const ledgerName = (fixtureId: string): string => `${fixtureId}.ledger.json`;
const ledgerTempName = (fixtureId: string): string => `${ledgerName(fixtureId)}.tmp`;
const bootName = (fixtureId: string): string => `${fixtureId}.boot.json`;
const bootTempName = (fixtureId: string): string => `${bootName(fixtureId)}.tmp`;
const keptName = (fixtureId: string): string => `${fixtureId}.own.json`;
const keptTempName = (fixtureId: string): string => `${keptName(fixtureId)}.tmp`;

/** Every file of a match that is not its kept ids: what `leave` and `remove` both delete. */
const matchFiles = (fixtureId: string): readonly string[] => [
  fileName(fixtureId),
  tempName(fixtureId),
  asideName(fixtureId),
  ledgerName(fixtureId),
  ledgerTempName(fixtureId),
  bootName(fixtureId),
  bootTempName(fixtureId),
];
const keptFiles = (fixtureId: string): readonly string[] => [
  keptName(fixtureId),
  keptTempName(fixtureId),
];

/** One durable file and what a read does about its troubles. */
type Slot<T> = {
  readonly main: string;
  readonly temp: string;
  /** Where a garbled main file goes, whole, before anything can overwrite it; none for a cache that is fetched again. */
  readonly aside: string | null;
  /** The record line a trouble is said under. */
  readonly event:
    | 'scoring.queue.unreadable'
    | 'scoring.ledger.unreadable'
    | 'scoring.boot.unreadable'
    | 'scoring.kept.unreadable';
  readonly decode: (text: string) => T | null;
};

type Report = (slot: Slot<unknown>, name: string, problem: string) => void;
type Readable = (name: string) => void;

const queueSlot = (fixtureId: string): Slot<MatchQueue> => ({
  main: fileName(fixtureId),
  temp: tempName(fixtureId),
  aside: asideName(fixtureId),
  event: 'scoring.queue.unreadable',
  decode: (text) => decodeQueue(text, fixtureId),
});

const ledgerSlot = (fixtureId: string): Slot<readonly LedgerEvent[]> => ({
  main: ledgerName(fixtureId),
  temp: ledgerTempName(fixtureId),
  aside: null,
  event: 'scoring.ledger.unreadable',
  decode: (text) => decodeLedger(text, fixtureId),
});

const bootSlot = (fixtureId: string): Slot<BootCache> => ({
  main: bootName(fixtureId),
  temp: bootTempName(fixtureId),
  aside: null,
  event: 'scoring.boot.unreadable',
  decode: (text) => decodeBoot(text, fixtureId),
});

const keptSlot = (fixtureId: string): Slot<Kept> => ({
  main: keptName(fixtureId),
  temp: keptTempName(fixtureId),
  aside: null,
  event: 'scoring.kept.unreadable',
  decode: (text) => decodeKept(text, fixtureId),
});

export function createTapQueueStore(deps: { files: QueueFiles; logger: Logger }): TapQueueStore {
  const { files, logger } = deps;
  const inOrder = serially();
  const reported = new Set<string>();
  const report: Report = (slot, name, problem) => {
    if (reported.has(name)) return;
    reported.add(name);
    logger.warn(slot.event, { problem });
  };
  const readable: Readable = (name) => {
    reported.delete(name);
  };
  const reading = { files, report, readable };
  const guarded = <T>(fixtureId: string, otherwise: T, task: () => Promise<T>): Promise<T> =>
    FIXTURE_ID.test(fixtureId) ? inOrder(task) : Promise.resolve(otherwise);
  return {
    list: () => inOrder(async () => listEntries(reading, (await folderNamesKnown(reading)) ?? [])),
    listKnown: () =>
      inOrder(async () => {
        const names = await folderNamesKnown(reading);
        return names === null ? null : listEntries(reading, names);
      }),
    load: (fixtureId) => guarded(fixtureId, null, () => recover(reading, queueSlot(fixtureId))),
    save: (queue) =>
      inOrder(async () => {
        await writeQueue(files, queue);
        readable(fileName(queue.fixtureId));
      }),
    remove: (fixtureId) =>
      guarded(fixtureId, undefined, async () => {
        for (const name of [...matchFiles(fixtureId), ...keptFiles(fixtureId)])
          await files.remove(name);
        readableAll(readable, fixtureId);
      }),
    leave: (fixtureId, now) =>
      guarded(fixtureId, undefined, async () => {
        const ids = await ownIdsOf(reading, fixtureId);
        if (ids.length > 0) await writeKept(files, fixtureId, ids, now);
        else for (const name of keptFiles(fixtureId)) await files.remove(name);
        for (const name of matchFiles(fixtureId)) await files.remove(name);
        readableAll(readable, fixtureId);
      }),
    loadKept: (fixtureId, now) =>
      guarded(fixtureId, null, async () => {
        const kept = await recover(reading, keptSlot(fixtureId));
        return kept !== null && keptStillMine(kept.leftAt, now) ? kept.ownEventIds : null;
      }),
    expireKept: (now) => inOrder(() => expireKept(reading, now)),
    loadLedger: (fixtureId) =>
      guarded(fixtureId, null, () => recover(reading, ledgerSlot(fixtureId))),
    saveLedger: (fixtureId, events) =>
      inOrder(async () => {
        await writeLedger(files, fixtureId, events);
        readable(ledgerName(fixtureId));
      }),
    removeLedger: (fixtureId) =>
      guarded(fixtureId, undefined, async () => {
        await files.remove(ledgerName(fixtureId));
        await files.remove(ledgerTempName(fixtureId));
        readable(ledgerName(fixtureId));
      }),
    loadBoot: (fixtureId) => guarded(fixtureId, null, () => recover(reading, bootSlot(fixtureId))),
    saveBoot: (fixtureId, cache) =>
      inOrder(async () => {
        await writeBoot(files, fixtureId, cache);
        readable(bootName(fixtureId));
      }),
    removeBoot: (fixtureId) =>
      guarded(fixtureId, undefined, async () => {
        await files.remove(bootName(fixtureId));
        await files.remove(bootTempName(fixtureId));
        readable(bootName(fixtureId));
      }),
  };
}

/** One task at a time, in the order asked: two saves made together are two whole writes, never one tangled one. */
function serially(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

type Reading = { files: QueueFiles; report: Report; readable: Readable };

/** Every file name in the folder; none, said once, when the folder cannot be listed. */
async function folderNames(reading: Reading): Promise<readonly string[]> {
  return (await folderNamesKnown(reading)) ?? [];
}

/** Every file name in the folder; null, said once, when the folder cannot be listed. */
async function folderNamesKnown(reading: Reading): Promise<readonly string[] | null> {
  try {
    const names = await reading.files.names();
    reading.readable(FOLDER);
    return names;
  } catch {
    reading.report(queueSlot('x'), FOLDER, 'folder');
    return null;
  }
}

const idsIn = (names: readonly string[], pattern: RegExp): string[] =>
  [...new Set(names.flatMap((name) => pattern.exec(name)?.[1] ?? []))].sort();

async function listEntries(
  reading: Reading,
  names: readonly string[],
): Promise<readonly QueueEntry[]> {
  const ids = idsIn(names, QUEUE_FILE);
  const entries: QueueEntry[] = [];
  for (const id of ids) {
    const { value, trouble } = await recoverSlot(reading, queueSlot(id));
    if (value !== null) entries.push({ kind: 'queue', queue: value });
    else if (trouble || (await isAside(reading.files, id)))
      entries.push({ kind: 'unreadable', fixtureId: id });
  }
  return entries;
}

/** A match's files all read afresh after a delete: a trouble reported for one is over when the file is gone. */
function readableAll(readable: Readable, fixtureId: string): void {
  readable(fileName(fixtureId));
  readable(ledgerName(fixtureId));
  readable(bootName(fixtureId));
  readable(keptName(fixtureId));
}

/**
 * The ids to keep when a match is left: its queue's, which hold every id the kept file gave when the match was opened
 * again; a match with no queue (opened again, nothing tapped since) keeps the ids it already had, stamped again.
 */
async function ownIdsOf(reading: Reading, fixtureId: string): Promise<readonly string[]> {
  const queue = (await recoverSlot(reading, queueSlot(fixtureId))).value;
  if (queue !== null) return queue.ownEventIds;
  return (await recoverSlot(reading, keptSlot(fixtureId))).value?.ownEventIds ?? [];
}

/**
 * Deletes the kept files older than a day. One that cannot be read at all (garbled) goes too, since nothing would ever
 * read it; one the disk refused to read stays, to be tried again next time.
 */
async function expireKept(reading: Reading, now: number): Promise<void> {
  for (const id of idsIn(await folderNames(reading), KEPT_FILE)) {
    const { value, trouble } = await recoverSlot(reading, keptSlot(id));
    if (trouble || (value !== null && keptStillMine(value.leftAt, now))) continue;
    for (const name of keptFiles(id)) await reading.files.remove(name);
    reading.readable(keptName(id));
  }
}

/** A queue that could not be read leaves its text as `{id}.json.bad`: that file is the match, named, not skipped. */
async function isAside(files: QueueFiles, fixtureId: string): Promise<boolean> {
  try {
    return (await files.read(asideName(fixtureId))) !== null;
  } catch {
    return true;
  }
}

const REFUSED = Symbol('the disk refused the read');

async function peek(files: QueueFiles, name: string): Promise<string | null | typeof REFUSED> {
  try {
    return await files.read(name);
  } catch {
    return REFUSED;
  }
}

type Recovered<T> = {
  readonly value: T | null;
  /**
   * A match whose queue could not be read, that no `.bad` file names: a read the disk refused (the main file, or a
   * temp file that may be the only copy) or a garble that could not be set aside. A garble that WAS set aside is named by
   * its `.bad` file (`isAside`).
   */
  readonly trouble: boolean;
};

async function recover<T>(reading: Reading, slot: Slot<T>): Promise<T | null> {
  return (await recoverSlot(reading, slot)).value;
}

/**
 * What a slot holds, and what that costs the files. A main file that decodes is the answer, whatever a temp file says
 * (the temp is a save that never finished). Without one, a temp file that decodes is the answer and is promoted: a kill
 * inside a save's move leaves it as the only copy. A garbled main file is first set aside (never overwritten), then
 * said once. `trouble` says a match is there that cannot be read, for `list` to name. Never throws.
 */
async function recoverSlot<T>(
  { files, report, readable }: Reading,
  slot: Slot<T>,
): Promise<Recovered<T>> {
  const main = await peek(files, slot.main);
  if (main === REFUSED) {
    report(slot, slot.main, 'read');
    return { value: null, trouble: true };
  }
  const found = main === null ? null : slot.decode(main);
  if (found !== null) {
    readable(slot.main);
    return { value: found, trouble: false };
  }
  const spare = await peek(files, slot.temp);
  if (spare === REFUSED) report(slot, slot.temp, 'read');
  const promoted = typeof spare === 'string' ? slot.decode(spare) : null;
  if (main !== null && slot.aside !== null && !(await setAside(files, slot.main, slot.aside))) {
    report(slot, slot.main, 'aside');
    return { value: promoted, trouble: true };
  }
  if (promoted === null) {
    if (main !== null) report(slot, slot.main, 'garbled');
    else if (typeof spare === 'string') report(slot, slot.temp, 'garbled');
    return { value: null, trouble: spare === REFUSED };
  }
  try {
    await files.move(slot.temp, slot.main);
    readable(slot.main);
  } catch {
    report(slot, slot.temp, 'promote');
  }
  return { value: promoted, trouble: false };
}

async function setAside(files: QueueFiles, from: string, to: string): Promise<boolean> {
  try {
    await files.move(from, to);
    return true;
  } catch {
    return false;
  }
}

async function writeQueue(files: QueueFiles, queue: MatchQueue): Promise<void> {
  if (!FIXTURE_ID.test(queue.fixtureId))
    throw new QueueSaveRefused('name', 'a queue needs a fixture id fit for a file name');
  await writeThenMove(
    files,
    encodeQueue(queue),
    tempName(queue.fixtureId),
    fileName(queue.fixtureId),
  );
}

async function writeLedger(
  files: QueueFiles,
  fixtureId: string,
  events: readonly LedgerEvent[],
): Promise<void> {
  if (!FIXTURE_ID.test(fixtureId))
    throw new Error('a ledger needs a fixture id fit for a file name');
  await writeThenMove(
    files,
    encodeLedger(fixtureId, events),
    ledgerTempName(fixtureId),
    ledgerName(fixtureId),
  );
}

async function writeBoot(files: QueueFiles, fixtureId: string, cache: BootCache): Promise<void> {
  if (!FIXTURE_ID.test(fixtureId))
    throw new Error('a boot cache needs a fixture id fit for a file name');
  await writeThenMove(
    files,
    encodeBoot(fixtureId, cache),
    bootTempName(fixtureId),
    bootName(fixtureId),
  );
}

async function writeKept(
  files: QueueFiles,
  fixtureId: string,
  ownEventIds: readonly string[],
  leftAt: number,
): Promise<void> {
  await writeThenMove(
    files,
    encodeKept(fixtureId, ownEventIds, leftAt),
    keptTempName(fixtureId),
    keptName(fixtureId),
  );
}

/** The temp file whole first, then moved onto the name: a write cut short never touches the file that is there. */
async function writeThenMove(
  files: QueueFiles,
  text: string,
  temp: string,
  main: string,
): Promise<void> {
  await files.write(temp, text);
  await files.move(temp, main);
}

// ---------------------------------------------------------------------------------------------------------------
// The file's shape: written from known fields only, read back the same way
// ---------------------------------------------------------------------------------------------------------------

/**
 * The text of a queue, or a refusal. Only the queue's own fields are written, so nothing a caller attaches rides
 * along. It refuses a queue that names a scoring link's secret anywhere, and one this store could not read back (a
 * tap with no payload, a fractional count): the store never writes a file it would then report as garbled.
 */
function encodeQueue(queue: MatchQueue): string {
  const text = JSON.stringify({
    v: FILE_VERSION,
    fixtureId: queue.fixtureId,
    label: queue.label,
    pending: queue.pending.map(
      ({
        key,
        type,
        payload,
        rulesVersion,
        createdAt,
        stampedOn,
        attempts,
        voidsKey,
        base,
        reading,
      }): QueuedEvent => ({
        key,
        type,
        payload,
        rulesVersion,
        createdAt,
        ...(stampedOn === undefined ? {} : { stampedOn }),
        attempts,
        ...(voidsKey === undefined ? {} : { voidsKey }),
        ...(base === undefined ? {} : { base }),
        ...(reading === undefined ? {} : { reading }),
      }),
    ),
    ownEventIds: queue.ownEventIds,
    dead: queue.dead,
    ...(queue.askedAbout === undefined || queue.askedAbout.length === 0
      ? {}
      : { askedAbout: queue.askedAbout }),
    ...(queue.answeredSend === undefined || queue.answeredSend.length === 0
      ? {}
      : { answeredSend: queue.answeredSend }),
  });
  if (LINK_SECRET.test(text))
    throw new QueueSaveRefused('secret', 'a queue never carries a scoring link secret');
  if (decodeQueue(text, queue.fixtureId) === null)
    throw new QueueSaveRefused('readback', 'a queue that would not read back');
  return text;
}

function decodeQueue(text: string, fixtureId: string): MatchQueue | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== FILE_VERSION || raw.fixtureId !== fixtureId) return null;
  const pending = readList(raw.pending, readTap);
  const ownEventIds = readList(raw.ownEventIds, readText);
  const dead = readDead(raw.dead);
  const askedAbout = 'askedAbout' in raw ? readList(raw.askedAbout, readText) : [];
  const answeredSend = 'answeredSend' in raw ? readList(raw.answeredSend, readText) : [];
  if (typeof raw.label !== 'string' || pending === undefined) return null;
  if (ownEventIds === undefined || dead === undefined) return null;
  if (askedAbout === undefined || answeredSend === undefined) return null;
  const queue: MatchQueue = { fixtureId, label: raw.label, pending, ownEventIds, dead };
  return {
    ...queue,
    ...(askedAbout.length === 0 ? {} : { askedAbout }),
    ...(answeredSend.length === 0 ? {} : { answeredSend }),
  };
}

function readTap(raw: unknown): QueuedEvent | undefined {
  if (!isRecord(raw) || !('payload' in raw)) return undefined;
  const key = readText(raw.key);
  const type = readText(raw.type);
  const createdAt = readText(raw.createdAt);
  const rulesVersion = readWhole(raw.rulesVersion, 0);
  const attempts = readWhole(raw.attempts, 0);
  if (key === undefined || type === undefined || createdAt === undefined) return undefined;
  if (rulesVersion === undefined || attempts === undefined) return undefined;
  // A score count that is not a whole number reads as absent: the tap is the scorer's, and is kept without it.
  const base = readWhole(raw.base, 0);
  const reading = readReading(raw.reading);
  const tap: QueuedEvent = {
    key,
    type,
    payload: raw.payload,
    rulesVersion,
    createdAt,
    ...stampedOnOf(raw),
    attempts,
    ...(base === undefined ? {} : { base }),
    ...(reading === undefined ? {} : { reading }),
  };
  if (!('voidsKey' in raw)) return tap;
  const voidsKey = readText(raw.voidsKey);
  return voidsKey === undefined ? undefined : { ...tap, voidsKey };
}

/**
 * A joined sub's own clock reading (`QueuedEvent.reading`): a period and whole seconds, or absent when garbled. The tap is
 * the scorer's and is kept either way; without it the payload's stamp stands, as in a file written before it.
 */
function readReading(raw: unknown): TapReading | undefined {
  if (!isRecord(raw)) return undefined;
  const period = readText(raw.period);
  const elapsed = readWhole(raw.elapsed, 0);
  return period === undefined || elapsed === undefined ? undefined : { period, elapsed };
}

/** `null` is alive; a word is why not; anything else is garbled (`undefined`). */
function readDead(value: unknown): QueueDead | null | undefined {
  if (value === null) return null;
  return QUEUE_DEAD_WORDS.find((word) => word === value);
}

// ---------------------------------------------------------------------------------------------------------------
// The ledger cache: the events as fetched, from seq 1, so a reopened match asks only for what came after
// ---------------------------------------------------------------------------------------------------------------

/**
 * The text of a ledger, or a refusal: a ledger that is not 1, 2, 3, … in order (a hole, a repeat) would fold into a
 * match that never was, and one naming a link's secret is refused like a queue. Like the queue, it is only written if
 * it reads back.
 */
function encodeLedger(fixtureId: string, events: readonly LedgerEvent[]): string {
  const text = JSON.stringify({
    v: FILE_VERSION,
    fixtureId,
    events: events.map(
      ({ id, seq, type, payload, recordedAt, voids, deviceLinkId, stampedOn }): LedgerEvent => ({
        id,
        seq,
        type,
        payload,
        recordedAt,
        voids,
        deviceLinkId,
        ...(stampedOn === undefined ? {} : { stampedOn }),
      }),
    ),
  });
  if (LINK_SECRET.test(text)) throw new Error('a ledger never carries a scoring link secret');
  if (decodeLedger(text, fixtureId) === null) throw new Error('a ledger that would not read back');
  return text;
}

function decodeLedger(text: string, fixtureId: string): readonly LedgerEvent[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== FILE_VERSION || raw.fixtureId !== fixtureId) return null;
  const events = readList(raw.events, readLedgerEvent);
  if (events === undefined) return null;
  return events.every((event, i) => event.seq === i + 1) ? events : null;
}

function readLedgerEvent(raw: unknown): LedgerEvent | undefined {
  if (!isRecord(raw) || !('payload' in raw)) return undefined;
  const id = readText(raw.id);
  const seq = readWhole(raw.seq, 1);
  const type = readText(raw.type);
  const recordedAt = readText(raw.recordedAt);
  const voids = readNullableText(raw.voids);
  const deviceLinkId = readNullableText(raw.deviceLinkId);
  if (id === undefined || seq === undefined || type === undefined || recordedAt === undefined)
    return undefined;
  if (voids === undefined || deviceLinkId === undefined) return undefined;
  return {
    id,
    seq,
    type,
    payload: raw.payload,
    recordedAt,
    voids,
    deviceLinkId,
    ...stampedOnOf(raw),
  };
}

/**
 * The clock a tap's time, or a stand-in's, is on (ruling 149): `'server'` is the one mark there is. No mark, or anything
 * else, is this phone's own clock: what every file written before the ruling holds (v1.0.6 stamped on the wall clock),
 * and the record is kept either way, since it is the scorer's.
 */
const stampedOnOf = (raw: Record<string, unknown>): { stampedOn?: 'server' } =>
  raw.stampedOn === 'server' ? { stampedOn: 'server' } : {};

/** `null` is none; a non-empty string is itself; anything else is garbled (`undefined`). */
const readNullableText = (value: unknown): string | null | undefined =>
  value === null ? null : readText(value);

// ---------------------------------------------------------------------------------------------------------------
// The boot cache: the bootstrap as the endpoint sent it, the Start screen's pick and the pending picks
// ---------------------------------------------------------------------------------------------------------------

/**
 * The text of a boot cache, or a refusal. The bootstrap is written in the endpoint's own envelope, so `parseBootstrap`
 * reads it back and there is no second parser of that shape. Refused: one that is not this match's, one naming a
 * link's secret anywhere, and one this store could not read back.
 */
function encodeBoot(fixtureId: string, cache: BootCache): string {
  if (cache.bootstrap.fixtureId !== fixtureId)
    throw new Error('a boot cache holds its own match’s bootstrap');
  const text = JSON.stringify({
    v: FILE_VERSION,
    fixtureId,
    toss: cache.toss,
    picks: cache.picks,
    bootstrap: bootstrapToWire(cache.bootstrap),
  });
  if (LINK_SECRET.test(text)) throw new Error('a boot cache never carries a scoring link secret');
  if (decodeBoot(text, fixtureId) === null)
    throw new Error('a boot cache that would not read back');
  return text;
}

function decodeBoot(text: string, fixtureId: string): BootCache | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== FILE_VERSION || raw.fixtureId !== fixtureId) return null;
  const toss =
    raw.toss === 'first' || raw.toss === 'second' || raw.toss === null ? raw.toss : undefined;
  // A file written before picks were kept has none (the file's version is unchanged); garbled picks are no cache.
  const picks = raw.picks === undefined ? NO_PICKS : readPicks(raw.picks);
  const bootstrap = parseBootstrap(raw.bootstrap);
  if (toss === undefined || picks === undefined) return null;
  if (bootstrap === null || bootstrap.fixtureId !== fixtureId) return null;
  return { bootstrap, toss, picks };
}

// ---------------------------------------------------------------------------------------------------------------
// The kept ids: this phone's own taps in a match it left, for a day (owner ruling 46, 2026-11-03)
// ---------------------------------------------------------------------------------------------------------------

/** What a left match keeps: the event ids the server returned for this phone's taps, and when the match was left. */
type Kept = { readonly ownEventIds: readonly string[]; readonly leftAt: number };

/**
 * The text of a kept file, or a refusal. Like the queue, it names no link secret and is only written if it reads back
 * (at least one id, a whole stamp), so the store never writes a file it would then report as garbled.
 */
function encodeKept(fixtureId: string, ownEventIds: readonly string[], leftAt: number): string {
  const text = JSON.stringify({ v: FILE_VERSION, fixtureId, ownEventIds, leftAt });
  if (LINK_SECRET.test(text)) throw new Error('kept ids never carry a scoring link secret');
  if (decodeKept(text, fixtureId) === null) throw new Error('kept ids that would not read back');
  return text;
}

function decodeKept(text: string, fixtureId: string): Kept | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== FILE_VERSION || raw.fixtureId !== fixtureId) return null;
  const ownEventIds = readList(raw.ownEventIds, readText);
  const leftAt = readWhole(raw.leftAt, 0);
  if (ownEventIds === undefined || ownEventIds.length === 0 || leftAt === undefined) return null;
  return { ownEventIds, leftAt };
}
