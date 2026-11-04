import {
  matchEndFacts,
  pendingEndingSanction,
  lastLiveEvent,
  scorerMayForfeit,
  type EventEnvelope,
} from '@seazn/engine/core';
import { badmintonPadRules } from '@seazn/engine/pad';
import { badminton, type SetBasedState } from '@seazn/engine/sports/setbased';
import { isRecord } from '@/domain/credentials/wire';
import { refusalOf } from '@/domain/scoring/badmintonEngine';
import { doneOf } from '@/domain/scoring/badmintonLedgerHistory';
import { badmintonHistory } from '@/domain/scoring/badmintonHistory';
import {
  SANCTION_LEVELS,
  type BadmintonDisplay,
  type BadmintonDone,
  type BadmintonSanction,
} from '@/domain/scoring/badmintonPad';
import type { BadmintonRules } from '@/domain/scoring/badmintonRules';
import type { PadHistoryGroup, PadSide } from '@/domain/scoring/padView';
import type { SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import {
  boardOf as setBasedBoard,
  lastRallyGame,
  lastTapOf,
  openGameOf,
  phaseOf,
  pointsOf,
  serverOf,
  wonGames,
  ZERO,
} from '@/domain/scoring/setBasedBoard';
import {
  foldSetBased,
  voidedIn,
  voidsAgain,
  type SetBasedFolded,
  type SetBasedFolding,
  type SetBasedKit,
  type SetBasedMatch,
} from '@/domain/scoring/setBasedFold';
import { ledgerRows } from '@/domain/scoring/setBasedLedgerHistory';
import { personName, sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import type { BadmintonPadKey, BadmintonUndoneTap } from '@/domain/scoring/badmintonPad';

/**
 * A badminton match on the pad (design §6.2, §7.3; plan S2-1 Task 7): the server's ledger with this phone's queued taps
 * on top, folded through @seazn/engine, as the pad draws it. The engine decides every fact; this only reads them off.
 *
 * The fold itself (the stream the server would hold, the engine's tolerant fold with each event's facts, the serve and
 * this phone's pick, what each event did) is the set-based sports' to share (`setBasedFold`); this is badminton's part:
 * the judgement of an append (the web's refusal of an undo of an event already undone, UNDO_ALREADY_VOIDED, its rule that
 * a scorer's forfeit is only the ending of the sanction right before it, D13, then the engine's strict fold), the court,
 * the sanctions, a disqualification's ending, and the rules.
 */
export type BadmintonFoldInput = SportFoldInput;

export type BadmintonFold =
  | {
      readonly kind: 'folded';
      readonly display: BadmintonDisplay;
      /** The queued taps' keys the match still takes, in order. */
      readonly legalQueued: readonly string[];
      readonly history: readonly PadHistoryGroup<BadmintonPadKey>[];
    }
  | { readonly kind: 'unfoldable'; readonly reason: BadmintonUnfoldable };

/** A seat with no entrant; a config the engine's schema refuses; a ledger the engine will not replay. */
export type BadmintonUnfoldable = Unfoldable;

type Board = Pick<BadmintonDisplay, 'points' | 'finished' | 'game'>;

const RALLY = 'badminton.rally';
const FORFEIT = 'core.forfeit';
const R = badmintonPadRules;

const KIT: SetBasedKit<BadmintonDone> = {
  module: badminton,
  rally: RALLY,
  summary: 'badminton.game.summary',
  mayAppend,
  doneOf,
};

export function foldBadminton(input: BadmintonFoldInput): BadmintonFold {
  const folding = foldSetBased(KIT, input);
  if (typeof folding === 'string') return { kind: 'unfoldable', reason: folding };
  const display = displayOf(folding);
  const rows = ledgerRows(
    folding.stream.entries,
    folding.recorded,
    voidedIn(folding.stream.envelopes),
  );
  return {
    kind: 'folded',
    display,
    legalQueued: folding.stream.legal,
    history: badmintonHistory(rows, display.sides),
  };
}

/** Whether the server would append `next` after `before`: the web's own refusals first, then the engine's. */
function mayAppend(
  match: SetBasedMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean {
  if (voidsAgain(before, next)) return false;
  if (next.type === FORFEIT && !scorerMayEnd(before, next.payload)) return false;
  return refusalOf(match.engine, [...before, next]) === null;
}

/** D13: a scorer's forfeit is only a disqualification's ending, by the side its sanction, right before it, names. */
function scorerMayEnd(before: readonly EventEnvelope[], payload: unknown): boolean {
  if (!isRecord(payload) || typeof payload.by !== 'string') return false;
  if (payload.reason !== 'disqualified') return false;
  return scorerMayForfeit(badminton, lastLiveEvent(before), {
    by: payload.by,
    reason: 'disqualified',
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

function displayOf(folding: SetBasedFolding<BadmintonDone>): BadmintonDisplay {
  const { match, stream, folded, serve, picked } = folding;
  const { state } = folded;
  const board = boardOf(match.names, state);
  const phase = phaseOf(state, board.game, lastRallyGame(stream.envelopes, folded.facts, RALLY));
  const server = serverOf(serve, picked);
  return {
    sides: match.names.sides,
    context: match.context,
    ...board,
    server,
    court: server === null ? 'right' : R.serviceCourt(board.points[server]),
    rules: rulesOf(match, board.game),
    phase,
    sanctions: sanctionsOf(match.names, state),
    lastTap: lastTapOf(stream.envelopes, folding.recorded, undoneTap),
    undoable: folding.undoable,
    awaitingEnding: awaitingEnding(stream.envelopes, folded),
    serverPicked: picked !== null,
  };
}

/**
 * The game under way and the games over: a game won on a rally boxed with its winner, and the game a disqualification
 * ended (owner ruling 18) boxed DQ at its points then. Once decided, the last game's points stay up.
 */
function boardOf(names: SetBasedNames, state: SetBasedState): Board {
  const disqualified = disqualifiedSide(names, state);
  if (disqualified === null) return setBasedBoard(state);
  const open = openGameOf(state);
  const points = open === undefined ? ZERO : pointsOf(open);
  const closed = wonGames(state);
  return { points, finished: [...closed, { points, disqualified }], game: closed.length + 1 };
}

function disqualifiedSide(names: SetBasedNames, state: SetBasedState): PadSide | null {
  const { outcome } = state;
  if (outcome?.kind !== 'award' || outcome.reason !== 'disqualified') return null;
  return sideOfEntrant(names, outcome.loser);
}

/**
 * The rules table and the strip, from the engine's own reading of the config. The interval point is the game's on the
 * pad: a deciding game played to fewer points has its own (`intervalMark` of that game).
 */
function rulesOf({ engine, rawCfg }: SetBasedMatch, game: number): BadmintonRules {
  const bestOf = R.bestOf(rawCfg);
  return {
    bestOf,
    points: R.setTarget(rawCfg, 0),
    decidingPoints: R.setTarget(rawCfg, bestOf - 1),
    winBy: engine.cfg.winBy,
    cap: engine.cfg.cap,
    intervalPoint: R.intervalMark(rawCfg, game - 1),
    decidingIntervalPoint: R.intervalMark(rawCfg, bestOf - 1),
  };
}

function sanctionsOf(names: SetBasedNames, state: SetBasedState): readonly BadmintonSanction[] {
  return (state.sanctions ?? []).flatMap((record) => {
    const level = SANCTION_LEVELS.find((known) => known === record.level);
    const side: PadSide = record.by === 'home' ? 'first' : 'second';
    return level === undefined
      ? []
      : [{ side, level, person: personName(names, side, record.person) }];
  });
}

/** A disqualification stands with no ending after it (the engine's own reading, as the web's write path reads it). */
function awaitingEnding(envelopes: readonly EventEnvelope[], folded: SetBasedFolded): boolean {
  const ended = matchEndFacts(badminton, folded, envelopes);
  return pendingEndingSanction(badminton, envelopes, ended) !== null;
}

/** The tap Undo takes back, as the last-tap line names it, or null for the start (whose Undo shows no line). */
export function undoneTap(did: BadmintonDone): BadmintonUndoneTap | null {
  switch (did.kind) {
    case 'start':
      return null;
    case 'rally':
      return { kind: 'rally', side: did.side };
    default:
      return did;
  }
}
