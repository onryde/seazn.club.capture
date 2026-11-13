import { tabletennisPadRules } from '@seazn/engine/pad';
import type { EventEnvelope } from '@seazn/engine/core';
import {
  setBasedServeContext,
  tabletennis,
  type SetBasedServeContext,
  type SetBasedServeUnknown,
  type SetBasedState,
} from '@seazn/engine/sports/setbased';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import type { SportFold, SportFoldInput } from '@/domain/scoring/scoringSport';
import {
  boardOf,
  lastRallyGame,
  lastTapOf,
  phaseOf,
  serverOf,
} from '@/domain/scoring/setBasedBoard';
import {
  foldOf,
  foldSetBased,
  voidedIn,
  voidsAgain,
  type SetBasedEvents,
  type SetBasedFolding,
  type SetBasedKit,
  type SetBasedMatch,
} from '@/domain/scoring/setBasedFold';
import { pointCallsFrom } from '@/domain/scoring/setBasedPointCall';
import { ledgerRows } from '@/domain/scoring/setBasedLedgerHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';
import { tableTennisRefusalOf } from '@/domain/scoring/tableTennisEngine';
import { scoreEventsIn } from '@/domain/scoring/tableTennisEvents';
import { tableTennisHistory } from '@/domain/scoring/tableTennisHistory';
import { doneOf, isCardLevel } from '@/domain/scoring/tableTennisLedgerHistory';
import type {
  TableTennisDisplay,
  TableTennisDone,
  TableTennisExpedite,
  TableTennisRules,
  TableTennisSanction,
  TableTennisTypes,
  TableTennisUndoneTap,
} from '@/domain/scoring/tableTennisPad';

/**
 * A table tennis match on the pad (design §4, §6; plan S2-2 Task 3): the server's ledger with this phone's queued taps on
 * top, folded through @seazn/engine, as the pad draws it. The engine decides every fact (the serve, its number and the
 * doubles server included: `setBasedServeContext`, never arithmetic of ours); this only reads them off.
 *
 * The fold itself (the stream the server would hold, the engine's tolerant fold with each event's facts, the serve and
 * this phone's pick, what each event did) is the set-based sports' to share (`setBasedFold`); this is table tennis's
 * part: the judgement of an append (the web's refusal of an undo of an event already undone, UNDO_ALREADY_VOIDED, the
 * engine's strict fold and, for a 13 returns point, which carries no `serving` so the engine cannot check it, the pad's
 * own check that it credits the receiver, design §4.5), the serve's number and the doubles server, Who is serving?,
 * Expedite and the rules.
 */

const RALLY = 'tabletennis.rally';
const R = tabletennisPadRules;

/** The engine's name for each half: the top side is home. */
const ENGINE_SIDE = { first: 'home', second: 'away' } as const;

/** A doubles pair: two people. A side that lists any other number is not named a server (the bootstrap has no slot). */
const PAIR_SIZE = 2;

const EVENTS: SetBasedEvents = {
  module: tabletennis,
  rally: RALLY,
  summary: 'tabletennis.game.summary',
};

const KIT: SetBasedKit<TableTennisDone> = { ...EVENTS, mayAppend, doneOf };

