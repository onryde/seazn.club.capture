import { isRecord } from '@/domain/credentials/wire';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { ScoringLink } from '@/services/scoringPort';

/**
 * A match's scoring link, `{origin, token}`, in the secure store under `scoring.link.{fixtureId}` (design §6.3; plan
 * S2-1 Task 5). The token lives nowhere else: not in the queue file, the boot cache, a log line or the record. Task 10
 * writes it when a code is saved; the match hook reads it; Dismiss forgets it with the queue.
 */

/** A fixture id is a key as well as a file name: letters, digits, `_` and `-` (the secure store takes no more). */
const FIXTURE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const HTTPS_ORIGIN = /^https:\/\/[^/\s]+$/;

export const scoringLinkKey = (fixtureId: string): string => `scoring.link.${fixtureId}`;

/** `none`: no link, or one that does not read; `failed`: the store did not answer, which says nothing of the link. */
export type StoredLink =
  | { readonly kind: 'link'; readonly link: ScoringLink }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

export async function readScoringLink(kv: KeyValueStore, fixtureId: string): Promise<StoredLink> {
  if (!FIXTURE_ID.test(fixtureId)) return { kind: 'none' };
  let text: string | null;
  try {
    text = await kv.get(scoringLinkKey(fixtureId));
  } catch {
    return { kind: 'failed' };
  }
  const link = text === null ? null : decode(text);
  return link === null ? { kind: 'none' } : { kind: 'link', link };
}

function decode(text: string): ScoringLink | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.origin !== 'string' || typeof raw.token !== 'string')
    return null;
  return HTTPS_ORIGIN.test(raw.origin) && raw.token !== ''
    ? { origin: raw.origin, token: raw.token }
    : null;
}

/** Rejects when the store refuses, or the id is no key. */
export async function saveScoringLink(
  kv: KeyValueStore,
  fixtureId: string,
  link: ScoringLink,
): Promise<void> {
  if (!FIXTURE_ID.test(fixtureId))
    throw new Error('a scoring link is kept under a fixture id fit for a key');
  await kv.set(
    scoringLinkKey(fixtureId),
    JSON.stringify({ origin: link.origin, token: link.token }),
  );
}

/** Rejects when the store refuses. A match with no link is not a failure. */
export async function forgetScoringLink(kv: KeyValueStore, fixtureId: string): Promise<void> {
  if (FIXTURE_ID.test(fixtureId)) await kv.delete(scoringLinkKey(fixtureId));
}
