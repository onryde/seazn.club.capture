import { EngineError, foldMatchWithStoppage, type EventEnvelope } from '@seazn/engine/core';
import { tabletennisPadRules } from '@seazn/engine/pad';
import {
  setBasedServeContext,
  tabletennis,
  type SetBasedServeContext,
  type SetBasedServeUnknown,
  type SetBasedState,
  type SetState,
} from '@seazn/engine/sports/setbased';
import { isRecord } from '@/domain/credentials/wire';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';
import type { SportFold, SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import { envelopeOf, lineupOf, queuedEnvelopeOf } from '@/domain/scoring/setBasedEngine';
import { seatsOf, type Seats } from '@/domain/scoring/setBasedSides';
import {
  tableTennisCfg,
  tableTennisRefusalOf,
  type TableTennisEngineMatch,
} from '@/domain/scoring/tableTennisEngine';
import {
  doneOf,
  ledgerHistory,
  namesOf,
  sideOfEntrant,
  type EventFacts,
  type LedgerEntry,
  type Recorded,
  type TableTennisNames,
} from '@/domain/scoring/tableTennisLedgerHistory';
import type {
  TableTennisDisplay,
  TableTennisDone,
  TableTennisExpedite,
  TableTennisGame,
  TableTennisLastTap,
  TableTennisPhase,
  TableTennisRules,
  TableTennisTypes,
  TableTennisUndoneTap,
} from '@/domain/scoring/tableTennisPad';
import { undoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf, type Bootstrap } from '@/domain/scoring/wire';

/**
 * A table tennis match on the pad (design §4, §6; plan S2-2 Task 3): the server's ledger with this phone's queued taps on
 * top, folded through @seazn/engine, as the pad draws it. The engine decides every fact (the serve, its number and the
 * doubles server included: `setBasedServeContext`, never arithmetic of ours); this only reads them off.
 *
 * Each queued tap is judged as the server would judge its append on the ledger and the legal taps before it: the
 * engine's strict fold, the web's refusal of an undo of an event already undone (UNDO_ALREADY_VOIDED), and, for a 13
 * returns point (which carries no `serving`, so the engine cannot check it), the pad's own check that it credits the
 * receiver (design §4.5). An illegal tap is skipped, never shown, and the ones behind it are judged without it
 * (`legalQueued`, which sync's `revalidate` takes).
 *
 * Cost: one strict fold of the whole stream per queued tap (and one tolerant fold more for each 13 returns point), one
 * tolerant fold for the display, and one fold of a prefix per event a void takes back. No incremental fold.
 */
export function foldTableTennis(input: SportFoldInput): SportFold<TableTennisTypes> {
  const match = matchOf(input.bootstrap);
  if (typeof match === 'string') return { kind: 'unfoldable', reason: match };
  const stream = streamOf(match, input);
  const folded = foldOf(match.engine, stream.envelopes);
  if (folded === null) return { kind: 'unfoldable', reason: 'ledger' };
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  const undoable =
    undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true).kind !== 'blocked';
  const serve = setBasedServeContext(tabletennis, folded.state, stream.envelopes);
  const picked = pickedServer(folded.state, serve, input.toss);
  const recorded = recordedOf(match, stream, folded, picked);
  const display = displayOf(match, stream, folded, { serve, picked, undoable, recorded });
  const history = ledgerHistory(
    stream.entries,
    recorded,
    voidedIn(stream.envelopes),
    display.sides,
  );
  return { kind: 'folded', display, legalQueued: stream.legal, history };
}

// ---------------------------------------------------------------------------------------------------------------
// The match, and the stream the server would hold
// ---------------------------------------------------------------------------------------------------------------

type Match = {
  readonly engine: TableTennisEngineMatch;
  readonly rawCfg: unknown;
  readonly seats: Seats;
  readonly names: TableTennisNames;
  readonly context: MatchContext;
};

/** The ledger and the legal queued taps, as one stream in the order the server would hold them. */
type Stream = {
  readonly envelopes: readonly EventEnvelope[];
  readonly entries: readonly LedgerEntry[];
  readonly legal: readonly string[];
};

type Folded = {
  readonly state: SetBasedState;
  /** What the fold said of each event still standing, by envelope id. */
  readonly facts: ReadonlyMap<string, EventFacts>;
};

type Board = Pick<TableTennisDisplay, 'points' | 'finished' | 'game'>;

const RALLY = 'tabletennis.rally';
const SUMMARY = 'tabletennis.game.summary';
const ZERO: Readonly<Record<PadSide, number>> = { first: 0, second: 0 };
const R = tabletennisPadRules;

