import type { LineupPair } from '@seazn/engine/core';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';

/**
 * A side's team sheet as the engine's lineup (S2-4 plan Task 2; S2-5 design §10), the one builder for the team sports
 * (cricket and football; preflight F2). Each row is the web's server's (`server/engine-db/lineups.ts` `buildLineup`),
 * so the phone and the console fold the same side.
 *
 * The rows keep the bootstrap's order and are never re-sorted. The server walks a side `order_no nulls last, full_name,
 * person_id` (web #1135), and the bootstrap sends that order, so a row with no `orderNo` is numbered by its place in it
 * (spec §6 as amended, preflight F1): a different order is a different batting order, and the server refuses the ball.
 *
 * The set-based sports keep their own builder (`setBasedEngine.ts` `lineupOf`, which carries the pair order): this one
 * has none (preflight F3).
 */

type Lineup = LineupPair['home'];
type Slot = Lineup['slots'][number];

/** A side's lineup for the engine, and whether it came with a team sheet. */
export type TeamSheet = { readonly lineup: Lineup; readonly sheet: boolean };

/**
 * Rows with a `slot` are the sheet, each row as `buildLineup` writes it. Rows with none (a web older than the team
 * sheet) are every row starting, in the order listed, and `sheet` is false. No rows: no slots, no sheet.
 */
export function teamSheetOf(side: BootstrapSide): TeamSheet {
  const sheet = side.lineup.some((row) => row.slot !== undefined);
  const slots = side.lineup.map((row, i) => (sheet ? sheetSlot(row, i) : startingSlot(row, i)));
  return { lineup: { entrantId: side.entrantId, slots }, sheet };
}

/**
 * One team-sheet row, field for field as `buildLineup`: the order the sheet gives, else the row's place from 1; a
 * position, roles and a shirt number when the sheet has them; the role only when it is not a player's (the engine reads
 * no role as a player). A row with no slot among rows that have one starts, as a sheetless row does.
 */
function sheetSlot(row: BootstrapSlot, i: number): Slot {
  return {
    personId: row.personId,
    slot: row.slot ?? 'starting',
    orderNo: row.orderNo ?? i + 1,
    ...(row.positionKey === undefined ? {} : { positionKey: row.positionKey }),
    ...(row.roles === undefined ? {} : { roles: [...row.roles] }),
    ...(row.role === undefined || row.role === 'player' ? {} : { role: row.role }),
    ...(row.squadNumber === undefined ? {} : { squadNumber: row.squadNumber }),
  };
}

const startingSlot = (row: BootstrapSlot, i: number): Slot => ({
  personId: row.personId,
  slot: 'starting',
  orderNo: i + 1,
});
