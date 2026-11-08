import type { ComponentType } from 'react';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { chessSport } from '@/domain/scoring/chessSport';
import { cricketSport } from '@/domain/scoring/cricketSport';
import { footballSport } from '@/domain/scoring/footballSport';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import { BadmintonMatchScreen } from '@/ui/screens/BadmintonMatchScreen';
import { ChessMatchScreen } from '@/ui/screens/ChessMatchScreen';
import { CricketMatchScreen } from '@/ui/screens/CricketMatchScreen';
import { FootballMatchScreen } from '@/ui/screens/FootballMatchScreen';
import { TableTennisMatchScreen } from '@/ui/screens/TableTennisMatchScreen';

/** A sport's screen for a match it scores: its pad, and whatever it needs of the states every sport shares. */
export type SportScreen = ComponentType<{ readonly fixtureId: string }>;

/**
 * The screens, by the sport they draw (owner ruling 38, 2026-11-02: pad per sport, never one pad with conditions): a
 * table, as the sports' own (`sports.ts`). Each further sport is one more row here and its own screen file; the route and
 * the states every sport shares name neither. A sport the runtime scores that has no row here is told to the operator
 * as a sport the phone cannot score yet, never drawn by another sport's pad.
 */
const SCREENS: ReadonlyMap<string, SportScreen> = new Map<string, SportScreen>([
  [badmintonSport.key, BadmintonMatchScreen],
  [tableTennisSport.key, TableTennisMatchScreen],
  [chessSport.key, ChessMatchScreen],
  [cricketSport.key, CricketMatchScreen],
  [footballSport.key, FootballMatchScreen],
]);

export function screenFor(sportKey: string): SportScreen | null {
  return SCREENS.get(sportKey) ?? null;
}
