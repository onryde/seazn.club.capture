import {
  EngineError,
  foldMatchWithStoppage,
  type EventEnvelope,
  type LineupPair,
} from '@seazn/engine/core';
import { tennisPadRules } from '@seazn/engine/pad';
import { serveContext, type NestedState } from '@seazn/engine/sports/nested';
import { tennis } from '@seazn/engine/sports/tennis';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import type { SportFold, SportFoldInput } from '@/domain/scoring/scoringSport';
import { lastTapOf } from '@/domain/scoring/setBasedBoard';
import { envelopeOf, queuedEnvelopeOf } from '@/domain/scoring/setBasedEngine';
import { standing } from '@/domain/scoring/setBasedEvents';
import { heaviestLevel } from '@/domain/scoring/setBasedPad';
import {
  namesOf,
  scoreText,
  seatsOf,
  sideOfEntrant,
  type SetBasedNames,
} from '@/domain/scoring/setBasedSides';
import { streamOf, voidedIn, voidsAgain, type SetBasedStream } from '@/domain/scoring/setBasedFold';
import type { MatchContext } from '@/domain/scoring/matchContext';
import {
  tennisCfgOf,
  tennisLineupOf,
  tennisRefusalOf,
  type TennisCfg,
  type TennisEngineMatch,
} from '@/domain/scoring/tennisEngine';
import { tennisHistory, type TennisHistoryEntry } from '@/domain/scoring/tennisHistory';
import {
  endingKindOf,
  isSeenLevel,
  tennisDoneOf,
  type TennisFacts,
} from '@/domain/scoring/tennisLedgerHistory';
import type {
  TennisDisplay,
  TennisDone,
  TennisEnding,
  TennisPhase,
  TennisSeenLevel,
  TennisSetLine,
  TennisTypes,
  TennisUndoneTap,
} from '@/domain/scoring/tennisTypes';
import { undoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf } from '@/domain/scoring/wire';

/**
 * A tennis match on the pad (S2-7 Task 4; spec §3, rulings 216, 222-225, 229; G1): the server's ledger with this phone's
 * queued taps on top, folded through @seazn/engine's nested kernel, as the pad draws it. The engine decides every fact (the
 * call, the breaker, the serve, the change of ends); this reads them off. It is volleyball's twin over the nested kernel:
 * `foldSetBased` is typed to the set-based kernel and is not generalised (ruling 224), so this folds on its own and takes
 * only the generic helpers (the stream, the voids, the sides).
 *
 * Every `tennisPadRules` member the fold calls goes through `guarded`: they read the state and answer or throw on a
 * config the schema would refuse, and the schema accepts configs the write path refuses (a best of 1 with a match
 * tie-break), so an invalid config must never throw out of the fold.
 */

const R = tennisPadRules;

/** One read of the engine's pad rules, or `fallback` when the rules throw on this match's state or config. */
function guarded<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

type Match = {
  readonly engine: TennisEngineMatch;
  readonly names: SetBasedNames;
  readonly context: MatchContext;
};

type Folded = {
  readonly state: NestedState;
  /** What the fold said of each event still standing, by envelope id. */
  readonly facts: ReadonlyMap<string, TennisFacts>;
};

export function foldTennis(input: SportFoldInput): SportFold<TennisTypes> {
  const { bootstrap } = input;
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return { kind: 'unfoldable', reason: 'sides' };
  const cfg = tennisCfgOf(bootstrap.cfg);
  if (cfg === null) return { kind: 'unfoldable', reason: 'cfg' };
  const lineups = { home: tennisLineupOf(seats.first), away: tennisLineupOf(seats.second) };
  const match: Match = {
    engine: { fixtureId: bootstrap.fixtureId, cfg, lineups },
    names: namesOf(seats),
    context,
  };
  const stream = streamOf(bootstrap.fixtureId, input, (before, next) =>
    mayAppend(match, before, next),
  );
  const folded = foldOf(cfg, lineups, stream.envelopes);
  if (folded === null) return { kind: 'unfoldable', reason: 'ledger' };
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  const undoable =
    undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true).kind !== 'blocked';
  const recorded = recordedOf(match, cfg, stream, folded);
  const display = displayOf(match, cfg, stream, folded, recorded, undoable);
  return {
    kind: 'folded',
    display,
    legalQueued: stream.legal,
    history: tennisHistory(rowsOf(stream, recorded), display.sides),
  };
}

