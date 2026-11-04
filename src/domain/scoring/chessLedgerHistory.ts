import type { EventEnvelope } from '@seazn/engine/core';
import {
  methodOf,
  outcomeOfSeat,
  seatOfOutcome,
  type ChessColour,
  type ChessDone,
  type ChessTap,
} from '@/domain/scoring/chessTypes';
import { field, type EventFacts } from '@/domain/scoring/setBasedLedgerHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';

/**
 * What a chess event did, in the pad's words (spec §4; plan S2-3 Task 1), `tableTennisLedgerHistory`'s twin: the one
 * vocabulary History and the last-tap line speak. The rest of History from the ledger (the rows, the voids) is the
 * set-based files' to share where they are generic (`ledgerRows`); this is chess's part: its three events and the taps
 * they are.
 */

/**
 * What an event did, or null for one the pad has no words for: the organiser's forfeit, a tie-break, the lock. A result
 * names the seat that won (by the entrant the payload names), or none for a draw.
 */
export function doneOf(envelope: EventEnvelope, names: SetBasedNames): ChessDone | null {
  const { payload } = envelope;
  switch (envelope.type) {
    case 'core.start':
      return { kind: 'start' };
    case 'boardgame.pairing':
      return field(payload, 'white') === undefined ? null : { kind: 'swap' };
    case 'boardgame.result':
      return resultDone(names, payload);
    default:
      return null;
  }
}

function resultDone(names: SetBasedNames, payload: unknown): ChessDone | null {
  const method = methodOf(field(payload, 'method'));
  const winner = field(payload, 'winner');
  if (winner === null || winner === undefined) return { kind: 'result', winner: null, method };
  const seat = sideOfEntrant(names, winner);
  return seat === null ? null : { kind: 'result', winner: seat, method };
}

/**
 * The facts of every chess event are the same: one game, no points, nothing won in the set-based sense and no sanction.
 * History's rows (`ledgerRows`) and the last tap (`lastTapOf`) are the set-based files' and read these.
 */
export const CHESS_FACTS: EventFacts = {
  game: 1,
  after: { first: 0, second: 0 },
  won: 'none',
  sanctionedPerson: null,
};

/** The tap an event was, as an Undo names it, or null for the start, whose Undo shows no line. */
export function tapOfDone(did: ChessDone, colour: ChessColour | null): ChessTap | null {
  switch (did.kind) {
    case 'start':
      return null;
    case 'swap':
      return { kind: 'swap' };
    case 'result':
      return {
        kind: 'result',
        outcome: did.winner === null ? 'draw' : outcomeOfSeat(did.winner, colour),
        method: did.method,
      };
  }
}

/** What a tap does, as the event it makes would be read back: the winner of a result by seat. */
export function doneOfTap(tap: ChessTap, colour: ChessColour | null): ChessDone {
  if (tap.kind !== 'result') return { kind: tap.kind };
  return { kind: 'result', winner: seatOfOutcome(tap.outcome, colour), method: tap.method };
}
