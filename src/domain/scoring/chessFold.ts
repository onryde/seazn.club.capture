import {
  deciderPending,
  EngineError,
  foldMatchWithStoppage,
  outcomeOf as engineOutcomeOf,
  type EventEnvelope,
  type FoldedOutcomeFacts,
} from '@seazn/engine/core';
import {
  boardgame,
  effectiveRungs,
  type BoardgameCfg,
  type BoardgameState,
} from '@seazn/engine/sports/boardgame';
import { chessRefusalOf, readChessCfg, type ChessEngineMatch } from '@/domain/scoring/chessEngine';
import { chessHistory } from '@/domain/scoring/chessHistory';
import { CHESS_FACTS, doneOf, tapOfDone } from '@/domain/scoring/chessLedgerHistory';
import {
  methodOf,
  outcomeOfSeat,
  type ChessColour,
  type ChessDisplay,
  type ChessDone,
  type ChessOutcome,
  type ChessPhase,
  type ChessResult,
  type ChessTiebreakState,
  type ChessTypes,
} from '@/domain/scoring/chessTypes';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { SportFold, SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import { lastTapOf } from '@/domain/scoring/setBasedBoard';
import { lineupOf, queuedEventId } from '@/domain/scoring/setBasedEngine';
import { streamOf, voidedIn, voidsAgain, type SetBasedStream } from '@/domain/scoring/setBasedFold';
import { ledgerRows, type Recorded } from '@/domain/scoring/setBasedLedgerHistory';
import {
  namesOf,
  seatsOf,
  sideNames,
  type Seats,
  type SetBasedNames,
  type SetBasedSide,
} from '@/domain/scoring/setBasedSides';
import { undoTarget, type UndoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf, type Bootstrap, type BootstrapSide } from '@/domain/scoring/wire';

/**
 * A chess game on the pad (spec §4 to §6; plan S2-3 Task 1): the server's ledger with this phone's queued taps on top,
 * folded through the engine's boardgame module, as the pad draws it. The engine decides every fact (the phase, the colours,
 * the outcome); this only reads them off. Chess is not set-based, so the set-based fold (`foldSetBased`, whose module type
 * and facts are the set-based family's) is not used; what is generic of it is: the stream the server would hold
 * (`streamOf`), the void reading and History's rows.
 *
 * Each queued tap is judged as the server would judge its append on the ledger and the legal taps before it. An illegal
 * tap is skipped, never shown, and the ones behind it are judged without it (`legalQueued`, which sync's `revalidate` takes).
 */

type ChessMatch = {
  readonly engine: ChessEngineMatch;
  readonly seats: Seats;
  readonly names: SetBasedNames;
  readonly context: MatchContext;
};

type ChessFolded = {
  /** What the engine's `outcomeOf` reads of a fold: the state and the organiser's settlement, if one stands. */
  readonly facts: FoldedOutcomeFacts<BoardgameState>;
  /**
   * The event that decided the game as the pad's Undo reads it, by envelope id, or null: the `boardgame.result` that stands,
   * or the `boardgame.tiebreak` after it (a tie-break ends the match, and it is the later of the two).
   */
  readonly decidingId: string | null;
};

export function foldChess(input: SportFoldInput): SportFold<ChessTypes> {
  const match = matchOf(input.bootstrap);
  if (typeof match === 'string') return { kind: 'unfoldable', reason: match };
  const stream = streamOf(match.engine.fixtureId, input, (before, next) =>
    mayAppend(match.engine, before, next),
  );
  const folded = foldOf(match.engine, stream.envelopes);
  if (folded === null) return { kind: 'unfoldable', reason: 'ledger' };
  const recorded = recordedOf(match.names, stream.envelopes);
  const display = displayOf(match, input, stream, folded, recorded);
  const rows = ledgerRows(stream.entries, recorded, voidedIn(stream.envelopes));
  return {
    kind: 'folded',
    display,
    legalQueued: stream.legal,
    history: chessHistory(rows, display.names),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The match, and the stream the server would hold
// ---------------------------------------------------------------------------------------------------------------

function matchOf(bootstrap: Bootstrap): ChessMatch | Unfoldable {
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return 'sides';
  const cfg = readChessCfg(bootstrap.cfg);
  if (cfg === null) return 'cfg';
  const lineups = { home: lineupOf(seats.first), away: lineupOf(seats.second) };
  return {
    engine: { fixtureId: bootstrap.fixtureId, cfg, lineups },
    seats,
    names: namesOf(seats),
    context,
  };
}

/** Whether the server would append `next` after `before`: the web's refusal of an undo twice, then the engine's. */
const mayAppend = (
  engine: ChessEngineMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean => !voidsAgain(before, next) && chessRefusalOf(engine, [...before, next]) === null;

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

const TIEBREAK_EVENT = 'boardgame.tiebreak';

/** The read path's tolerant fold; null for a stream the engine will not replay. */
function foldOf(engine: ChessEngineMatch, envelopes: readonly EventEnvelope[]): ChessFolded | null {
  let decidingId: string | null = null;
  try {
    const { state, settlement, expunged, levelWithdrawal } = foldMatchWithStoppage(
      boardgame,
      engine.cfg,
      engine.lineups,
      envelopes,
      {
        onFolded: (_state, event) => {
          if (event.type === 'boardgame.result' || event.type === TIEBREAK_EVENT) {
            decidingId = event.id;
          }
        },
      },
    );
    return { facts: { state, settlement, expunged, levelWithdrawal }, decidingId };
  } catch (error) {
    if (EngineError.is(error)) return null;
    throw error;
  }
}

/** What each event the pad has words for did, by envelope id: the standing ones and the ones a void took back alike. */
function recordedOf(
  names: SetBasedNames,
  envelopes: readonly EventEnvelope[],
): ReadonlyMap<string, Recorded<ChessDone>> {
  const recorded = new Map<string, Recorded<ChessDone>>();
  for (const envelope of envelopes) {
    const did = doneOf(envelope, names);
    if (did !== null) recorded.set(envelope.id, { did, facts: CHESS_FACTS });
  }
  return recorded;
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

function displayOf(
  match: ChessMatch,
  input: SportFoldInput,
  stream: SetBasedStream,
  folded: ChessFolded,
  recorded: ReadonlyMap<string, Recorded<ChessDone>>,
): ChessDisplay {
  const { decidingId } = folded;
  const { state } = folded.facts;
  // The switch says whether the pad offers colours; a pairing recorded before it was turned off is a fact the pad ignores.
  const colour = match.engine.cfg.colors ? state.colorOfHome : null;
  return {
    phase: phaseOf(folded.facts),
    colorOfHome: colour,
    names: {
      first: seatName(match.seats.first, match.names.sides.first),
      second: seatName(match.seats.second, match.names.sides.second),
    },
    result: resultOf(folded.facts, colour),
    context: match.context,
    lastTap: lastTapOf(stream.envelopes, recorded, tapOfDone),
    undoable: undoesResult(undoTargetOf(input, stream), decidingId),
    tiebreak: tiebreakOf(match.engine.cfg, folded.facts),
  };
}

/**
 * The name a seat shows: an individual by the player as the organiser typed it, a team or a pair by its entrant's name
 * (spec §10), which is no member's.
 */
function seatName(seat: BootstrapSide, players: SetBasedSide): string {
  return seat.kind === 'individual' ? sideNames(players) : seat.name;
}

/**
 * The engine's phase as the pad's: an abandoned game takes no more events, as a locked one. A drawn bracket game the
 * organiser has settled is done: the module's state stays in `tiebreak` after a settle (the settlement lives beside it), so
 * only the engine's own `deciderPending` says the tie-break is still owed.
 */
function phaseOf(facts: FoldedOutcomeFacts<BoardgameState>): ChessPhase {
  const { state } = facts;
  if (state.phase === 'pre') return 'notStarted';
  if (state.phase === 'abandoned') return 'final';
  return settledTiebreak(facts) ? 'done' : state.phase;
}

/** The game went level to a tie-break and the organiser has since settled it, so none is owed. */
const settledTiebreak = (facts: FoldedOutcomeFacts<BoardgameState>): boolean =>
  facts.state.phase === 'tiebreak' && !deciderPending(boardgame, facts);

/**
 * The result that stands, from the engine's outcome. A win or an award names its winner's entrant, read by the seat it
 * sits in; a game that went to the tie-break was drawn on the board (the engine's own reading: the tie-break decides who
 * advances and never rewrites the game), so it is a draw. A double walkover, or no outcome, is none.
 */
function resultOf(
  facts: FoldedOutcomeFacts<BoardgameState>,
  colour: ChessColour | null,
): ChessResult | null {
  const outcome = outcomeOf(facts, colour);
  return outcome === null ? null : { outcome, method: methodOf(facts.state.method) };
}

function outcomeOf(
  facts: FoldedOutcomeFacts<BoardgameState>,
  colour: ChessColour | null,
): ChessOutcome | null {
  const { state } = facts;
  const decided = state.outcome;
  if (decided === null) return settledTiebreak(facts) ? 'draw' : null;
  if (decided.kind === 'draw' || state.tiebreak !== undefined) return 'draw';
  if (decided.kind !== 'win' && decided.kind !== 'award') return null;
  return outcomeOfSeat(decided.winner === state.entrants.home ? 'first' : 'second', colour);
}

// ---------------------------------------------------------------------------------------------------------------
// The tie-break
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where a drawn knockout game stands. The rungs are the stage's own list, in its order (`effectiveRungs`: all three when it
 * names none), and only for a knockout stage (`cfg.tiebreak`). A tie-break is owed while the engine says a decider is
 * pending (`deciderPending`, never the module phase alone: a settle leaves the phase as it was). A stage that lists no rung
 * folds the drawn game level and done, so it is held (for the organiser) while the outcome is still that draw.
 */
function tiebreakOf(
  cfg: BoardgameCfg,
  facts: FoldedOutcomeFacts<BoardgameState>,
): ChessTiebreakState {
  const rungs = cfg.tiebreak === true ? effectiveRungs(cfg) : [];
  return {
    rungs,
    pending: deciderPending(boardgame, facts),
    held:
      cfg.tiebreak === true &&
      rungs.length === 0 &&
      engineOutcomeOf(boardgame, facts)?.kind === 'draw',
    decided: decidedTiebreak(facts.state),
  };
}

/** The tie-break that ended the game, with the seat it sent through: the engine's win by `tiebreak_<rung>`. */
function decidedTiebreak(state: BoardgameState): ChessTiebreakState['decided'] {
  const rung = state.tiebreak?.rung;
  if (rung === undefined || state.outcome?.kind !== 'win') return null;
  return { rung, advances: state.outcome.winner === state.entrants.home ? 'first' : 'second' };
}

// ---------------------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------------------

/** What the one Undo would take back: this phone's latest standing event, the legal queued taps included. */
function undoTargetOf(input: SportFoldInput, stream: SetBasedStream): UndoTarget {
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  return undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true);
}

/**
 * Whether `target` is the event that decided the game: this phone recorded the result (or the tie-break after it) and nothing
 * has been recorded since.
 */
function undoesResult(target: UndoTarget, decidingId: string | null): boolean {
  switch (target.kind) {
    case 'blocked':
      return false;
    case 'ledger':
      return target.eventId === decidingId;
    case 'queued':
    case 'awaitAnswer':
      return queuedEventId(target.key) === decidingId;
  }
}
