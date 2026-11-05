import type { SportEvent, SportEventContext } from '@/domain/scoring/scoringSport';
import {
  methodsOf,
  otherSeat,
  whiteSeatOf,
  type ChessColour,
  type ChessRung,
  type ChessTap,
  type ChessTiebreakTap,
  type ChessTypes,
} from '@/domain/scoring/chessTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { seatsOf, type Seats } from '@/domain/scoring/setBasedSides';
import type { LedgerEvent } from '@/domain/scoring/wire';

/**
 * A pad tap as the event the server records (spec §5; plan S2-3 Task 1). The first seat is `home`. The engine judges
 * whether the event is legal now (`foldChess`'s `legalQueued`); this decides only what the tap is, and refuses (null) a
 * tap that names what the game does not have: an empty seat, a method that contradicts the outcome, a colour swap with no
 * colours. The pad ends no game by force: it never writes `core.forfeit`, `core.settle` or `core.abandon` (a device link
 * gets 403 for them), nor a `boardgame.result` with a forfeit method (the web refuses it on write). A tie-break is the
 * scorer's job (BG-KO-1), and the pad sends one only for a rung its stage lists.
 */
export function chessEventFor(
  tap: ChessTap,
  { bootstrap, display }: SportEventContext<ChessTypes>,
): SportEvent | null {
  const seats = seatsOf(bootstrap);
  if (seats === null) return null;
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'result':
      return resultEvent(seats, tap);
    case 'swap':
      return swapEvent(seats, display.colorOfHome);
    case 'tiebreak':
      return tiebreakEvent(seats, tap, display.tiebreak.rungs);
  }
}

const TIEBREAK_TYPE = 'boardgame.tiebreak';

/**
 * A tie-break names the entrant of the seat the tap named, whoever holds White. Rapid and blitz name the winner and the
 * score, when one was said; an Armageddon names Black and the result and no winner (BG-KO-2: the engine works out who
 * advances, so a draw can never advance White). A rung the stage does not list is not played (BG-KO-3): no event.
 */
function tiebreakEvent(
  seats: Seats,
  tap: ChessTiebreakTap,
  listed: readonly ChessRung[],
): SportEvent | null {
  if (!listed.includes(tap.rung)) return null;
  if (tap.rung === 'armageddon') {
    const black = seats[tap.black].entrantId;
    return { type: TIEBREAK_TYPE, payload: { rung: tap.rung, black, result: tap.result } };
  }
  const winner = seats[tap.winner].entrantId;
  const score = tap.score === null ? {} : { score: tap.score };
  return { type: TIEBREAK_TYPE, payload: { rung: tap.rung, winner, ...score } };
}

/**
 * A result names the winner by the entrant in the seat the tap named, whoever holds White when it is recorded (a draw names
 * nobody: `winner` is present and null). A method is carried only when the result offers it.
 */
function resultEvent(
  seats: Seats,
  tap: Extract<ChessTap, { readonly kind: 'result' }>,
): SportEvent | null {
  const { method } = tap;
  if (method !== null && !methodsOf(tap.winner).includes(method)) return null;
  const winner = tap.winner === null ? null : seats[tap.winner].entrantId;
  return {
    type: 'boardgame.result',
    payload: { winner, ...(method === null ? {} : { method }) },
  };
}

/** The arbiter's pairing card names the entrant who will hold White: the one holding Black today. */
function swapEvent(seats: Seats, colour: ChessColour | null): SportEvent | null {
  if (colour === null) return null;
  return {
    type: 'boardgame.pairing',
    payload: { white: seats[otherSeat(whiteSeatOf(colour))].entrantId },
  };
}

/**
 * The payload to send for a queued tap. Chess stamps nothing a later ledger could make stale (a result names its winner
 * by entrant, a pairing its White, the start nothing), so a send is what was queued, whether it is the first, a resend
 * whose copy the ledger holds (`copied`) or one whose copy it does not: the web matches a resend by its key and never
 * compares payloads, and a payload that is the same every time is the same either way.
 */
export function chessPayloadForSend(
  queued: QueuedEvent,
  _ledger: readonly LedgerEvent[],
  _copied: boolean,
): unknown {
  return queued.payload;
}
