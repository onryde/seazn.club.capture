import { EngineError, foldMatchWithStoppage, type EventEnvelope } from '@seazn/engine/core';
import {
  setBasedServeContext,
  type SetBasedModule,
  type SetBasedServeContext,
  type SetBasedState,
  type SetState,
} from '@seazn/engine/sports/setbased';
import { isRecord } from '@/domain/credentials/wire';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';
import type { SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import { pickedServer, pointsOf, ZERO } from '@/domain/scoring/setBasedBoard';
import {
  envelopeOf,
  lineupOf,
  queuedEnvelopeOf,
  setBasedCfgOf,
  type SetBasedEngineMatch,
} from '@/domain/scoring/setBasedEngine';
import type { EventFacts, LedgerEntry, Recorded } from '@/domain/scoring/setBasedLedgerHistory';
import {
  namesOf,
  seatsOf,
  sideOfEntrant,
  type Seats,
  type SetBasedNames,
} from '@/domain/scoring/setBasedSides';
import { undoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf, type Bootstrap } from '@/domain/scoring/wire';

/**
 * The fold the set-based sports (badminton, table tennis) share (design §6; plan S2-1 Task 7, lifted for S2-2 Task 3): the
 * server's ledger with this phone's queued taps on top, folded through @seazn/engine. A generic file: it names no sport.
 * A sport gives a `SetBasedKit` (its engine module, its two event types, how it judges an append and what an event did)
 * and reads its display off the `SetBasedFolding` this returns; the engine decides every fact, this only reads them off.
 *
 * Each queued tap is judged as the server would judge its append on the ledger and the legal taps before it (the kit's
 * `mayAppend`). An illegal tap is skipped, never shown, and the ones behind it are judged without it (`stream.legal`,
 * which sync's `revalidate` takes).
 *
 * Cost: one strict fold of the whole stream per queued tap, one tolerant fold for the display, and one fold of a prefix
 * per event a void takes back (its row keeps the score it left). No incremental fold: every call refolds.
 */

/** A set-based sport's engine module and the two event types the shared fold reads by name. */
export type SetBasedEvents = {
  readonly module: SetBasedModule;
  /** The sport's rally event type (for instance `badminton.rally`): a point, which carries the server and the winner. */
  readonly rally: string;
  /** The sport's whole-game score event type (for instance `badminton.game.summary`). */
  readonly summary: string;
};

/** What a sport adds to the shared fold. `D` is the sport's type for what an event did. */
export type SetBasedKit<D> = SetBasedEvents & {
  /** Whether the server would append `next` after `before`: the web's own refusals first, then the engine's. */
  readonly mayAppend: (
    match: SetBasedMatch,
    before: readonly EventEnvelope[],
    next: EventEnvelope,
  ) => boolean;
  /** What an event did in the pad's words, or null for one the pad has none for. */
  readonly doneOf: (
    envelope: EventEnvelope,
    facts: EventFacts,
    names: SetBasedNames,
    startServer: PadSide | null,
  ) => D | null;
};

export type SetBasedMatch = {
  readonly engine: SetBasedEngineMatch;
  readonly rawCfg: unknown;
  readonly seats: Seats;
  readonly names: SetBasedNames;
  readonly context: MatchContext;
};

/** The ledger and the legal queued taps, as one stream in the order the server would hold them. */
export type SetBasedStream = {
  readonly envelopes: readonly EventEnvelope[];
  readonly entries: readonly LedgerEntry[];
  /** The queued taps' keys the match still takes, in order. */
  readonly legal: readonly string[];
};

export type SetBasedFolded = {
  readonly state: SetBasedState;
  readonly settlement: ReturnType<typeof foldMatchWithStoppage>['settlement'];
  /** What the fold said of each event still standing, by envelope id. */
  readonly facts: ReadonlyMap<string, EventFacts>;
};

/** Everything a sport reads its display off. */
export type SetBasedFolding<D> = {
  readonly match: SetBasedMatch;
  readonly stream: SetBasedStream;
  readonly folded: SetBasedFolded;
  readonly serve: SetBasedServeContext;
  /** This phone's pick, while it is the server shown (`pickedServer`); else null. */
  readonly picked: PadSide | null;
  readonly undoable: boolean;
  readonly recorded: ReadonlyMap<string, Recorded<D>>;
};

export function foldSetBased<D>(
  kit: SetBasedKit<D>,
  input: SportFoldInput,
): SetBasedFolding<D> | Unfoldable {
  const match = matchOf(kit, input.bootstrap);
  if (typeof match === 'string') return match;
  const stream = streamOf(match.engine.fixtureId, input, (before, next) =>
    kit.mayAppend(match, before, next),
  );
  const folded = foldOf(kit, match.engine, stream.envelopes);
  if (folded === null) return 'ledger';
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  const undoable =
    undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true).kind !== 'blocked';
  const serve = setBasedServeContext(kit.module, folded.state, stream.envelopes);
  const picked = pickedServer(folded.state, serve, input.toss);
  const recorded = recordedOf(kit, match, stream, folded, picked);
  return { match, stream, folded, serve, picked, undoable, recorded };
}

