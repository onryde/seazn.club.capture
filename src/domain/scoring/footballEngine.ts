import type { EventEnvelope, LineupPair } from '@seazn/engine/core';
import { football, type FootballCfg } from '@seazn/engine/sports/football';
import { isRecord } from '@/domain/credentials/wire';
import { engineRefusalOf, type EngineRefusal } from '@/domain/scoring/engineRefusal';

/**
 * Football's engine input (S2-5 design §9): its config, and its two lineups built from the bootstrap's team sheets
 * (design §10) built by the shared `teamSheetOf` (the web's `buildLineup`), so the phone and the console fold the same
 * pitch. The ledger's envelopes are the generic ones (`envelopeOf`, `queuedEnvelopeOf` in
 * `setBasedEngine.ts`).
 */

/** What the engine needs to fold a football match: its id (every envelope names it), its config and its two lineups. */
export type FootballEngineMatch = {
  readonly fixtureId: string;
  readonly cfg: FootballCfg;
  readonly lineups: LineupPair;
};

/** The match's config through football's schema, or null for one it refuses (the schema's refusal is all a throw can be). */
export function footballCfg(raw: unknown): FootballCfg | null {
  try {
    return football.configSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The engine's word against the last of `events`, judged as the server judges an append (`engineRefusalOf`, the shared
 * judge), or null when the engine takes it: its code, and the `reason` its data names when it names one
 * (`sub-cap-reached`, the kernel's lineup verdicts).
 */
export const footballRefusalOf = (
  match: FootballEngineMatch,
  events: readonly EventEnvelope[],
): EngineRefusal | null => engineRefusalOf(football, match, events);

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
