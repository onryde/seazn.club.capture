import type { EventEnvelope } from '@seazn/engine/core';
import { volleyballPadRules } from '@seazn/engine/pad';
import {
  volleyball,
  type SetBasedServeContext,
  type SetBasedServeUnknown,
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
  foldSetBased,
  voidsAgain,
  type SetBasedFolding,
  type SetBasedKit,
  type SetBasedMatch,
} from '@/domain/scoring/setBasedFold';
import { heaviestLevel } from '@/domain/scoring/setBasedPad';
import { sideOfEntrant } from '@/domain/scoring/setBasedSides';
import { isBeach, volleyballRefusalOf } from '@/domain/scoring/volleyballEngine';
import { scoreEventsIn } from '@/domain/scoring/volleyballEvents';
import { volleyballLineupOf } from '@/domain/scoring/volleyballLineup';
import { doneOf, isSanctionLevel } from '@/domain/scoring/volleyballLedgerHistory';
import type {
  VolleyballCaps,
  VolleyballCounts,
  VolleyballDisplay,
  VolleyballDone,
  VolleyballRecords,
  VolleyballRules,
  VolleyballSanctionLevel,
  VolleyballTypes,
  VolleyballUndoneTap,
} from '@/domain/scoring/volleyballTypes';

/**
 * A volleyball match on the pad (S2-6 Task 4; spec §4–§5): the server's ledger with this phone's queued taps on top,
 * folded through @seazn/engine, as the pad draws it. The engine decides every fact (the serve, the deciding set's toss,
 * the server of a beach pair: `setBasedServeContext`, never arithmetic of ours); this only reads them off, and counts
 * what the engine does not count per set (timeouts) or does not tie to a set the pad can see (a sanction's set).
 *
 * The fold itself is the set-based sports' to share (`setBasedFold`); this is volleyball's part: the judgement of an
 * append (the web's refusal of an undo already undone, then the engine's) and the display.
 */

const R = volleyballPadRules;

const KIT: SetBasedKit<VolleyballDone> = {
  module: volleyball,
  rally: 'volleyball.rally',
  summary: 'volleyball.set.summary',
  lineupsOf: volleyballLineupOf,
  mayAppend,
  doneOf,
};

export function foldVolleyball(input: SportFoldInput): SportFold<VolleyballTypes> {
  const folding = foldSetBased(KIT, input);
  if (typeof folding === 'string') return { kind: 'unfoldable', reason: folding };
  const display = displayOf(folding);
  // History's words are Task 8's: until they land the fold says no rows.
  return { kind: 'folded', display, legalQueued: folding.stream.legal, history: [] };
}

