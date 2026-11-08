import { EngineError, foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { football, type FootballCfg } from '@seazn/engine/sports/football';
import { isRecord } from '@/domain/credentials/wire';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';

/**
 * Football's engine input (S2-5 design §9): its config, and its two lineups built from the bootstrap's team sheets
 * (design §10) as the web's server fold builds them (`server/engine-db/lineups.ts` `buildLineup`), so the phone and the
 * console fold the same pitch. The ledger's envelopes are the generic ones (`envelopeOf`, `queuedEnvelopeOf` in
 * `setBasedEngine.ts`); the set-based sports' lineups (`lineupOf`) are not football's and are not touched.
 */

/** What the engine needs to fold a football match: its id (every envelope names it), its config and its two lineups. */
export type FootballEngineMatch = {
  readonly fixtureId: string;
  readonly cfg: FootballCfg;
  readonly lineups: LineupPair;
};

type Lineup = LineupPair['home'];
type Slot = Lineup['slots'][number];

/** The match's config through football's schema, or null for one it refuses (the schema's refusal is all a throw can be). */
export function footballCfg(raw: unknown): FootballCfg | null {
  try {
    return football.configSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * A side's lineup for the engine, and whether it came with a team sheet. Rows with a `slot` are the sheet: each as the
 * web's `buildLineup` writes it. Rows with none (a web older than design §10) are every row starting, in the order
 * listed, so a goal the console names a player for still folds on the phone (design §9); `sheet` is false, and the pad
 * shows the team only (§6.6). No rows: no slots, no sheet.
 *
 * The rows are kept in the order they arrive, never sorted again: the web's bootstrap sends them in `buildLineup`'s
 * order (`order_no` nulls last, `full_name`, `person_id`), and a row with no order is numbered by its place in it (the
 * controller's ruling, 2026-11-08, agreed with S2-4). Nothing here is football's but the name: the builder reads only
 * the bootstrap's rows and the engine's slot, so it can move to a shared team-sheet module when cricket adds one.
 */
export function footballLineupOf(side: BootstrapSide): { lineup: Lineup; sheet: boolean } {
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

/**
 * The engine's word against the last of `events`, judged as the server judges an append (`strictFromSeq` at its seq,
 * everything before it replayed), or null when the engine takes it: its code, and the `reason` its data names when it
 * names one (`sub-cap-reached`, the kernel's lineup verdicts). Anything but the engine's own refusal is thrown.
 */
export function footballRefusalOf(
  match: FootballEngineMatch,
  events: readonly EventEnvelope[],
): { code: string; reason: string | null } | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;
  try {
    foldMatch(football, match.cfg, match.lineups, events, { strictFromSeq: last.seq });
    return null;
  } catch (error) {
    if (!EngineError.is(error)) throw error;
    return { code: error.code, reason: reasonOf(error.data) };
  }
}

const reasonOf = (data: unknown): string | null =>
  isRecord(data) && typeof data.reason === 'string' ? data.reason : null;

/**
 * The words an event's enum field takes, read from the engine's own schema (`eventSchemas[type].shape[field].options`)
 * so a word the engine adds reaches the pad with no copy to update. Each step is checked, never assumed: a schema of
 * another shape answers no words.
 */
export function footballOptions(type: 'football.shot', field: 'outcome'): readonly string[] {
  const schema: unknown = football.eventSchemas?.[type];
  const shape: unknown = isRecord(schema) ? schema.shape : undefined;
  const enumSchema: unknown = isRecord(shape) ? shape[field] : undefined;
  const options: unknown = isRecord(enumSchema) ? enumSchema.options : undefined;
  if (!Array.isArray(options)) return [];
  return options.every((option): option is string => typeof option === 'string') ? options : [];
}
