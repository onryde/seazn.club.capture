import {
  EngineError,
  foldMatchWithStoppage,
  lastLiveEvent,
  matchEndFacts,
  pendingEndingSanction,
  scorerMayForfeit,
  type EventEnvelope,
} from '@seazn/engine/core';
import { badmintonPadRules } from '@seazn/engine/pad';
import {
  badminton,
  setBasedServeContext,
  type SetBasedCfg,
  type SetBasedServeContext,
  type SetBasedState,
  type SetState,
} from '@seazn/engine/sports/setbased';
import { isRecord } from '@/domain/credentials/wire';
import {
  badmintonCfg,
  envelopeOf,
  lineupOf,
  queuedEnvelopeOf,
  refusalOf,
  type BadmintonEngineMatch,
} from '@/domain/scoring/badmintonEngine';
import { seatsOf } from '@/domain/scoring/badmintonEvents';
import {
  doneOf,
  ledgerHistory,
  namesOf,
  personName,
  sideOfEntrant,
  type BadmintonNames,
  type EventFacts,
  type LedgerEntry,
  type Recorded,
} from '@/domain/scoring/badmintonLedgerHistory';
import {
  SANCTION_LEVELS,
  type BadmintonDisplay,
  type BadmintonDone,
  type BadmintonGame,
  type BadmintonLastTap,
  type BadmintonPadKey,
  type BadmintonPhase,
  type BadmintonSanction,
  type BadmintonUndoneTap,
} from '@/domain/scoring/badmintonPad';
import type { BadmintonRules } from '@/domain/scoring/badmintonRules';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadHistoryGroup, PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { undoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf, type Bootstrap, type LedgerEvent } from '@/domain/scoring/wire';

/**
 * A badminton match on the pad (design §6.2, §7.3; plan S2-1 Task 7): the server's ledger with this phone's queued taps
 * on top, folded through @seazn/engine, as the pad draws it. The engine decides every fact; this only reads them off.
 *
 * Each queued tap is judged as the server would judge its append on the ledger and the legal taps before it: the
 * engine's strict fold, the web's refusal of an undo of an event already undone (UNDO_ALREADY_VOIDED), and its rule
 * that a scorer's forfeit is only the ending of the sanction right before it (D13). An illegal tap is skipped, never
 * shown, and the ones behind it are judged without it (`legalQueued`, which sync's `revalidate` takes).
 *
 * Cost: one strict fold of the whole stream per queued tap, one tolerant fold for the display, and one fold of a prefix
 * per event a void takes back (its row keeps the score it left). No incremental fold: every call refolds.
 */
export type BadmintonFoldInput = {
  readonly bootstrap: Bootstrap;
  /** The server's ledger, in seq order. */
  readonly ledger: readonly LedgerEvent[];
  /** This phone's queued taps, oldest first. */
  readonly queued: readonly QueuedEvent[];
  /** The ids of the events this phone recorded, the stand-ins built from accepted taps included (design §6.2). */
  readonly ownEventIds: readonly string[];
  /** The side this phone picked to serve first, or null: the start's server until the first rally names it. */
  readonly toss: PadSide | null;
};

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
export type BadmintonUnfoldable = 'sides' | 'cfg' | 'ledger';

type Match = {
  readonly engine: BadmintonEngineMatch;
  readonly rawCfg: unknown;
  readonly names: BadmintonNames;
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
  readonly settlement: Parameters<typeof matchEndFacts>[1]['settlement'];
  /** What the fold said of each event still standing, by envelope id. */
  readonly facts: ReadonlyMap<string, EventFacts>;
};

type Board = Pick<BadmintonDisplay, 'points' | 'finished' | 'game'>;

const RALLY = 'badminton.rally';
const FORFEIT = 'core.forfeit';
const SUMMARY = 'badminton.game.summary';
const ZERO: Readonly<Record<PadSide, number>> = { first: 0, second: 0 };
const R = badmintonPadRules;

export function foldBadminton(input: BadmintonFoldInput): BadmintonFold {
  const match = matchOf(input.bootstrap);
  if (typeof match === 'string') return { kind: 'unfoldable', reason: match };
  const stream = streamOf(match, input);
  const folded = foldOf(match.engine, stream.envelopes);
  if (folded === null) return { kind: 'unfoldable', reason: 'ledger' };
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  const undoable =
    undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true).kind !== 'blocked';
  const serve = setBasedServeContext(badminton, folded.state, stream.envelopes);
  const picked = pickedServer(folded.state, serve, input);
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