/** Whether the server would append `next` after `before`: the web's own refusals first, then the engine's. */
function mayAppend(
  match: SetBasedMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean {
  if (voidsAgain(before, next)) return false;
  return volleyballRefusalOf(match.engine, [...before, next]) === null;
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

/**
 * An indoor side is its team's name, as the organiser typed it: the bootstrap's members are the whole roster, and the
 * generic reading (`namesOf`: a side's names are its members') would read a squad as "A / B / C / D / E / F / G".
 * Beach keeps the pair's two players.
 */
const teamSides = (seats: SetBasedMatch['seats']): VolleyballDisplay['sides'] => ({
  first: { players: [seats.first.name] },
  second: { players: [seats.second.name] },
});

function displayOf(folding: SetBasedFolding<VolleyballDone>): VolleyballDisplay {
  const { match, stream, folded } = folding;
  const { state } = folded;
  const board = boardOf(state);
  const beach = isBeach(match.engine.cfg);
  const serve = serveOf(match, folding, beach);
  return {
    sides: beach ? match.names.sides : teamSides(match.seats),
    context: match.context,
    points: board.points,
    finished: board.finished,
    set: board.game,
    target: R.setTarget(match.rawCfg, board.game - 1),
    rules: rulesOf(match),
    phase: phaseOf(state, board.game, lastRallyGame(stream.envelopes, folded.facts, KIT.rally)),
    beach,
    ...serve,
    scoreEvents: scoreEventsIn(stream.envelopes),
    note: R.deuceNote(state, match.rawCfg),
    counts: countsOf(folding, board.game),
    caps: capsOf(beach),
    heaviest: heaviestOf(folding, board.game),
    records: recordsOf(match),
    lastTap: lastTapOf(stream.envelopes, folding.recorded, undoneTap),
    undoable: folding.undoable,
  };
}

/** The rules table and the strip, from the engine's own reading of the config. */
function rulesOf({ engine, rawCfg }: SetBasedMatch): VolleyballRules {
  const bestOf = R.bestOf(rawCfg);
  return {
    bestOf,
    setTo: R.setTo(rawCfg),
    finalSetTo: R.setTarget(rawCfg, bestOf - 1),
    winBy: engine.cfg.winBy,
    scoreBound: R.scoreBound(rawCfg),
  };
}

const recordsOf = ({ engine }: SetBasedMatch): VolleyballRecords => ({
  timeouts: engine.cfg.records.timeouts,
  sanctions: engine.cfg.records.sanctions,
  substitutions: engine.cfg.records.substitutions,
});

/** FIVB's numbers: two timeouts and six substitutions a set; beach one timeout and no substitutions (ruling 175). */
const capsOf = (beach: boolean): VolleyballCaps =>
  beach ? { timeouts: 1, subs: 0 } : { timeouts: 2, subs: 6 };

/** The tap Undo takes back, as the last-tap line names it, or null for the start (whose Undo shows no line). */
export function undoneTap(did: VolleyballDone): VolleyballUndoneTap | null {
  return did.kind === 'start' ? null : did;
}

// ---------------------------------------------------------------------------------------------------------------
// The serve
// ---------------------------------------------------------------------------------------------------------------

type ServeFacts = Pick<
  VolleyballDisplay,
  'serving' | 'serverPicked' | 'serverPerson' | 'serverPersonId' | 'anchorNeeded'
>;

/** Everything the pad says about the serve, from the engine's reader and this phone's pick. */
function serveOf(
  match: SetBasedMatch,
  folding: SetBasedFolding<VolleyballDone>,
  beach: boolean,
): ServeFacts {
  const { serve, picked, folded } = folding;
  const person = beach ? serverPersonOf(match, serve) : NO_PERSON;
  return {
    serving: serverOf(serve, picked),
    serverPicked: picked !== null,
    serverPerson: person.name,
    serverPersonId: person.id,
    anchorNeeded: needsAnchor(serve, folded.state.phase === 'live', picked !== null),
  };
}

const NO_PERSON = { name: null, id: null } as const;

/**
 * The beach server the engine names, from the team sheet's pair order, as a name and an id: only for a side whose
 * bootstrap lists exactly its pair (ruling 173, 188). Indoor names the serving side only.
 */
function serverPersonOf(
  match: SetBasedMatch,
  serve: SetBasedServeContext,
): { readonly name: string | null; readonly id: string | null } {
  if (serve.side === null) return NO_PERSON;
  const seat = match.seats[serve.side === 'home' ? 'first' : 'second'];
  if (seat.lineup.length !== PAIR_SIZE) return NO_PERSON;
  const member = seat.members.find((one) => one.personId === serve.serverPersonId);
  return member === undefined ? NO_PERSON : { name: member.fullName, id: member.personId };
}

const PAIR_SIZE = 2;

/** The reasons the engine will not name a server that no new declaration mends: a dispute, a mismatch. */
const NO_DECLARATION_MENDS: readonly SetBasedServeUnknown[] = [
  'recorded-disagrees',
  'ledger-mismatch',
];

/**
 * Whether the pad asks Who serves first? (rulings 179, 180): the match is live, the engine names nobody, this phone's
 * Start pick is not the server shown (`serverPicked`), and the engine's reason is a gap a declaration fills (the deciding
 * set's `deciding-set-toss`, a match started elsewhere) and not drift, which no new answer mends.
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
// Counts and sanctions, per set (rulings 175, 187)
// ---------------------------------------------------------------------------------------------------------------

/**
 * What the stream holds of each standing event of the set under way, by the set the engine's facts put it in: an event
 * after a set closes and before the next set's first rally is the next set's (`facts.game`). A voided event has no facts, so
 * an Undo takes it out; a refused queued tap is not in the stream.
 */
function eventsOfSet(
  folding: SetBasedFolding<VolleyballDone>,
  set: number,
  type: string,
): readonly EventEnvelope[] {
  const { stream, folded } = folding;
  return stream.envelopes.filter(
    (envelope) => envelope.type === type && folded.facts.get(envelope.id)?.game === set,
  );
}

function countsOf(
  folding: SetBasedFolding<VolleyballDone>,
  set: number,
): Readonly<Record<PadSide, VolleyballCounts>> {
  const { names } = folding.match;
  const count = (type: string, side: PadSide) =>
    eventsOfSet(folding, set, type).filter(
      (envelope) =>
        isRecord(envelope.payload) && sideOfEntrant(names, envelope.payload.by) === side,
    ).length;
  const of = (side: PadSide): VolleyballCounts => ({
    timeouts: count('volleyball.timeout', side),
    subs: count('volleyball.sub', side),
  });
  return { first: of('first'), second: of('second') };
}

/** The engine's order of its levels (`volleyballPadRules.sanctionLevels`), lightest first: never a list of our own. */
const LEVEL_ORDER: readonly VolleyballSanctionLevel[] = R.sanctionLevels.filter(isSanctionLevel);

/** The heaviest sanction each side holds in the set: the engine's record has no set, so the walk is over the stream. */
function heaviestOf(
  folding: SetBasedFolding<VolleyballDone>,
  set: number,
): Readonly<Record<PadSide, VolleyballSanctionLevel | null>> {
  const { names } = folding.match;
  const held = eventsOfSet(folding, set, 'volleyball.sanction').flatMap((envelope) =>
    isRecord(envelope.payload)
      ? [{ side: sideOfEntrant(names, envelope.payload.by), level: String(envelope.payload.level) }]
      : [],
  );
  const of = (side: PadSide) =>
    heaviestLevel(
      LEVEL_ORDER,
      held.filter((one) => one.side === side).map((one) => one.level),
    );
  return { first: of('first'), second: of('second') };
}
