import type { EventEnvelope } from '@seazn/engine/core';
import { boardgame, type BoardgameCfg } from '@seazn/engine/sports/boardgame';
import { setBasedRefusalOf, type EngineMatch } from '@/domain/scoring/setBasedEngine';

/**
 * The chess engine as the phone and its fake server both reach it (plan S2-3 Task 1), `tableTennisEngine`'s twin: the
 * match's config read through the engine's own schema and the server's judgement of one new event, which is
 * `setBasedRefusalOf` over the boardgame module (that judge takes any engine module). One copy: `foldChess` and the fake
 * server both fold through here, so the phone and its fake can never judge an event two ways.
 */

/** What the engine needs to fold a game: its id (every envelope names it), its config and its two lineups. */
export type ChessEngineMatch = EngineMatch<BoardgameCfg>;

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

/** The engine's word against the last of `events` (see `setBasedRefusalOf`), or null when the engine takes it. */
export const chessRefusalOf = (
  match: ChessEngineMatch,
  events: readonly EventEnvelope[],
): string | null => setBasedRefusalOf(boardgame, match, events);
