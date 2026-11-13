import type { EventEnvelope, LineupPair } from '@seazn/engine/core';
import { tennis } from '@seazn/engine/sports/tennis';
import { setBasedRefusalOf, type EngineMatch } from '@/domain/scoring/setBasedEngine';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import type { BootstrapSide } from '@/domain/scoring/wire';

/**
 * The tennis engine as the phone and its fake server both reach it (S2-7 Task 3), volleyball's twin
 * (`volleyballEngine`): the match's config through the engine's schema, the server's judgement of one new event and a
 * side's lineup as the web builds it. One copy: the fold and the fake server both go through here.
 */

/** The match's config as the schema writes it. The engine does not export its `NestedParams`, so the type is the schema's output. */
export type TennisCfg = ReturnType<typeof tennis.configSchema.parse>;

/** What the engine needs to fold a tennis match: its id (every envelope names it), its config and its two lineups. */
export type TennisEngineMatch = EngineMatch<TennisCfg>;

/** The match's config through the engine's schema, which fills what the organiser left out; null for one it refuses. */
export function tennisCfgOf(raw: unknown): TennisCfg | null {
  try {
    return tennis.configSchema.parse(raw);
  } catch {
    return null;
  }
}

/** The engine's word against the last of `events` (see `setBasedRefusalOf`), or null when the engine takes it. */
export const tennisRefusalOf = (
  match: TennisEngineMatch,
  events: readonly EventEnvelope[],
): string | null => setBasedRefusalOf(tennis, match, events);

/**
 * A tennis side's lineup for the engine, field for field as the web's `buildLineup` writes it (`server/engine-db/
 * lineups.ts`, which has no sport case: Task 1 read it): the team sheet's slots (`teamSheetOf`), each with the pair
 * order the bootstrap row carries, only when the row has one. The team sheet builder has none (it is cricket's and
 * football's), so tennis, like volleyball, adds it.
 */
export function tennisLineupOf(side: BootstrapSide): LineupPair['home'] {
  const { lineup } = teamSheetOf(side);
  return {
    entrantId: lineup.entrantId,
    slots: lineup.slots.map((slot, i) => {
      const pairOrder = side.lineup[i]?.pairOrder;
      return pairOrder === null || pairOrder === undefined ? slot : { ...slot, pairOrder };
    }),
  };
}
