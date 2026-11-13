import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { chessSport } from '@/domain/scoring/chessSport';
import { cricketSport } from '@/domain/scoring/cricketSport';
import { footballSport } from '@/domain/scoring/footballSport';
import type { AnySport } from '@/domain/scoring/scoringSport';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import { tennisSport } from '@/domain/scoring/tennisSport';
import { volleyballSport } from '@/domain/scoring/volleyballSport';

/**
 * The sports this build scores, by the bootstrap's `sport_key`: a table, never a chain of conditions. A sport is one
 * more row here, its own module beside `badmintonSport.ts`, and its own screen. A match is opened as the sport its
 * link was kept with (`scoringLinkStore`), looked up here by every runner, the headless sender included.
 */
const SPORTS: ReadonlyMap<string, AnySport> = new Map<string, AnySport>([
  [badmintonSport.key, badmintonSport],
  [tableTennisSport.key, tableTennisSport],
  [chessSport.key, chessSport],
  [cricketSport.key, cricketSport],
  [footballSport.key, footballSport],
  [volleyballSport.key, volleyballSport],
  [tennisSport.key, tennisSport],
]);

/** The sport a bootstrap's `sport_key` names, or null for one this build does not score. Own rows only. */
export function sportFor(sportKey: string): AnySport | null {
  return SPORTS.get(sportKey) ?? null;
}
