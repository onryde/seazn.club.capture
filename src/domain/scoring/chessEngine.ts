import { EngineError, foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { boardgame, type BoardgameCfg } from '@seazn/engine/sports/boardgame';

/**
 * The chess engine as the phone and its fake server both reach it (plan S2-3 Task 1), `tableTennisEngine`'s twin: the
 * match's config read through the engine's own schema and the server's judgement of one new event. Chess is the boardgame
 * module, not a set-based one, so it does not share `setBasedEngine`'s judge (whose module type is the set-based family's).
 * One copy: `foldChess` and the fake server both fold through here, so the phone and its fake can never judge an event
 * two ways.
 */

/** What the engine needs to fold a game: its id (every envelope names it), its config and its two lineups. */
export type ChessEngineMatch = {
  readonly fixtureId: string;
  readonly cfg: BoardgameCfg;
  readonly lineups: LineupPair;
};

/** The match's config through the engine's schema, which fills what the organiser left out. Throws on a garbled one. */
export const chessCfg = (raw: unknown): BoardgameCfg => boardgame.configSchema.parse(raw);

/** The same, or null for a config the schema refuses (the schema's refusal is all a throw can be). */
export function readChessCfg(raw: unknown): BoardgameCfg | null {
  try {
    return chessCfg(raw);
  } catch {
    return null;
  }
}

/**
 * The engine's word against the last of `events`, judged as the server judges an append (`strictFromSeq` at its seq,
 * everything before it replayed), or null when the engine takes it. Anything but the engine's own refusal is thrown.
 */
export function chessRefusalOf(
  match: ChessEngineMatch,
  events: readonly EventEnvelope[],
): string | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;
  try {
    foldMatch(boardgame, match.cfg, match.lineups, events, { strictFromSeq: last.seq });
    return null;
  } catch (error) {
    if (EngineError.is(error)) return error.code;
    throw error;
  }
}