/** The engine's name for each half: the top side is home. */
const ENGINE_SIDE = { first: 'home', second: 'away' } as const;

/** A doubles pair: two people. A side that lists any other number is not named a server (the bootstrap has no slot). */
const PAIR_SIZE = 2;

function matchOf(bootstrap: Bootstrap): Match | Unfoldable {
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return 'sides';
  const cfg = cfgOf(bootstrap.cfg);
  if (cfg === null) return 'cfg';
  const lineups = { home: lineupOf(seats.first), away: lineupOf(seats.second) };
  return {
    engine: { fixtureId: bootstrap.fixtureId, cfg, lineups },
    rawCfg: bootstrap.cfg,
    seats,
    names: namesOf(seats),
    context,
  };
}

/** The config through the engine's schema, or null for one it refuses (its own refusal is all a throw here can be). */
function cfgOf(raw: unknown): TableTennisEngineMatch['cfg'] | null {
  try {
    return tableTennisCfg(raw);
  } catch {
    return null;
  }
}

function streamOf(match: Match, input: SportFoldInput): Stream {
  const own = new Set(input.ownEventIds);
  const envelopes = input.ledger.map((event) => envelopeOf(match.engine.fixtureId, event));
  const entries: LedgerEntry[] = envelopes.map((envelope) => ({
    envelope,
    own: own.has(envelope.id),
    sending: false,
  }));
  const legal: string[] = [];
  for (const tap of input.queued) {
    const envelope = queuedEnvelopeOf(match.engine.fixtureId, tap, nextSeq(envelopes));
    if (!mayAppend(match, envelopes, envelope)) continue;
    envelopes.push(envelope);
    entries.push({ envelope, own: true, sending: true });
    legal.push(tap.key);
  }
  return { envelopes, entries, legal };
}

const nextSeq = (envelopes: readonly EventEnvelope[]) =>
  (envelopes[envelopes.length - 1]?.seq ?? 0) + 1;

/** Whether the server would append `next` after `before`: the web's own refusals first, then the engine's, then ours. */
function mayAppend(match: Match, before: readonly EventEnvelope[], next: EventEnvelope): boolean {
  if (next.voids !== undefined && voidedIn(before).has(next.voids)) return false;
  if (tableTennisRefusalOf(match.engine, [...before, next]) !== null) return false;
  return mayCreditReceiver(match, before, next);
}

/** The events a void in `envelopes` takes back. */
function voidedIn(envelopes: readonly EventEnvelope[]): ReadonlySet<string> {
  return new Set(
    envelopes.flatMap((envelope) => (envelope.voids === undefined ? [] : [envelope.voids])),
  );
}

/**
 * A point that reached the receiver's thirteenth return (ITTF 2.15.2) credits the receiver only. The engine judges that
 * when the rally names `serving`; the pad's 13 returns tool does not (design §4.5: a stamp of the engine's own belief
 * would make its drift check check itself), so the engine counts such a point unchecked and never refuses it. This is
 * its check, on the fold so far: Expedite in force, the server known, and the point not the server's.
 */
