import type { EventEnvelope } from '@seazn/engine/core';
import { ARMAGEDDON_RESULTS } from '@seazn/engine/sports/boardgame';
import {
  CHESS_TIEBREAK_SCORES,
  methodOf,
  type ChessArmageddonResult,
  type ChessDone,
  type ChessTap,
  type ChessTiebreakScore,
} from '@/domain/scoring/chessTypes';
import { field, type EventFacts } from '@/domain/scoring/setBasedLedgerHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';

/**
 * What a chess event did, in the pad's words (spec §4; plan S2-3 Task 1), `tableTennisLedgerHistory`'s twin: the one
 * vocabulary History and the last-tap line speak. The rest of History from the ledger (the rows, the voids) is the
 * set-based files' to share where they are generic (`ledgerRows`); this is chess's part: its four events (the start, a
 * pairing, a result and a tie-break) and the taps they are.
 */

/**
 * What an event did, or null for one the pad has no words for: the organiser's forfeit, a settle that is not a lot, the
 * lock. A result names the seat that won (by the entrant the payload names), or none for a draw. A tie-break names the seat
 * that won it (rapid, blitz) or the seat that had Black and how it ended (Armageddon). The organiser's drawing of lots names
 * the seat it sent through (ruling 63b).
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
    case 'boardgame.tiebreak':
      return tiebreakDone(names, payload);
    case 'core.settle':
      return lotsDone(names, payload);
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

/** A tie-break by the seats it names, or null when it names a rung the pad does not know, or an entrant who is neither side's. */
function tiebreakDone(names: SetBasedNames, payload: unknown): ChessDone | null {
  const rung = field(payload, 'rung');
  if (rung === 'rapid' || rung === 'blitz') {
    const winner = sideOfEntrant(names, field(payload, 'winner'));
    const score = scoreOf(field(payload, 'score'));
    return winner === null ? null : { kind: 'tiebreak', rung, winner, score };
  }
  if (rung !== 'armageddon') return null;
  const black = sideOfEntrant(names, field(payload, 'black'));
  const result = armageddonResultOf(field(payload, 'result'));
  return black === null || result === null ? null : { kind: 'tiebreak', rung, black, result };
}

/** A settle by lot, by the seat of the entrant it names; a settle by seed or by the organiser's call has no words here. */
function lotsDone(names: SetBasedNames, payload: unknown): ChessDone | null {
  if (field(payload, 'method') !== 'lot') return null;
  const advances = sideOfEntrant(names, field(payload, 'winner'));
  return advances === null ? null : { kind: 'lots', advances };
}

/** A score of the two the pad offers, else none: the web takes any score of the shape, and the line never speaks one. */
const scoreOf = (value: unknown): ChessTiebreakScore | null =>
  CHESS_TIEBREAK_SCORES.find((score) => score === value) ?? null;

const armageddonResultOf = (value: unknown): ChessArmageddonResult | null =>
  ARMAGEDDON_RESULTS.find((result) => result === value) ?? null;

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

/**
 * The tap an event was, as an Undo names it, or null for the start, whose Undo shows no line, and for the organiser's
 * drawing of lots, which is never a tap (the fold passes a voided lot over: `withoutVoidedLots`). A result names its seat
 * both ways.
 */
export function tapOfDone(did: ChessDone): ChessTap | null {
  return did.kind === 'start' || did.kind === 'lots' ? null : did;
}

/** What a tap does, as the event it makes would be read back: a result names the same seat. */
export function doneOfTap(tap: ChessTap): ChessDone {
  return tap;
}
