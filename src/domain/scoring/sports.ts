import { badmintonSport } from '@/domain/scoring/badmintonSport';
import type { BootCache } from '@/domain/scoring/queue';
import type { AnySport } from '@/domain/scoring/scoringSport';

/**
 * The sports this build scores, by the bootstrap's `sport_key`: a table, never a chain of conditions. A second sport
 * is one more row here, its own module beside `badmintonSport.ts`, and its own screen.
 */
const SPORTS: ReadonlyMap<string, AnySport> = new Map<string, AnySport>([
  [badmintonSport.key, badmintonSport],
]);

/** The sport a bootstrap's `sport_key` names, or null for one this build does not score. Own rows only. */
export function sportFor(sportKey: string): AnySport | null {
  return SPORTS.get(sportKey) ?? null;
}

/**
 * The sport a match opens as: the one its kept bootstrap names (the boot cache), when this build scores it. Nothing
 * else this phone keeps for a match names its sport (not the queue file, not the saved link, and the headless sender
 * never reads the bootstrap), so any other match opens as badminton, this build's one sport, as it always has; a
 * bootstrap that names another then reads `unsupportedSport`. Before a second sport is added here, the match must keep
 * its sport where the headless sender can read it (S2-2): the engine epoch and the send's payload are the sport's.
 */
export function sportOfMatch(boot: BootCache | null): AnySport {
  return (boot === null ? null : sportFor(boot.bootstrap.sportKey)) ?? badmintonSport;
}
