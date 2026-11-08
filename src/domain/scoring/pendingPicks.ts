import { isRecord } from '@/domain/credentials/wire';

/**
 * Pending picks (S2-4 spec §6, plan Task 3): choices the scorer makes that the server records only when a later tap
 * carries them, such as cricket's batting order, its openers and the next over's bowler. They are kept with the queue
 * (the boot cache, `tapQueueStore`), so a process death between an over's end and its first ball loses none of them.
 *
 * Generic: a key is the sport's own (cricket's `bowler.i1.3`), and each names a list of person ids. Picks are never
 * sent and never written to the record. A sport reads them in its fold (`SportFoldInput.picks`).
 */
export type PendingPicks = Readonly<Record<string, readonly string[]>>;

/** No picks: a match that has none, and a boot file written before picks were kept. */
export const NO_PICKS: PendingPicks = Object.freeze({});

/** A key: a lowercase letter, then letters, digits and dots, at most 64 characters in all. */
const KEY = /^[a-z][A-Za-z0-9.]{0,63}$/;
const MAX_KEYS = 32;
const MAX_IDS = 64;
const MAX_ID_LENGTH = 64;

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= MAX_IDS && value.every(isId);

/**
 * The one reader of kept picks: a map of keys to lists of ids within the limits above, or `undefined` for anything
 * else (garbled). A boot file whose picks are garbled is no boot file: half a set of picks is worse than none.
 */
export function readPicks(raw: unknown): PendingPicks | undefined {
  if (!isRecord(raw)) return undefined;
  const entries = Object.entries(raw);
  if (entries.length > MAX_KEYS) return undefined;
  const picks: Record<string, readonly string[]> = {};
  for (const [key, ids] of entries) {
    if (!KEY.test(key) || !isIdList(ids)) return undefined;
    picks[key] = [...ids];
  }
  return picks;
}

const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((id, i) => id === b[i]);

/** The same picks: the same keys, each with the same ids in the same order. */
export function samePicks(a: PendingPicks, b: PendingPicks): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameIds(a[key], b[key]));
}