// ---------------------------------------------------------------------------------------------------------------
// The match, and the stream the server would hold
// ---------------------------------------------------------------------------------------------------------------

function matchOf<D>(kit: SetBasedKit<D>, bootstrap: Bootstrap): SetBasedMatch | Unfoldable {
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return 'sides';
  const cfg = setBasedCfgOf(kit.module, bootstrap.cfg);
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

/**
 * The stream the server would hold: the ledger, then each queued tap `mayAppend` says the server would take after the
 * events before it (an illegal tap is skipped and the ones behind it are judged without it). Any one-against-one sport's,
 * set-based or not: the sport gives its own judge of one append.
 */
export function streamOf(
  fixtureId: string,
  input: SportFoldInput,
  mayAppend: (before: readonly EventEnvelope[], next: EventEnvelope) => boolean,
): SetBasedStream {
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
    if (!mayAppend(envelopes, envelope)) continue;
    envelopes.push(envelope);
    entries.push({ envelope, own: true, sending: true });
    legal.push(tap.key);
  }
  return { envelopes, entries, legal };
}

const nextSeq = (envelopes: readonly EventEnvelope[]) =>
  (envelopes[envelopes.length - 1]?.seq ?? 0) + 1;

/** The events a void in `envelopes` takes back. */
export function voidedIn(envelopes: readonly EventEnvelope[]): ReadonlySet<string> {
  return new Set(
    envelopes.flatMap((envelope) => (envelope.voids === undefined ? [] : [envelope.voids])),
  );
}

/** The web's refusal of an undo of an event already undone (UNDO_ALREADY_VOIDED): `next` voids what `before` voided. */
export const voidsAgain = (before: readonly EventEnvelope[], next: EventEnvelope): boolean =>
  next.voids !== undefined && voidedIn(before).has(next.voids);

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

/** The read path's tolerant fold, with each standing event's facts; null for a stream the engine will not replay. */
export function foldOf(
  events: SetBasedEvents,
  engine: SetBasedEngineMatch,
  envelopes: readonly EventEnvelope[],
): SetBasedFolded | null {
  const facts = new Map<string, EventFacts>();
  try {
    const folded = foldMatchWithStoppage(events.module, engine.cfg, engine.lineups, envelopes, {
      onFolded: (state, event) => facts.set(event.id, factsOf(events, state, event.type)),
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
function factsOf(events: SetBasedEvents, state: Readonly<SetBasedState>, type: string): EventFacts {
  const { sets } = state;
  const last = sets[sets.length - 1];
  const rally = type === events.rally;
  const inGame = last !== undefined && (rally || type === events.summary || !last.closed);
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

/**
 * What each event the pad has words for did, by envelope id: the standing ones from the fold, and each one a void
 * takes back from a fold of the stream up to it, so its row keeps the score it left.
 */
function recordedOf<D>(
  kit: SetBasedKit<D>,
  match: SetBasedMatch,
  stream: SetBasedStream,
  folded: SetBasedFolded,
  picked: PadSide | null,
): ReadonlyMap<string, Recorded<D>> {
  const voided = voidedIn(stream.envelopes);
  const startServer = startServerOf(kit, match.names, stream.envelopes, folded.facts, picked);
  const recorded = new Map<string, Recorded<D>>();
  stream.envelopes.forEach((envelope, at) => {
    const facts =
      folded.facts.get(envelope.id) ??
      (voided.has(envelope.id) ? prefixFacts(kit, match.engine, stream.envelopes, at) : undefined);
    const did = facts && kit.doneOf(envelope, facts, match.names, startServer);
    if (facts && did) recorded.set(envelope.id, { did, facts });
  });
  return recorded;
}

/** The facts of the event at `at`, from a fold of the stream up to it; none if that prefix will not replay. */
function prefixFacts(
  events: SetBasedEvents,
  engine: SetBasedEngineMatch,
  envelopes: readonly EventEnvelope[],
  at: number,
): EventFacts | undefined {
  const target = envelopes[at];
  return target && foldOf(events, engine, envelopes.slice(0, at + 1))?.facts.get(target.id);
}

const FIRST_GAME = 1;

/**
 * The start's first server: the one the first standing rally names, if that rally is game 1's; before any rally, this
 * phone's pick if shown. A rally names the server of its own game, so when game 1 was entered whole by Set score the first
 * standing rally is game 2's, and its server is that game's first server, not the match's: nobody is named.
 */
function startServerOf(
  events: SetBasedEvents,
  names: SetBasedNames,
  envelopes: readonly EventEnvelope[],
  facts: ReadonlyMap<string, EventFacts>,
  picked: PadSide | null,
): PadSide | null {
  const first = envelopes.find(
    (envelope) => envelope.type === events.rally && facts.has(envelope.id),
  );
  if (first === undefined) return picked;
  if (facts.get(first.id)?.game !== FIRST_GAME) return null;
  return isRecord(first.payload) ? sideOfEntrant(names, first.payload.serving) : null;
}
