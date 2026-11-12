import type { KeyValueStore } from '@/services/KeyValueStore';

/**
 * The switches a scorer sets for one match on this phone (S2-7 ruling 234: tennis's Point details), in the key-value
 * store under `scoring.switch.{name}.{fixtureId}`. A switch is the phone's own and no secret. It goes with its match's
 * link (`forgetScoringLink`), on every path that forgets one, so nothing is kept for a match the phone no longer holds.
 */
export type MatchSwitch = 'pointDetails';

const SWITCHES: readonly MatchSwitch[] = ['pointDetails'];

export const matchSwitchKey = (name: MatchSwitch, fixtureId: string): string =>
  `scoring.switch.${name}.${fixtureId}`;

/** Deletes every switch kept for the match. Rejects when the store refuses. */
export async function forgetMatchSwitches(kv: KeyValueStore, fixtureId: string): Promise<void> {
  for (const name of SWITCHES) await kv.delete(matchSwitchKey(name, fixtureId));
}
