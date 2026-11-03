import { EngineError, foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { badminton, type SetBasedCfg } from '@seazn/engine/sports/setbased';

/**
 * The badminton engine as the phone and its fake server both reach it (plan S2-1 Task 7): the match's config read
 * through the engine's own schema and the server's judgement of one new event. The lineups and the envelopes are the
 * set-based sports' to share (`setBasedEngine`). One copy: `badmintonFold` and `fakeScoringPort` both fold through
 * here, so the phone and its fake can never judge an event two ways.
 */

/** What the engine needs to fold a match: its id (every envelope names it), its config and its two lineups. */
export type BadmintonEngineMatch = {
  readonly fixtureId: string;
  readonly cfg: SetBasedCfg;
  readonly lineups: LineupPair;
};

/** The match's config through the engine's schema, which fills what the organiser left out. Throws on a garbled one. */
export const badmintonCfg = (raw: unknown): SetBasedCfg => badminton.configSchema.parse(raw);

/**
 * The engine's word against the last of `events`, judged as the server judges an append (`strictFromSeq` at its seq,
 * everything before it replayed), or null when the engine takes it. Anything but the engine's own refusal is thrown.
 */
export function refusalOf(
  match: BadmintonEngineMatch,
  events: readonly EventEnvelope[],
): string | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;
  try {
    foldMatch(badminton, match.cfg, match.lineups, events, { strictFromSeq: last.seq });
    return null;
  } catch (error) {
    if (EngineError.is(error)) return error.code;
    throw error;
  }
}
