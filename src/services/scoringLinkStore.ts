import { isRecord } from '@/domain/credentials/wire';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { isBuildOrigin } from '@/services/seaznHosts';
import type { ScoringLink } from '@/services/scoringPort';

/**
 * A match's scoring link, `{origin, token}`, in the secure store under `scoring.link.{fixtureId}` (design §6.3; plan
 * S2-1 Task 5). The token lives nowhere else: not in the queue file, the boot cache, a log line or the record. Task 10
 * writes it when a code is saved; the match hook reads it; Dismiss forgets it with the queue.
 *
 * The match's sport is kept with it (`sportKey`, the bootstrap's `sport_key` at the scan; owner, 2026-11-02: "pad per
 * sport must"), because the link is the one file every runner reads first, focused or headless, before any bootstrap:
 * the queue file is not written until a tap, the boot cache is not read by the headless sender, and the saved code
 * names only the saved match, not a leftover still sending. The sport is no secret; it is here only for that reason.
 *
 * A link is kept and read only for the build's own host (`isBuildOrigin`, the rule the fetch port keeps at call time):
 * a link for any other origin is no link, so its token is never sent, and never opened in a browser, anywhere else.
 */

/** A fixture id is a key as well as a file name: letters, digits, `_` and `-` (the secure store takes no more). */
const FIXTURE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export const scoringLinkKey = (fixtureId: string): string => `scoring.link.${fixtureId}`;

/**
 * The sport of a link kept before the sport was kept with it (before 2026-11-02): a badminton match, the one sport this
 * phone scored then. Read here and nowhere else; a link saved since always names its sport.
 */
const SPORT_BEFORE_IT_WAS_KEPT = 'badminton';

/** `none`: no link, or one that does not read; `failed`: the store did not answer, which says nothing of the link. */
export type StoredLink =
  | { readonly kind: 'link'; readonly link: ScoringLink; readonly sportKey: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

export async function readScoringLink(
  kv: KeyValueStore,
  fixtureId: string,
  host: string,
): Promise<StoredLink> {
  if (!FIXTURE_ID.test(fixtureId)) return { kind: 'none' };
  let text: string | null;
  try {
    text = await kv.get(scoringLinkKey(fixtureId));
  } catch {
    return { kind: 'failed' };
  }
  const kept = text === null ? null : decode(text, host);
  return kept === null ? { kind: 'none' } : { kind: 'link', ...kept };
}

type Kept = { readonly link: ScoringLink; readonly sportKey: string };

function decode(text: string, host: string): Kept | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.origin !== 'string' || typeof raw.token !== 'string')
    return null;
  const sportKey = 'sportKey' in raw ? raw.sportKey : SPORT_BEFORE_IT_WAS_KEPT;
  if (typeof sportKey !== 'string' || sportKey === '') return null;
  return isBuildOrigin(raw.origin, host) && raw.token !== ''
    ? { link: { origin: raw.origin, token: raw.token }, sportKey }
    : null;
}

/**
 * Keeps a match's link with its sport. Rejects when the store refuses, the id is no key, the link has no token or no
 * sport, or it is for another host than the build's.
 */
export async function saveScoringLink(
  kv: KeyValueStore,
  fixtureId: string,
  link: ScoringLink,
  host: string,
  sportKey: string,
): Promise<void> {
  if (!FIXTURE_ID.test(fixtureId))
    throw new Error('a scoring link is kept under a fixture id fit for a key');
  if (!isBuildOrigin(link.origin, host))
    throw new Error('a scoring link is kept only for the build’s own host');
  if (link.token === '') throw new Error('a scoring link is kept only with a token');
  if (sportKey === '') throw new Error('a scoring link is kept only with its match’s sport');
  await kv.set(
    scoringLinkKey(fixtureId),
    JSON.stringify({ origin: link.origin, token: link.token, sportKey }),
  );
}

/** Rejects when the store refuses. A match with no link is not a failure. */
export async function forgetScoringLink(kv: KeyValueStore, fixtureId: string): Promise<void> {
  if (FIXTURE_ID.test(fixtureId)) await kv.delete(scoringLinkKey(fixtureId));
}
