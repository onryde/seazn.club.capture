import { foldEpochOf } from '@seazn/engine/sport';
import { chessEventFor, chessPayloadForSend } from '@/domain/scoring/chessEvents';
import { foldChess } from '@/domain/scoring/chessFold';
import { tapOfDone } from '@/domain/scoring/chessLedgerHistory';
import { chessDecided, chessPad, chessResultLine } from '@/domain/scoring/chessPad';
import type { ChessTypes } from '@/domain/scoring/chessTypes';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';

/**
 * Chess, as the match runtime scores it (`ScoringSport`; plan S2-3 Task 1): the fold (`foldChess`, remembered), the event a
 * tap is (`chessEventFor`), a send's payload (`chessPayloadForSend`) and the pad (`chessPad`) are chess's own modules; the
 * rest reads its display and its taps. The bootstrap's key is the engine's `boardgame`, shared with every generic
 * one-against-one game (ruling 61): the phone cannot tell the game, and treats it as chess. It has no serve and declares
 * no ending, so nothing here ever picks a side to serve or waits on one.
 */
export const chessSport: ScoringSport<ChessTypes> = {
  key: 'boardgame',
  epoch: foldEpochOf('boardgame'),
  fold: memoFold(foldChess),
  eventFor: chessEventFor,
  payloadForSend: chessPayloadForSend,
  /** Chess has no serve: Start match picks no side, so the match keeps no pick. */
  tossOf: () => null,
  refusalFor: () => 'notNow',
  notStarted: (display) => display.phase === 'notStarted',
  decided: chessDecided,
  /** The result as a scoresheet writes it, White's score first ("1–0"), and nothing until one stands. */
  resultLine: chessResultLine,
  awaitingEnding: () => false,
  /** The last tap, unless it is an Undo already; the start is never named (`tapOfDone`). */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : tapOfDone(did, display.colorOfHome);
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: chessPad,
};