/** Whether the server would append `next` after `before`: the web's own refusal of a double undo, then the engine's. */
function mayAppend(match: Match, before: readonly EventEnvelope[], next: EventEnvelope): boolean {
  if (voidsAgain(before, next)) return false;
  return tennisRefusalOf(match.engine, [...before, next]) === null;
}

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

/** The read path's tolerant fold with each standing event's facts; null for a stream the engine will not replay. */
function foldOf(
  cfg: TennisCfg,
  lineups: LineupPair,
  envelopes: readonly EventEnvelope[],
): Folded | null {
  const facts = new Map<string, TennisFacts>();
  let before = { sets: 0, games: 0 };
  try {
    const { state } = foldMatchWithStoppage(tennis, cfg, lineups, envelopes, {
      onFolded: (after, event) => {
        facts.set(event.id, factsOf(before, after));
        before = tally(after);
      },
    });
    return { state, facts };
  } catch (error) {
    if (EngineError.is(error)) return null;
    throw error;
  }
}

const tally = (state: Readonly<NestedState>) => ({
  sets: state.sets.length,
  games: state.games.home + state.games.away,
});

/**
 * The facts of an event, from the state just after it and the tally just before: a point that closed a set is in that set
 * (the kernel moved on to the next); anything else is in the set under way, which is the next one between sets.
 */
function factsOf(
  before: { sets: number; games: number },
  state: Readonly<NestedState>,
): TennisFacts {
  const closedSet = state.sets.length > before.sets;
  const gameWon = closedSet || state.games.home + state.games.away > before.games;
  const over = state.phase === 'done' || state.phase === 'final';
  const won = closedSet && over ? 'match' : closedSet ? 'set' : gameWon ? 'game' : 'none';
  return {
    set: closedSet ? state.sets.length : state.sets.length + 1,
    won,
    after: afterOf(state, gameWon, closedSet),
  };
}

/** The board a point left: the games of the game or set it closed, else the game's call. */
function afterOf(state: Readonly<NestedState>, gameWon: boolean, closedSet: boolean): string {
  const closed = state.sets[state.sets.length - 1];
  if (closedSet && closed !== undefined) return scoreText(pairOf(closed));
  if (gameWon) return scoreText(pairOf(state.games));
  const call = callsOf(state);
  return `${call.first}–${call.second}`;
}

/**
 * What each event the pad has words for did, with its facts, by envelope id: the standing ones from the fold, and each one
 * a void takes back from a fold of the stream up to it, so Undo's line keeps what the tap did.
 */
function recordedOf(
  match: Match,
  cfg: TennisCfg,
  stream: SetBasedStream,
  folded: Folded,
): ReadonlyMap<string, Recorded> {
  const voided = voidedIn(stream.envelopes);
  const recorded = new Map<string, Recorded>();
  stream.envelopes.forEach((envelope, at) => {
    const facts =
      folded.facts.get(envelope.id) ??
      (voided.has(envelope.id) ? prefixFacts(match, cfg, stream.envelopes, at) : undefined);
    const did = facts && tennisDoneOf(envelope, facts, match.names);
    if (facts && did) recorded.set(envelope.id, { did, facts });
  });
  return recorded;
}

/** One event the pad has words for: what it did, and the fold's facts of it. */
type Recorded = { readonly did: TennisDone; readonly facts: TennisFacts };