function matchOf(bootstrap: Bootstrap): Match | BadmintonUnfoldable {
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return 'sides';
  const cfg = cfgOf(bootstrap.cfg);
  if (cfg === null) return 'cfg';
  const lineups = { home: lineupOf(seats.first), away: lineupOf(seats.second) };
  return {
    engine: { fixtureId: bootstrap.fixtureId, cfg, lineups },
    rawCfg: bootstrap.cfg,
    names: namesOf(seats),
    context,
  };
}

/** The config through the engine's schema, or null for one it refuses (its own refusal is all a throw here can be). */
function cfgOf(raw: unknown): SetBasedCfg | null {
  try {
    return badmintonCfg(raw);
  } catch {
    return null;
  }
}

function streamOf(match: Match, input: BadmintonFoldInput): Stream {
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
    if (!mayAppend(match.engine, envelopes, envelope)) continue;
    envelopes.push(envelope);
    entries.push({ envelope, own: true, sending: true });
    legal.push(tap.key);
  }
  return { envelopes, entries, legal };
}

const nextSeq = (envelopes: readonly EventEnvelope[]) =>
  (envelopes[envelopes.length - 1]?.seq ?? 0) + 1;

/** Whether the server would append `next` after `before`: the web's own refusals first, then the engine's. */
function mayAppend(
  engine: BadmintonEngineMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean {
  if (next.voids !== undefined && voidedIn(before).has(next.voids)) return false;
  if (next.type === FORFEIT && !scorerMayEnd(before, next.payload)) return false;
  return refusalOf(engine, [...before, next]) === null;
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

/** The events a void in `envelopes` takes back. */
function voidedIn(envelopes: readonly EventEnvelope[]): ReadonlySet<string> {
  return new Set(
    envelopes.flatMap((envelope) => (envelope.voids === undefined ? [] : [envelope.voids])),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

/** The read path's tolerant fold, with each standing event's facts; null for a stream the engine will not replay. */
function foldOf(engine: BadmintonEngineMatch, envelopes: readonly EventEnvelope[]): Folded | null {
  const facts = new Map<string, EventFacts>();
  try {
    const folded = foldMatchWithStoppage(badminton, engine.cfg, engine.lineups, envelopes, {
      onFolded: (state, event) => facts.set(event.id, factsOf(state, event.type)),
    });
    return { state: folded.state, settlement: folded.settlement, facts };
  } catch (error) {
    if (EngineError.is(error)) return null;
    throw error;
  }
}

/**
 * The facts of an event, from the state just after it. A rally, or a set score, is in the game it scored, which it may
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
    sanctionedPerson: state.sanctions?.[state.sanctions.length - 1]?.person ?? null,
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
  engine: BadmintonEngineMatch,
  envelopes: readonly EventEnvelope[],
  at: number,
): EventFacts | undefined {
  const target = envelopes[at];
  return target && foldOf(engine, envelopes.slice(0, at + 1))?.facts.get(target.id);
}

/** The start's first server: the one the first standing rally names; before any rally, this phone's pick if shown. */
function startServerOf(
  names: BadmintonNames,
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

function displayOf(match: Match, stream: Stream, folded: Folded, extras: Extras): BadmintonDisplay {
  const { state } = folded;
  const board = boardOf(match.names, state);
  const phase = phaseOf(state, board.game, lastRallyGame(stream.envelopes, folded.facts));
  const server = serverOf(extras.serve, extras.picked);
  return {
    sides: match.names.sides,
    context: match.context,
    ...board,
    server,
    court: server === null ? 'right' : R.serviceCourt(board.points[server]),
    rules: rulesOf(match, board.game),
    phase,
    sanctions: sanctionsOf(match.names, state),
    lastTap: lastTapOf(stream.envelopes, extras.recorded),
    undoable: extras.undoable,
    awaitingEnding: awaitingEnding(stream.envelopes, folded),
    serverPicked: extras.picked !== null,
  };
}

/**
 * The game under way and the games over: a game won on a rally boxed with its winner, and the game a disqualification
 * ended (owner ruling 18) boxed DQ at its points then. Once decided, the last game's points stay up.
 */
function boardOf(names: BadmintonNames, state: SetBasedState): Board {
  const closed = state.sets.filter((set) => set.closed).map(wonGame);
  const last = state.sets[state.sets.length - 1];
  const open = last !== undefined && !last.closed ? last : undefined;
  const disqualified = disqualifiedSide(names, state);
  if (disqualified !== null) {
    const points = open === undefined ? ZERO : pointsOf(open);
    return { points, finished: [...closed, { points, disqualified }], game: closed.length + 1 };
  }
  if (open !== undefined)
    return { points: pointsOf(open), finished: closed, game: state.sets.length };
  const lastWon = closed[closed.length - 1];
  if (state.phase !== 'live' && lastWon !== undefined) {
    return { points: lastWon.points, finished: closed, game: closed.length };
  }
  return { points: ZERO, finished: closed, game: closed.length + 1 };
}

const wonGame = (set: SetState): BadmintonGame => ({
  points: pointsOf(set),
  winner: set.home > set.away ? 'first' : 'second',
});

function disqualifiedSide(names: BadmintonNames, state: SetBasedState): PadSide | null {
  const { outcome } = state;
  if (outcome?.kind !== 'award' || outcome.reason !== 'disqualified') return null;
  return sideOfEntrant(names, outcome.loser);
}

/** The game whose rally was the last to stand, or 0 before any. */
function lastRallyGame(
  envelopes: readonly EventEnvelope[],
  facts: ReadonlyMap<string, EventFacts>,
): number {
  return envelopes.reduce(
    (game, envelope) => (envelope.type === RALLY ? (facts.get(envelope.id)?.game ?? game) : game),
    0,
  );
}

/** A game is under way once a rally of it stands; before that, the match's first or between games. */
function phaseOf(state: SetBasedState, game: number, rallyGame: number): BadmintonPhase {
  if (state.phase === 'pre') return 'notStarted';
  if (state.phase !== 'live') return 'decided';
  if (rallyGame === game) return 'live';
  return game === 1 ? 'pre' : 'betweenGames';
}

/** The side due to serve, as the engine reads the ledger; else this phone's pick while it is shown; else null. */
function serverOf(serve: SetBasedServeContext, picked: PadSide | null): PadSide | null {
  if (serve.side === null) return picked;
  return serve.side === 'home' ? 'first' : 'second';
}

/**
 * This phone's pick on the Start screen while it is the server to show, else null (the controller's rulings,
 * 2026-11-02): only at the match's 0–0, started, with the engine naming nobody because nothing has said who serves
 * (`undeclared`), and only while the server's ledger holds no rally at all, an undone one included: the first send of
 * the first rally drops its `serving` then (`payloadForSend`). After a set score the engine still says `undeclared`,
 * so it is the 0–0 that rules the pick out there: a `serving` at 5–3 would be a false fact in the ledger.
 */
function pickedServer(
  state: SetBasedState,
  serve: SetBasedServeContext,
  input: BadmintonFoldInput,
): PadSide | null {
  if (state.phase !== 'live' || serve.unknownBecause !== 'undeclared') return null;
  if (state.sets.some((set) => set.home > 0 || set.away > 0)) return null;
  return input.ledger.some((event) => event.type === RALLY) ? null : input.toss;
}

/**
 * The rules table and the strip, from the engine's own reading of the config. The interval point is the game's on the
 * pad: a deciding game played to fewer points has its own (`intervalMark` of that game).
 */
function rulesOf({ engine, rawCfg }: Match, game: number): BadmintonRules {
  return {
    bestOf: R.bestOf(rawCfg),
    points: R.setTo(rawCfg),
    winBy: engine.cfg.winBy,
    cap: engine.cfg.cap,
    intervalPoint: R.intervalMark(rawCfg, game - 1),
  };
}

function sanctionsOf(names: BadmintonNames, state: SetBasedState): readonly BadmintonSanction[] {
  return (state.sanctions ?? []).flatMap((record) => {
    const level = SANCTION_LEVELS.find((known) => known === record.level);
    const side: PadSide = record.by === 'home' ? 'first' : 'second';
    return level === undefined
      ? []
      : [{ side, level, person: personName(names, side, record.person) }];
  });
}

/** A disqualification stands with no ending after it (the engine's own reading, as the web's write path reads it). */
function awaitingEnding(envelopes: readonly EventEnvelope[], folded: Folded): boolean {
  const ended = matchEndFacts(badminton, folded, envelopes);
  return pendingEndingSanction(badminton, envelopes, ended) !== null;
}

/**
 * The last thing done that the pad has words for: the latest event, or the one the latest void took back, said as
 * undone. A start taken back returns to the Start screen, where no line shows.
 */
function lastTapOf(
  envelopes: readonly EventEnvelope[],
  recorded: ReadonlyMap<string, Recorded>,
): BadmintonLastTap | null {
  for (const envelope of [...envelopes].reverse()) {
    const taken = envelope.voids === undefined ? undefined : recorded.get(envelope.voids);
    if (taken !== undefined) return undoneOf(taken.did);
    const did = recorded.get(envelope.id)?.did;
    if (did !== undefined) return did;
  }
  return null;
}

function undoneOf(did: BadmintonDone): BadmintonLastTap | null {
  const tap = undoneTap(did);
  return tap === null ? null : { kind: 'undone', tap };
}

function undoneTap(did: BadmintonDone): BadmintonUndoneTap | null {
  switch (did.kind) {
    case 'start':
      return null;
    case 'rally':
      return { kind: 'rally', side: did.side };
    default:
      return did;
  }
}
