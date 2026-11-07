import { doneOfTap } from '@/domain/scoring/chessLedgerHistory';
import {
  advancerOf,
  type ChessDecider,
  type ChessDone,
  type ChessMethod,
  type ChessPadKey,
  type ChessTap,
} from '@/domain/scoring/chessTypes';
import type { PadHistoryGroup, PadSide, PadText } from '@/domain/scoring/padView';
import { setBasedHistory, type SetBasedHistoryEntry } from '@/domain/scoring/setBasedHistory';

type Text = PadText<ChessPadKey>;

/** The seats' names as the organiser typed them. */
type Names = Readonly<Record<PadSide, string>>;

/**
 * One entry on the game's sheet as whoever keeps the score recorded it (S2's ledger fold): what it did, whether this
 * phone recorded it, whether Undo took it back, and whether it is this phone's tap still on its way to the server. A chess
 * game has one game and no points, so `game` is 1 and `after` is nothing (`CHESS_FACTS`).
 */
export type ChessHistoryEntry = SetBasedHistoryEntry<ChessDone>;

/**
 * History (view only), the shape the set-based sports' is, for one game: its events newest first, an entry Undo took back
 * in its place, struck. No score on a row. Nothing recorded, no group. The grouping is `setBasedHistory`'s; the words are
 * chess's.
 */
export function chessHistory(
  entries: readonly ChessHistoryEntry[],
  names: Names,
): readonly PadHistoryGroup<ChessPadKey>[] {
  return setBasedHistory<ChessDone, ChessPadKey>(entries, {
    heading: () => ({ key: 'scoring.chess.gameHeading' }),
    said: (did) => doneSaid(names, did),
    scored: () => false,
  });
}

/** A method's word: the engine's name for it, under its own key. */
const how = (method: ChessMethod): Text => ({ key: `scoring.chess.method.${method}` });

/**
 * What an event did, in the last-tap line's words ("A. Sharma won · Checkmate", "Drawn · Agreement"): the line says it of
 * the last tap, and History of every one, in the one vocabulary. A method is said only when one was chosen. A tie-break names
 * the player it sent through and its rung, never the score; the organiser's drawing of lots, the player and "by lot" (ruling 63b).
 */
export function doneSaid(names: Names, did: ChessDone): Text {
  switch (did.kind) {
    case 'start':
      return { key: 'scoring.chess.last.start' };
    case 'swap':
      return { key: 'scoring.chess.last.swap' };
    case 'result':
      return did.winner === null ? drawnSaid(did.method) : wonSaid(names[did.winner], did.method);
    case 'tiebreak':
      return advancesSaid(names[advancerOf(did)], did.rung);
    case 'lots':
      return advancesSaid(names[did.advances], 'lots');
  }
}

/** "A. Sharma advances · Rapid": the player a tie-break sent through, and the rung that did ("by lot" for the organiser's lots). */
export const advancesSaid = (name: string, rung: ChessDecider): Text => ({
  key: 'scoring.chess.tiebreak.advances',
  vars: { name, how: { key: `scoring.chess.tiebreak.rung.${rung}` } },
});

function wonSaid(name: string, method: ChessMethod | null): Text {
  return method === null
    ? { key: 'scoring.chess.last.won', vars: { name } }
    : { key: 'scoring.chess.last.wonBy', vars: { name, how: how(method) } };
}

function drawnSaid(method: ChessMethod | null): Text {
  return method === null
    ? { key: 'scoring.chess.last.drawn' }
    : { key: 'scoring.chess.last.drawnBy', vars: { how: how(method) } };
}

/**
 * The line after an Undo took a tap back: "Undone" and the tap in its own words. A result names the player in the seat the
 * tap named.
 */
export function undoneSaid(names: Names, tap: ChessTap): Text {
  return {
    key: 'scoring.chess.last.undone',
    vars: { what: doneSaid(names, doneOfTap(tap)) },
  };
}