/** History's rows: one for each event the pad has words for, in the stream's order, an event a void takes back marked. */
function rowsOf(
  stream: SetBasedStream,
  recorded: ReadonlyMap<string, Recorded>,
): readonly TennisHistoryEntry[] {
  const voided = voidedIn(stream.envelopes);
  return stream.entries.flatMap((entry) => {
    const event = recorded.get(entry.envelope.id);
    if (event === undefined) return [];
    return [
      {
        did: event.did,
        set: event.facts.set,
        after: event.facts.after,
        own: entry.own,
        undone: voided.has(entry.envelope.id),
        sending: entry.sending,
      },
    ];
  });
}

/** The facts of the event at `at`, from a fold of the stream up to it; none if that prefix will not replay. */
function prefixFacts(
  match: Match,
  cfg: TennisCfg,
  envelopes: readonly EventEnvelope[],
  at: number,
): TennisFacts | undefined {
  const target = envelopes[at];
  const prefix = foldOf(cfg, match.engine.lineups, envelopes.slice(0, at + 1));
  return target && prefix?.facts.get(target.id);
}

/** The tap Undo takes back, as the last-tap line names it, or null for the start (whose Undo shows no line) or an ending. */
export function undoneTap(did: TennisDone): TennisUndoneTap | null {
  return did.kind === 'start' || did.kind === 'ending' ? null : did;
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

const sideOf = (engineSide: 'home' | 'away'): PadSide =>
  engineSide === 'home' ? 'first' : 'second';

const pairOf = (score: { readonly home: number; readonly away: number }) => ({
  first: score.home,
  second: score.away,
});

function displayOf(
  match: Match,
  cfg: TennisCfg,
  stream: SetBasedStream,
  { state, facts }: Folded,
  recorded: ReadonlyMap<string, Recorded>,
  undoable: boolean,
): TennisDisplay {
  const ending = endingOf(state, match.names);
  const phase = phaseOf(state, ending);
  const decided = phase === 'decided';
  const last = state.sets[state.sets.length - 1];
  const set = decided ? state.sets.length : state.sets.length + 1;
  return {
    sides: match.names.sides,
    doubles: match.names.members.first.length > 1,
    context: match.context,
    cfg,
    phase,
    set,
    games: pairOf(decided && last !== undefined ? last : state.games),
    call: callsOf(state),
    breaker: state.points.kind === 'standard' ? null : state.points.kind,
    note: noteOf(state, cfg),
    endsChanged: guarded(() => R.endsChanged(state), false),
    serving: servingOf(state),
    setsWon: pairOf(state.setsWon),
    finished: state.sets.map((closed) => setLineOf(closed)),
    heaviest: heaviestOf(match, stream, set, facts),
    scoreEvents: standing(stream.envelopes, 'tennis.point', 'tennis.set_summary').length,
    ending,
    endingPending: phase === 'live' && defaultStands(stream.envelopes),
    lastTap: lastTapOf(stream.envelopes, recorded, undoneTap),
    undoable,
  };
}

/** Each side's game call: 0, 15, 30, 40, AD in a standard game; a breaker's points as numbers. */
function callsOf(state: Readonly<NestedState>): TennisDisplay['call'] {
  const { points } = state;
  if (points.kind !== 'standard')
    return { first: String(points.home), second: String(points.away) };
  const call = (side: 'home' | 'away'): string =>
    points.advantage === side ? 'AD' : (R.pointCalls[points[side]] ?? '');
  return { first: call('home'), second: call('away') };
}

/** 40-40 in an ad game is deuce; in a no-ad game (the cfg's `game.noAd`) the next point decides it. */
function noteOf(state: Readonly<NestedState>, cfg: TennisCfg): TennisDisplay['note'] {
  const { points } = state;
  if (points.kind !== 'standard' || points.advantage !== null) return null;
  if (points.home !== DEUCE_POINTS || points.away !== DEUCE_POINTS) return null;
  return cfg.game.noAd ? 'decidingPoint' : 'deuce';
}

const DEUCE_POINTS = 3;

/**
 * The engine's serving side, or none when it says it cannot name the order (F1: after a set score with an odd number of
 * games the kernel keeps `serving` where it was and `serveOrderKnown` is false), never a guess of ours.
 */
function servingOf(state: Readonly<NestedState>): PadSide | null {
  const serve = serveContext(state);
  return serve.serveOrderKnown ? sideOf(serve.side) : null;
}

function setLineOf(closed: NestedState['sets'][number]): TennisSetLine {
  const { home, away, tb, mtb } = closed;
  const tiebreak = tb === undefined ? null : pairOf(tb);
  const text =
    mtb === true
      ? `[${scoreText(pairOf(closed))}]`
      : tb === undefined
        ? scoreText(pairOf(closed))
        : `${scoreText(pairOf(closed))}(${Math.min(tb.home, tb.away)})`;
  return {
    ...pairOf(closed),
    winner: home > away ? 'first' : 'second',
    tiebreak,
    matchTiebreak: mtb === true,
    text,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// How the match stands: decided, ended by the organiser, or waiting for it
// ---------------------------------------------------------------------------------------------------------------

/**
 * How the organiser ended the match, read from the engine's outcome: the side at fault is the award's loser. Every award
 * has an ending (`endingKindOf` falls back to a walkover for a reason it does not list): a match the engine took from
 * the court never reads as decided with no word for how.
 */
export function endingOf(state: Readonly<NestedState>, names: SetBasedNames): TennisEnding | null {
  if (state.phase === 'abandoned') return { kind: 'abandoned', side: null };
  const { outcome } = state;
  if (outcome === null) return null;
  if (outcome.kind === 'double_walkover') return { kind: 'walkover', side: null };
  if (outcome.kind !== 'award') return null;
  const kind = endingKindOf(outcome.reason);
  return { kind, side: outcome.loser === null ? null : sideOfEntrant(names, outcome.loser) };
}

function phaseOf(state: Readonly<NestedState>, ending: TennisEnding | null): TennisPhase {
  if (state.phase === 'pre') return 'notStarted';
  if (state.phase === 'live') return 'live';
  return ending === null ? 'decided' : 'ended';
}

/**
 * A `default` the organiser recorded on the web stands and no forfeit has followed (G1): the engine refuses every tap until
 * it does (ENDING_SANCTION_PENDING, TN-SE-1). An undone one does not stand.
 */
const defaultStands = (envelopes: readonly EventEnvelope[]): boolean =>
  standing(envelopes, 'tennis.sanction').some(
    (envelope) => isRecord(envelope.payload) && envelope.payload.level === 'default',
  );

// ---------------------------------------------------------------------------------------------------------------
// Violations, per set
// ---------------------------------------------------------------------------------------------------------------

/** The engine's order of its levels (`tennisPadRules.sanctionLevels`), lightest first: never a list of our own. */
const LEVEL_ORDER: readonly TennisSeenLevel[] = R.sanctionLevels.filter(isSeenLevel);

/**
 * The heaviest violation each side holds in the set under way: the engine's record has no set, so the walk is over the
 * standing violations of the stream, each in the set the fold put it in (an undone one has no facts).
 */
function heaviestOf(
  match: Match,
  stream: SetBasedStream,
  set: number,
  facts: ReadonlyMap<string, TennisFacts>,
): TennisDisplay['heaviest'] {
  const held = standing(stream.envelopes, 'tennis.sanction').flatMap((envelope) =>
    isRecord(envelope.payload) && facts.get(envelope.id)?.set === set
      ? [
          {
            side: sideOfEntrant(match.names, envelope.payload.by),
            level: String(envelope.payload.level),
          },
        ]
      : [],
  );
  const of = (side: PadSide) =>
    heaviestLevel(
      LEVEL_ORDER,
      held.filter((one) => one.side === side).map((one) => one.level),
    );
  return { first: of('first'), second: of('second') };
}
