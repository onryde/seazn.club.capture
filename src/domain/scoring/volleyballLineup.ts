import type { LineupPair } from '@seazn/engine/core';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import type { BootstrapSide } from '@/domain/scoring/wire';

/**
 * A volleyball side's lineup for the engine (S2-6 ruling 186): the team sheet's slots (`teamSheetOf`), each with the
 * pair order the bootstrap row carries, field for field as the web's `buildLineup` writes it (`server/engine-db/
 * lineups.ts`: `pairOrder` only when the row has one). The team sheet builder has none (it is cricket's and
 * football's); the engine names a beach server from `pairOrder` (`serverFromPairOrder`), so volleyball's own copy adds it.
 */
export function volleyballLineupOf(side: BootstrapSide): LineupPair['home'] {
  const { lineup } = teamSheetOf(side);
  return {
    entrantId: lineup.entrantId,
    slots: lineup.slots.map((slot, i) => {
      const pairOrder = side.lineup[i]?.pairOrder;
      return pairOrder === null || pairOrder === undefined ? slot : { ...slot, pairOrder };
    }),
  };
}