function mayCreditReceiver(
  match: Match,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean {
  const winner = uncheckedReturnsWinner(match.names, next);
  if (winner === null) return true;
  const folded = foldOf(match.engine, before);
  if (folded === null || folded.state.expedite !== true) return false;
  const { side } = setBasedServeContext(tabletennis, folded.state, before);
  return side !== null && R.expediteReturnsCreditable(side, winner);
}

/** The engine's side for the winner of a rally that reached 13 returns and names no `serving`, else null. */
function uncheckedReturnsWinner(
  names: TableTennisNames,
  next: EventEnvelope,
): 'home' | 'away' | null {
  const { payload } = next;
  if (next.type !== RALLY || !isRecord(payload) || payload.serving !== undefined) return null;
  if (typeof payload.returns !== 'number' || payload.returns < R.expediteReturns) return null;
  const side = sideOfEntrant(names, payload.wonBy);
  return side === null ? null : ENGINE_SIDE[side];
}

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

/** The read path's tolerant fold, with each standing event's facts; null for a stream the engine will not replay. */
function foldOf(
  engine: TableTennisEngineMatch,
  envelopes: readonly EventEnvelope[],
): Folded | null {
  const facts = new Map<string, EventFacts>();
  try {
    const folded = foldMatchWithStoppage(tabletennis, engine.cfg, engine.lineups, envelopes, {
      onFolded: (state, event) => facts.set(event.id, factsOf(state, event.type)),
    });
    return { state: folded.state, facts };
  } catch (error) {
    if (EngineError.is(error)) return null;
    throw error;
  }
}

/**
 * The facts of an event, from the state just after it. A point, or a set score, is in the game it scored, which it may
 * close (a set score recorded whole closes it); anything else is in the game under way, or the next one between games.
 */
function factsOf(state: Readonly<SetBasedState>, type: string): EventFacts {
  const { sets } = state;
  const last = sets[sets.length - 1];
  const rally = type === RALLY;
  const inGame = last !== undefined && (rally || type === SUMMARY || !last.closed);
  return {
    game: inGame ? sets.length : sets.length + 1,
    after: inGame ? pointsOf(last) : ZERO,
    won: rally ? rallyWon(state, last) : 'none',
  };
}

function rallyWon(state: Readonly<SetBasedState>, set: SetState | undefined) {
  if (state.outcome !== null) return 'match';
  return set?.closed === true ? 'game' : 'none';
}

const pointsOf = (set: SetState): Readonly<Record<PadSide, number>> => ({
  first: set.home,
  second: set.away,
});

/**
 * What each event the pad has words for did, by envelope id: the standing ones from the fold, and each one a void
 * takes back from a fold of the stream up to it, so its row keeps the score it left.
 */
function recordedOf(
  match: Match,
  stream: Stream,
  folded: Folded,
  picked: PadSide | null,
): ReadonlyMap<string, Recorded> {
  const voided = voidedIn(stream.envelopes);
  const startServer = startServerOf(match.names, stream.envelopes, folded.facts, picked);
  const recorded = new Map<string, Recorded>();
  stream.envelopes.forEach((envelope, at) => {
    const facts =
      folded.facts.get(envelope.id) ??
      (voided.has(envelope.id) ? prefixFacts(match.engine, stream.envelopes, at) : undefined);
    const did = facts && doneOf(envelope, facts, match.names, startServer);
    if (facts && did) recorded.set(envelope.id, { did, facts });
  });
  return recorded;
}

/** The facts of the event at `at`, from a fold of the stream up to it; none if that prefix will not replay. */
function prefixFacts(
  engine: TableTennisEngineMatch,
  envelopes: readonly EventEnvelope[],
  at: number,
): EventFacts | undefined {
  const target = envelopes[at];
  return target && foldOf(engine, envelopes.slice(0, at + 1))?.facts.get(target.id);
}

/** The start's first server: the one the first standing point names; before any point, this phone's pick if shown. */
function startServerOf(
  names: TableTennisNames,
  envelopes: readonly EventEnvelope[],
  facts: ReadonlyMap<string, EventFacts>,
  picked: PadSide | null,
): PadSide | null {
  const first = envelopes.find((envelope) => envelope.type === RALLY && facts.has(envelope.id));
  if (first === undefined) return picked;
  return isRecord(first.payload) ? sideOfEntrant(names, first.payload.serving) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

type Extras = {
  readonly serve: SetBasedServeContext;
  /** This phone's pick, while it is the server shown (`pickedServer`); else null. */
  readonly picked: PadSide | null;
  readonly undoable: boolean;
  readonly recorded: ReadonlyMap<string, Recorded>;
};

function displayOf(
  match: Match,
  stream: Stream,
  folded: Folded,
  extras: Extras,
): TableTennisDisplay {
  const { state } = folded;
  const board = boardOf(state);
  return {
    sides: match.names.sides,
    context: match.context,
    ...board,
    ...serveOf(match, folded, extras),
    rules: rulesOf(match),
    phase: phaseOf(state, board.game, lastRallyGame(stream.envelopes, folded.facts)),
    expedite: expediteOf(match, state),
    deuce: R.deuceNote(state, match.rawCfg) !== null,
    records: recordsOf(match),
    lastTap: lastTapOf(stream.envelopes, extras.recorded),
    undoable: extras.undoable,
  };
}

/** The game under way and the games over. Once decided, the last game's points stay up. */
function boardOf(state: SetBasedState): Board {
  const closed = state.sets.filter((set) => set.closed).map(wonGame);
  const last = state.sets[state.sets.length - 1];
  const open = last !== undefined && !last.closed ? last : undefined;
  if (open !== undefined) {
    return { points: pointsOf(open), finished: closed, game: state.sets.length };
  }
  const lastWon = closed[closed.length - 1];
  if (state.phase !== 'live' && lastWon !== undefined) {
    return { points: lastWon.points, finished: closed, game: closed.length };
  }
  return { points: ZERO, finished: closed, game: closed.length + 1 };
}

const wonGame = (set: SetState): TableTennisGame => ({
  points: pointsOf(set),
  winner: set.home > set.away ? 'first' : 'second',
});

/** The game whose point was the last to stand, or 0 before any. */
function lastRallyGame(
  envelopes: readonly EventEnvelope[],
  facts: ReadonlyMap<string, EventFacts>,
): number {
  return envelopes.reduce(
    (game, envelope) => (envelope.type === RALLY ? (facts.get(envelope.id)?.game ?? game) : game),
    0,
  );
}

/** A game is under way once a point of it stands; before that, the match's first or between games. */
function phaseOf(state: SetBasedState, game: number, rallyGame: number): TableTennisPhase {
  if (state.phase === 'pre') return 'notStarted';
  if (state.phase !== 'live') return 'decided';
  if (rallyGame === game) return 'live';
  return game === 1 ? 'pre' : 'betweenGames';
}

/** The rules table and the strip, from the engine's own reading of the config. */
function rulesOf({ engine, rawCfg }: Match): TableTennisRules {
  const bestOf = R.bestOf(rawCfg);
  return {
    bestOf,
    setTo: R.setTo(rawCfg),
    finalSetTo: R.setTarget(rawCfg, bestOf - 1),
    winBy: engine.cfg.winBy,
    scoreBound: R.scoreBound(rawCfg),
  };
}

const recordsOf = ({ engine }: Match): TableTennisDisplay['records'] => ({
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
function serveOf(match: Match, folded: Folded, extras: Extras): ServeFacts {
  const { serve, picked } = extras;
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

/** The side due to serve, as the engine reads the ledger; else this phone's pick while it is shown; else null. */
function serverOf(serve: SetBasedServeContext, picked: PadSide | null): PadSide | null {
  if (serve.side === null) return picked;
  return serve.side === 'home' ? 'first' : 'second';
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
  match: Match,
  serve: SetBasedServeContext,
): { readonly name: string | null; readonly id: string | null } {
  const none = { name: null, id: null };
  if (serve.side === null) return none;
  const seat = match.seats[serve.side === 'home' ? 'first' : 'second'];
  if (seat.lineup.length !== PAIR_SIZE) return none;
  const member = seat.members.find((one) => one.personId === serve.serverPersonId);
  return member === undefined ? none : { name: member.fullName, id: member.personId };
}

/**
 * This phone's pick on the Start screen while it is the server to show, else null: only at the match's 0–0, started,
 * with the engine naming nobody because nothing has said who serves (`undeclared`). An undone point does not count as
 * played, so undoing the first point brings the pick back; a point still standing has scored, so the 0–0 rules the pick
 * out then, as it does after a set score.
 */
function pickedServer(
  state: SetBasedState,
  serve: SetBasedServeContext,
  toss: PadSide | null,
): PadSide | null {
  // At a started 0–0 with no standing point the engine can give no other reason: an equivalent mutant (badminton R9).
  if (state.phase !== 'live' || serve.unknownBecause !== 'undeclared') return null;
  return state.sets.some((set) => set.home > 0 || set.away > 0) ? null : toss;
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
function expediteOf(match: Match, state: SetBasedState): TableTennisExpedite {
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
// The last tap
// ---------------------------------------------------------------------------------------------------------------

/**
 * The last thing done that the pad has words for: the latest event, or the one the latest void took back, said as
 * undone. A start taken back returns to the Start screen, where no line shows.
 */
function lastTapOf(
  envelopes: readonly EventEnvelope[],
  recorded: ReadonlyMap<string, Recorded>,
): TableTennisLastTap | null {
  for (const envelope of [...envelopes].reverse()) {
    const taken = envelope.voids === undefined ? undefined : recorded.get(envelope.voids);
    if (taken !== undefined) return undoneOf(taken.did);
    const did = recorded.get(envelope.id)?.did;
    if (did !== undefined) return did;
  }
  return null;
}

function undoneOf(did: TableTennisDone): TableTennisLastTap | null {
  const tap = undoneTap(did);
  return tap === null ? null : { kind: 'undone', tap };
}

/** The tap Undo takes back, as the last-tap line names it, or null for the start (whose Undo shows no line). */
export function undoneTap(did: TableTennisDone): TableTennisUndoneTap | null {
  return did.kind === 'start' ? null : did;
}