export function foldTableTennis(input: SportFoldInput): SportFold<TableTennisTypes> {
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
    history: tableTennisHistory(rows, display.sides),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Which queued taps are legal
// ---------------------------------------------------------------------------------------------------------------

/** Whether the server would append `next` after `before`: the web's own refusals first, then the engine's, then ours. */
function mayAppend(
  match: SetBasedMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean {
  if (voidsAgain(before, next)) return false;
  if (tableTennisRefusalOf(match.engine, [...before, next]) !== null) return false;
  return mayCreditReceiver(match, before, next);
}

/**
 * A point that reached the receiver's thirteenth return (ITTF 2.15.2) credits the receiver only. The engine judges that
 * when the rally names `serving`; the pad's 13 returns tool does not (design §4.5: a stamp of the engine's own belief
 * would make its drift check check itself), so the engine counts such a point unchecked and never refuses it. This is
 * its check, on the fold so far: Expedite in force, the server known to the engine (never this phone's Start pick: it
 * has not anchored anything), and the point not the server's.
 */
function mayCreditReceiver(
  match: SetBasedMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean {
  const winner = uncheckedReturnsWinner(match.names, next);
  if (winner === null) return true;
  const folded = foldOf(EVENTS, match.engine, before);
  if (folded === null || folded.state.expedite !== true) return false;
  const { side } = setBasedServeContext(tabletennis, folded.state, before);
  return side !== null && R.expediteReturnsCreditable(side, winner);
}

/** The engine's side for the winner of a rally that reached 13 returns and names no `serving`, else null. */
function uncheckedReturnsWinner(names: SetBasedNames, next: EventEnvelope): 'home' | 'away' | null {
  const { payload } = next;
  if (next.type !== RALLY || !isRecord(payload) || payload.serving !== undefined) return null;
  if (typeof payload.returns !== 'number' || payload.returns < R.expediteReturns) return null;
  const side = sideOfEntrant(names, payload.wonBy);
  return side === null ? null : ENGINE_SIDE[side];
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

function displayOf(folding: SetBasedFolding<TableTennisDone>): TableTennisDisplay {
  const { match, stream, folded } = folding;
  const { state } = folded;
  const board = boardOf(state);
  // Table tennis has no golden point: the cap is none, so a game is only won by two clear.
  const { calls, fault } = pointCallsFrom(EVENTS, folding, false);
  return {
    sides: match.names.sides,
    context: match.context,
    ...board,
    ...serveOf(match, folding),
    rules: rulesOf(match),
    phase: phaseOf(state, board.game, lastRallyGame(stream.envelopes, folded.facts, RALLY)),
    expedite: expediteOf(match, state),
    scoreEvents: scoreEventsIn(stream.envelopes),
    deuce: R.deuceNote(state, match.rawCfg) !== null,
    sanctions: sanctionsOf(state),
    records: recordsOf(match),
    lastTap: lastTapOf(stream.envelopes, folding.recorded, undoneTap),
    undoable: folding.undoable,
    calls,
    callFault: fault,
  };
}

/** The rules table and the strip, from the engine's own reading of the config. */
function rulesOf({ engine, rawCfg }: SetBasedMatch): TableTennisRules {
  const bestOf = R.bestOf(rawCfg);
  return {
    bestOf,
    setTo: R.setTo(rawCfg),
    finalSetTo: R.setTarget(rawCfg, bestOf - 1),
    winBy: engine.cfg.winBy,
    scoreBound: R.scoreBound(rawCfg),
  };
}

/**
 * The cards standing, from the engine's own record of them (an undone card is not in it). A level the pad does not list
 * (`expulsion`, `disqualification`: the engine's schema takes them, the pad never records them) draws no card, as History
 * has no words for it.
 */
function sanctionsOf(state: SetBasedState): readonly TableTennisSanction[] {
  return (state.sanctions ?? []).flatMap((record) =>
    isCardLevel(record.level)
      ? [
          {
            side: record.by === 'home' ? ('first' as const) : ('second' as const),
            level: record.level,
          },
        ]
      : [],
  );
}

const recordsOf = ({ engine }: SetBasedMatch): TableTennisDisplay['records'] => ({
  timeouts: engine.cfg.records.timeouts,
  sanctions: engine.cfg.records.sanctions,
  expedite: engine.cfg.records.expedite,
});

// ---------------------------------------------------------------------------------------------------------------
// The serve
// ---------------------------------------------------------------------------------------------------------------

type ServeFacts = Pick<
  TableTennisDisplay,
  'server' | 'serverPerson' | 'serverPersonId' | 'serveNumber' | 'serverPicked' | 'anchorNeeded'
>;

/** Everything the pad says about the serve, from the engine's reader and this phone's pick. */
function serveOf(match: SetBasedMatch, folding: SetBasedFolding<TableTennisDone>): ServeFacts {
  const { serve, picked, folded } = folding;
  const person = serverPersonOf(match, serve);
  return {
    server: serverOf(serve, picked),
    serverPerson: person.name,
    serverPersonId: person.id,
    serveNumber: serveNumberOf(serve, picked),
    serverPicked: picked !== null,
    anchorNeeded: needsAnchor(serve, folded.state.phase === 'live', picked !== null),
  };
}

/**
 * The serve of the pair the engine is at (ITTF 2.13.3: two points each), 1 or 2; at deuce and under Expedite the engine
 * sets 1. The pick shown before the match's first point is the game's first serve.
 */
function serveNumberOf(serve: SetBasedServeContext, picked: PadSide | null): 1 | 2 | null {
  if (serve.serveNumber === 1 || serve.serveNumber === 2) return serve.serveNumber;
  return picked === null ? null : 1;
}

/**
 * The doubles server the engine names, from the team sheet's pair order, as a name and an id: only for a side whose
 * bootstrap lists exactly its pair (the bootstrap carries no slot, so a bench row could make the phone name a player the
 * web would not; the plate then names the side). Singles, and a pair with no order declared, name nobody.
 */
function serverPersonOf(
  match: SetBasedMatch,
  serve: SetBasedServeContext,
): { readonly name: string | null; readonly id: string | null } {
  const none = { name: null, id: null };
  if (serve.side === null) return none;
  const seat = match.seats[serve.side === 'home' ? 'first' : 'second'];
  if (seat.lineup.length !== PAIR_SIZE) return none;
  const member = seat.members.find((one) => one.personId === serve.serverPersonId);
  return member === undefined ? none : { name: member.fullName, id: member.personId };
}

/** The reasons the engine will not name a server that no new declaration mends (design §4.2). */
const NO_DECLARATION_MENDS: readonly SetBasedServeUnknown[] = [
  'recorded-disagrees',
  'ledger-mismatch',
];

/**
 * Whether the pad asks Who is serving? (design §4.2, ruling 51; fix round 1): the match is live, the engine names nobody,
 * this phone's Start pick is not the server shown (`serverPicked`: before the first point that pick does this job), and
 * the engine's reason is a gap a declaration fills, not a dispute (`recorded-disagrees`: the engine refuses to re-anchor
 * off a declaration mid-dispute, the next game resolves it) nor a mismatch (`ledger-mismatch`: no new event fixes it), as
 * the web's anchor tile decides (`needsServeAnchor`). No point need stand: a match started elsewhere asks at 0-0.
 */
export function needsAnchor(
  serve: SetBasedServeContext,
  live: boolean,
  serverPicked: boolean,
): boolean {
  if (!live || serverPicked || serve.side !== null) return false;
  return !NO_DECLARATION_MENDS.some((reason) => reason === serve.unknownBecause);
}

// ---------------------------------------------------------------------------------------------------------------
// Expedite
// ---------------------------------------------------------------------------------------------------------------

/**
 * In force (ITTF 2.15.4: to the end of the match), else offered while the match is live, records it, and not both sides
 * have `expediteScoreFloor` in the game under way (2.15.1; advisory in the engine, the web's pad hides the tile from it).
 */
function expediteOf(match: SetBasedMatch, state: SetBasedState): TableTennisExpedite {
  if (state.expedite === true) return 'inForce';
  if (state.phase !== 'live' || !match.engine.cfg.records.expedite) return 'off';
  return bothAtFloor(state) ? 'off' : 'offered';
}

function bothAtFloor(state: SetBasedState): boolean {
  const open = state.sets[state.sets.length - 1];
  if (open === undefined || open.closed) return false;
  return open.home >= R.expediteScoreFloor && open.away >= R.expediteScoreFloor;
}

// ---------------------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------------------

/** The tap Undo takes back, as the last-tap line names it, or null for the start (whose Undo shows no line). */
export function undoneTap(did: TableTennisDone): TableTennisUndoneTap | null {
  return did.kind === 'start' ? null : did;
}
