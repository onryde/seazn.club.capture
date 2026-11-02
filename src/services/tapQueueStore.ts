import { isRecord } from '@/domain/credentials/wire';
import {
  QUEUE_DEAD_WORDS,
  type MatchQueue,
  type QueueDead,
  type QueuedEvent,
} from '@/domain/scoring/queue';
import { readList, readText, readWhole } from '@/domain/scoring/wire';
import type { Logger } from '@/services/logger';

/** The queue's shapes live in the domain, which `sync.ts` reads; callers may take them from here too. */
export type { MatchQueue, QueueDead, QueuedEvent } from '@/domain/scoring/queue';

/**
 * The queue's durable store (design §6.3, plan S2-1 Task 5): one small JSON file per match, so a tap made at once
 * survives the app being killed before its send. Not the secure store: the queue holds no secret, and that store is
 * the wrong place for a growing list. The scoring link's token never comes here: `encode` refuses a queue that
 * carries one, wherever it hides.
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
  /** Moves a file onto another name, replacing it, in one step: never half done. */
  move(from: string, to: string): Promise<void>;
  /** Deletes a file; one that is not there is not a failure. */
  remove(name: string): Promise<void>;
}

/** What Home's Continue card and the match hook keep of unsent taps. Methods never reject but `save` and `remove`. */
export interface TapQueueStore {
  /** Every match with a queue, by fixture id; one that cannot be read is left out and reported once. */
  list(): Promise<readonly MatchQueue[]>;
  /** A match's queue, or null when it has none or it cannot be read (reported once, never thrown). */
  load(fixtureId: string): Promise<MatchQueue | null>;
  /**
   * Atomic: the whole queue is written to a temporary file and moved over the old one, so a save cut short leaves
   * the old file whole. Rejects when it could not be written, so the caller never shows a tap as stored that is not.
   */
  save(queue: MatchQueue): Promise<void>;
  /** Deletes a match's queue (Dismiss). Rejects when the disk refuses; a match with no queue is not a failure. */
  remove(fixtureId: string): Promise<void>;
}

const FILE_VERSION = 1;
/** A fixture id is a file name: letters, digits, `_` and `-` only, so no id can name another folder or a temp file. */
const FIXTURE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const QUEUE_FILE = /^([A-Za-z0-9_-]{1,100})\.json$/;
/** The shape of a scoring link's secret (`dl_` and base64url), matched loosely: better a refusal than a leak. */
const LINK_SECRET = /dl_[A-Za-z0-9_-]{20,}/;
/** The key a folder-level failure is reported under: no file name can be empty. */
const FOLDER = '';

const fileName = (fixtureId: string): string => `${fixtureId}.json`;
const tempName = (fixtureId: string): string => `${fileName(fixtureId)}.tmp`;

export function createTapQueueStore(deps: { files: QueueFiles; logger: Logger }): TapQueueStore {
  const { files, logger } = deps;
  const inOrder = serially();
  const reported = new Set<string>();
  const report = (name: string, problem: string): void => {
    if (reported.has(name)) return;
    reported.add(name);
    logger.warn('scoring.queue.unreadable', { problem });
  };
  const readable = (name: string): void => {
    reported.delete(name);
  };
  return {
    list: () => inOrder(() => listQueues(files, report, readable)),
    load: (fixtureId) =>
      FIXTURE_ID.test(fixtureId)
        ? inOrder(() => readQueue(files, fixtureId, report, readable))
        : Promise.resolve(null),
    save: (queue) =>
      inOrder(async () => {
        await writeQueue(files, queue);
        readable(fileName(queue.fixtureId));
      }),
    remove: (fixtureId) =>
      FIXTURE_ID.test(fixtureId)
        ? inOrder(async () => {
            await files.remove(fileName(fixtureId));
            await files.remove(tempName(fixtureId));
            readable(fileName(fixtureId));
          })
        : Promise.resolve(),
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

type Report = (name: string, problem: string) => void;

async function listQueues(
  files: QueueFiles,
  report: Report,
  readable: (name: string) => void,
): Promise<readonly MatchQueue[]> {
  let names: readonly string[];
  try {
    names = await files.names();
  } catch {
    report(FOLDER, 'folder');
    return [];
  }
  readable(FOLDER);
  const ids = names.flatMap((name) => QUEUE_FILE.exec(name)?.[1] ?? []).sort();
  const queues: MatchQueue[] = [];
  for (const id of ids) {
    const queue = await readQueue(files, id, report, readable);
    if (queue !== null) queues.push(queue);
  }
  return queues;
}

async function readQueue(
  files: QueueFiles,
  fixtureId: string,
  report: Report,
  readable: (name: string) => void,
): Promise<MatchQueue | null> {
  const name = fileName(fixtureId);
  let text: string | null;
  try {
    text = await files.read(name);
  } catch {
    report(name, 'read');
    return null;
  }
  if (text === null) return null;
  const queue = decode(text, fixtureId);
  if (queue === null) report(name, 'garbled');
  else readable(name);
  return queue;
}

async function writeQueue(files: QueueFiles, queue: MatchQueue): Promise<void> {
  if (!FIXTURE_ID.test(queue.fixtureId))
    throw new Error('a queue needs a fixture id fit for a file name');
  const text = encode(queue);
  await files.write(tempName(queue.fixtureId), text);
  await files.move(tempName(queue.fixtureId), fileName(queue.fixtureId));
}

// ---------------------------------------------------------------------------------------------------------------
// The file's shape: written from known fields only, read back the same way
// ---------------------------------------------------------------------------------------------------------------

/**
 * The text of a queue, or a refusal. Only the queue's own fields are written, so nothing a caller attaches rides
 * along. It refuses a queue that names a scoring link's secret anywhere, and one this store could not read back (a
 * tap with no payload, a fractional count): the store never writes a file it would then report as garbled.
 */
function encode(queue: MatchQueue): string {
  const text = JSON.stringify({
    v: FILE_VERSION,
    fixtureId: queue.fixtureId,
    label: queue.label,
    pending: queue.pending.map(
      ({ key, type, payload, rulesVersion, createdAt, attempts }): QueuedEvent => ({
        key,
        type,
        payload,
        rulesVersion,
        createdAt,
        attempts,
      }),
    ),
    ownEventIds: queue.ownEventIds,
    dead: queue.dead,
  });
  if (LINK_SECRET.test(text)) throw new Error('a queue never carries a scoring link secret');
  if (decode(text, queue.fixtureId) === null) throw new Error('a queue that would not read back');
  return text;
}

function decode(text: string, fixtureId: string): MatchQueue | null {
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
  if (typeof raw.label !== 'string' || pending === undefined) return null;
  if (ownEventIds === undefined || dead === undefined) return null;
  return { fixtureId, label: raw.label, pending, ownEventIds, dead };
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
  return { key, type, payload: raw.payload, rulesVersion, createdAt, attempts };
}

/** `null` is alive; a word is why not; anything else is garbled (`undefined`). */
function readDead(value: unknown): QueueDead | null | undefined {
  if (value === null) return null;
  return QUEUE_DEAD_WORDS.find((word) => word === value);
}
