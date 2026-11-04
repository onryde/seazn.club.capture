import { EngineError, foldMatch, type EventEnvelope } from '@seazn/engine/core';
import { boardgame, type BoardgameState } from '@seazn/engine/sports/boardgame';
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
  type ChessTypes,
} from '@/domain/scoring/chessTypes';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { SportFold, SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import { lastTapOf } from '@/domain/scoring/setBasedBoard';
import {
  envelopeOf,
  lineupOf,
  queuedEnvelopeOf,
  queuedEventId,
} from '@/domain/scoring/setBasedEngine';
import { voidedIn, voidsAgain } from '@/domain/scoring/setBasedFold';
import {
  ledgerRows,
  type LedgerEntry,
  type Recorded,
} from '@/domain/scoring/setBasedLedgerHistory';
import { namesOf, seatsOf, sideNames, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import { undoTarget, type UndoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf, type Bootstrap } from '@/domain/scoring/wire';

/**
 * A chess game on the pad (spec §4 to §6; plan S2-3 Task 1): the server's ledger with this phone's queued taps on top,
 * folded through the engine's boardgame module, as the pad draws it. The engine decides every fact (the phase, the colours,
 * the outcome); this only reads them off. Chess is not set-based, so the set-based fold (`foldSetBased`, whose module type
 * and facts are the set-based family's) is not used; what is generic of it is: the envelopes, the void reading and
 * History's rows. The stream the server would hold is built here, as `foldSetBased` builds its own, in the same few lines.
 *
 * Each queued tap is judged as the server would judge its append on the ledger and the legal taps before it. An illegal
 * tap is skipped, never shown, and the ones behind it are judged without it (`legalQueued`, which sync's `revalidate` takes).
 */

type ChessMatch = {
  readonly engine: ChessEngineMatch;
  readonly names: SetBasedNames;
  readonly context: MatchContext;
};

/** The ledger and the legal queued taps, as one stream in the order the server would hold them. */
type ChessStream = {
  readonly envelopes: readonly EventEnvelope[];
  readonly entries: readonly LedgerEntry[];
  /** The queued taps' keys the game still takes, in order. */
  readonly legal: readonly string[];
};

type ChessFolded = {
  readonly state: BoardgameState;
  /** The `boardgame.result` that stands, by envelope id, or null. */
  readonly resultId: string | null;
};

export function foldChess(input: SportFoldInput): SportFold<ChessTypes> {
  const match = matchOf(input.bootstrap);
  if (typeof match === 'string') return { kind: 'unfoldable', reason: match };
  const stream = streamOf(match, input);
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
    names: namesOf(seats),
    context,
  };
}

function streamOf(match: ChessMatch, input: SportFoldInput): ChessStream {
  const { fixtureId } = match.engine;
  const own = new Set(input.ownEventIds);
  const envelopes = input.ledger.map((event) => envelopeOf(fixtureId, event));
  const entries: LedgerEntry[] = envelopes.map((envelope) => ({
    envelope,
    own: own.has(envelope.id),
    sending: false,
  }));
  const legal: string[] = [];
  for (const tap of input.queued) {
    const envelope = queuedEnvelopeOf(fixtureId, tap, nextSeq(envelopes));
    if (!mayAppend(match.engine, envelopes, envelope)) continue;
    envelopes.push(envelope);
    entries.push({ envelope, own: true, sending: true });
    legal.push(tap.key);
  }
  return { envelopes, entries, legal };
}

const nextSeq = (envelopes: readonly EventEnvelope[]) =>
  (envelopes[envelopes.length - 1]?.seq ?? 0) + 1;

/** Whether the server would append `next` after `before`: the web's refusal of an undo twice, then the engine's. */
const mayAppend = (
  engine: ChessEngineMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean => !voidsAgain(before, next) && chessRefusalOf(engine, [...before, next]) === null;

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

/** The read path's tolerant fold; null for a stream the engine will not replay. */
function foldOf(engine: ChessEngineMatch, envelopes: readonly EventEnvelope[]): ChessFolded | null {
  let resultId: string | null = null;
  try {
    const state = foldMatch(boardgame, engine.cfg, engine.lineups, envelopes, {
      onFolded: (_state, event) => {
        if (event.type === 'boardgame.result') resultId = event.id;
      },
    });
    return { state, resultId };
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
  stream: ChessStream,
  folded: ChessFolded,
  recorded: ReadonlyMap<string, Recorded<ChessDone>>,
): ChessDisplay {
  const { state, resultId } = folded;
  // The switch says whether the pad offers colours; a pairing recorded before it was turned off is a fact the pad ignores.
  const colour = match.engine.cfg.colors ? state.colorOfHome : null;
  const own = stream.entries.some((entry) => entry.envelope.id === resultId && entry.own);
  return {
    phase: phaseOf(state),
    colorOfHome: colour,
    names: {
      first: sideNames(match.names.sides.first),
      second: sideNames(match.names.sides.second),
    },
    result: resultOf(state, colour, own),
    context: match.context,
    lastTap: lastTapOf(stream.envelopes, recorded, (did) => tapOfDone(did, colour)),
    undoable: undoesResult(undoTargetOf(input, stream), resultId),
  };
}

/** The engine's phase as the pad's: an abandoned game takes no more events, as a locked one. */
function phaseOf(state: BoardgameState): ChessPhase {
  return state.phase === 'pre' ? 'notStarted' : state.phase === 'abandoned' ? 'final' : state.phase;
}

/**
 * The result that stands, from the engine's outcome. A win or an award names its winner's entrant, read by the seat it
 * sits in; a game that went to the tie-break was drawn on the board (the engine's own reading: the tie-break decides who
 * advances and never rewrites the game), so it is a draw. A double walkover, or no outcome, is none.
 */
function resultOf(
  state: BoardgameState,
  colour: ChessColour | null,
  own: boolean,
): ChessResult | null {
  const outcome = outcomeOf(state, colour);
  return outcome === null ? null : { outcome, method: methodOf(state.method), own };
}

function outcomeOf(state: BoardgameState, colour: ChessColour | null): ChessOutcome | null {
  const decided = state.outcome;
  if (decided === null) return null;
  if (decided.kind === 'draw' || state.tiebreak !== undefined) return 'draw';
  if (decided.kind !== 'win' && decided.kind !== 'award') return null;
  return outcomeOfSeat(decided.winner === state.entrants.home ? 'first' : 'second', colour);
}

// ---------------------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------------------

/** What the one Undo would take back: this phone's latest standing event, the legal queued taps included. */
function undoTargetOf(input: SportFoldInput, stream: ChessStream): UndoTarget {
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  return undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true);
}

/** Whether `target` is the result that stands: this phone recorded it and nothing has been recorded since. */
function undoesResult(target: UndoTarget, resultId: string | null): boolean {
  switch (target.kind) {
    case 'blocked':
      return false;
    case 'ledger':
      return target.eventId === resultId;
    case 'queued':
    case 'awaitAnswer':
      return queuedEventId(target.key) === resultId;
  }
}
