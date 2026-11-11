import type { EventEnvelope } from '@seazn/engine/core';
import { volleyball, type SetBasedCfg } from '@seazn/engine/sports/setbased';
import { setBasedRefusalOf, type SetBasedEngineMatch } from '@/domain/scoring/setBasedEngine';

/**
 * The volleyball engine as the phone and its fake server both reach it (S2-6 Task 2), table tennis's twin
 * (`tableTennisEngine`): the match's config through the engine's schema, the server's judgement of one new event, and
 * which variant a config is. One copy: the fold and the fake server both go through here.
 */

/** What the engine needs to fold a match: its id (every envelope names it), its config and its two lineups. */
export type VolleyballEngineMatch = SetBasedEngineMatch;

/** The match's config through the engine's schema, which fills what the organiser left out. Throws on a garbled one. */
export const volleyballCfg = (raw: unknown): SetBasedCfg => volleyball.configSchema.parse(raw);

/** The engine's word against the last of `events` (see `setBasedRefusalOf`), or null when the engine takes it. */
export const volleyballRefusalOf = (
  match: VolleyballEngineMatch,
  events: readonly EventEnvelope[],
): string | null => setBasedRefusalOf(volleyball, match, events);

/**
 * Beach, not indoor: a pair has no bench, so beach records no substitutions. The engine's own test (7.0.0's config has no
 * variant field, and an organiser may set any `bestOf` on a beach fixture), so never read `bestOf` or `setTo` here.
 */
export const isBeach = (cfg: SetBasedCfg): boolean => !cfg.records.substitutions;
