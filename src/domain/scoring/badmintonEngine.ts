import type { EventEnvelope } from '@seazn/engine/core';
import { badminton, type SetBasedCfg } from '@seazn/engine/sports/setbased';
import { setBasedRefusalOf, type SetBasedEngineMatch } from '@/domain/scoring/setBasedEngine';

/**
 * The badminton engine as the phone and its fake server both reach it (plan S2-1 Task 7): the match's config read
 * through the engine's own schema and the server's judgement of one new event. The lineups, the envelopes and the
 * judgement itself are the set-based sports' to share (`setBasedEngine`); this names the sport's module. One copy:
 * `badmintonFold` and `fakeScoringPort` both fold through here, so the phone and its fake can never judge an event two
 * ways.
 */

/** What the engine needs to fold a match: its id (every envelope names it), its config and its two lineups. */
export type BadmintonEngineMatch = SetBasedEngineMatch;

/** The match's config through the engine's schema, which fills what the organiser left out. Throws on a garbled one. */
export const badmintonCfg = (raw: unknown): SetBasedCfg => badminton.configSchema.parse(raw);

/** The engine's word against the last of `events` (see `setBasedRefusalOf`), or null when the engine takes it. */
export const refusalOf = (
  match: BadmintonEngineMatch,
  events: readonly EventEnvelope[],
): string | null => setBasedRefusalOf(badminton, match, events);
