import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import { matchSwitchKey } from '@/services/scoringMatchSwitches';

/**
 * A tennis match's "Point details" switch (S2-7 ruling 234, the owner's: "Off, switch to show"), on this phone, per match,
 * in the key-value store under `scoring.switch.pointDetails.{fixtureId}` (`scoringMatchSwitches`, which forgets it with
 * the match's link). Off by default and whenever it cannot be read: off, a point is `{by}` alone and sent at once (ruling
 * 217). Turned off, nothing is kept. No secret: the word `on` alone.
 */

/** A fixture id is a key as well: letters, digits, `_` and `-` (the secure store takes no more; `scoringLinkStore`'s rule). */
const FIXTURE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const ON = 'on';

const keyOf = (fixtureId: string): string => matchSwitchKey('pointDetails', fixtureId);

/**
 * Whether the switch is on for the match: false for a match never switched, or a store that does not answer (the secure
 * store refuses an id that is no key, which is the same answer). A store that does not answer is said in the record
 * (`scoring.point-details-not-read`), never silent: an off switch that was on shows no chips and would show no reason.
 */
export async function readPointDetails(
  kv: KeyValueStore,
  fixtureId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<boolean> {
  try {
    return (await kv.get(keyOf(fixtureId))) === ON;
  } catch {
    logger.warn('scoring.point-details-not-read');
    return false;
  }
}

/** Keeps the switch: on is the word, off is no entry. Rejects when the store refuses, or the id is no key. */
export async function savePointDetails(
  kv: KeyValueStore,
  fixtureId: string,
  on: boolean,
): Promise<void> {
  if (!FIXTURE_ID.test(fixtureId))
    throw new Error('a switch is kept under a fixture id fit for a key');
  if (on) await kv.set(keyOf(fixtureId), ON);
  else await kv.delete(keyOf(fixtureId));
}
