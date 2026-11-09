import { EngineError, foldMatch, type EventEnvelope } from '@seazn/engine/core';
import {
  chaseTarget,
  cricket,
  CricketBall,
  deriveCricketScorecard,
  type CricketBallEv,
  type CricketScorecard,
  type CricketState,
  type InningsState,
} from '@seazn/engine/sports/cricket';
import {
  BALL,
  CRICKET_FACTS,
  doneOf,
  SUPER_OVER_BALL,
  undoneTap,
} from '@/domain/scoring/cricketDone';
import {
  cricketLedgerHistory,
  historyDoneOf,
  type CricketGroup,
  type CricketHistoryEntry,
} from '@/domain/scoring/cricketHistory';
import { wordsOf } from '@/domain/scoring/cricketPad';
import {
  cricketMatchOf,
  cricketRefusalOf,
  playersEntered,
  type CricketEngineMatch,
} from '@/domain/scoring/cricketEngine';
import { picksAt, type CreasePair, type CricketPicksNow } from '@/domain/scoring/cricketPicks';
import {
  engineSideOf,
  isDecided,
  ordinalOf,
  overOf,
  padSideOf,
  turnOf,
  type CricketTurn,
} from '@/domain/scoring/cricketTurn';
import type {
  BatterLine,
  CricketBowler,
  CricketDisplay,
  CricketExtra,
  CricketInnings,
  CricketPadKey,
  CricketPlayer,
  CricketResult,
  CricketSeenTap,
  CricketStage,
  CricketTypes,
  OverChip,
} from '@/domain/scoring/cricketTypes';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadHistoryGroup, PadSide } from '@/domain/scoring/padView';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import type { SportFold, SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import { lastTapOf } from '@/domain/scoring/setBasedBoard';
import { streamOf, voidedIn, voidsAgain, type SetBasedStream } from '@/domain/scoring/setBasedFold';
import type { Recorded } from '@/domain/scoring/setBasedLedgerHistory';
import { seatsOf, type Seats } from '@/domain/scoring/setBasedSides';
import { undoTarget } from '@/domain/scoring/undoTarget';
import { matchContextOf, type Bootstrap } from '@/domain/scoring/wire';

/**
 * A cricket match on the pad (S2-4 spec §4 to §6, plan Task 5): the server's ledger with this phone's queued taps on top,
 * folded through the engine's cricket module, as the pad draws it, with the scorer's pending picks read in (the crease and
 * the bowler before a ball carries them). The engine decides every fact: the innings, the crease, the strike, the free hit,
 * the target, the result, and the figures (`deriveCricketScorecard`); this only reads them off. What is generic of the
 * set-based fold is used, never copied: the stream the server would hold (`streamOf`), the void reading, the last tap.
 *
 * Each queued tap is judged as the server would judge its append on the ledger and the legal taps before it. An illegal
 * tap is skipped, never shown, and the ones behind it are judged without it (`legalQueued`, which sync's `revalidate`
 * takes): a ball another scorer has already recorded (its `over` and `ballInOver` are no longer next) is one.
 *
 * Cost: one strict fold of the whole stream per queued tap, one tolerant fold for the display and one for the scorecard.
 */

type CricketMatch = {
  readonly engine: CricketEngineMatch;
  readonly seats: Seats;
  readonly context: MatchContext;
  /** Every member's name as the organiser typed it, by person id. */
  readonly names: ReadonlyMap<string, string>;
};

/** A ball the fold took, with the innings it went into: the main innings' or the super over's, by its place. */
type BallSeen = {
  readonly superOver: boolean;
  readonly index: number;
  readonly ball: CricketBallEv;
};

/** What History says of an event the fold took: the innings it belongs to, and that innings' score after a ball or totals. */
type CricketFacts = { readonly group: CricketGroup; readonly score: string | null };

type CricketFolded = {
  readonly state: CricketState;
  readonly balls: readonly BallSeen[];
  readonly scorecard: CricketScorecard;
  /** By envelope id: every event still standing (a voided one is not folded, so has none). */
  readonly facts: ReadonlyMap<string, CricketFacts>;
};

export function foldCricket(input: SportFoldInput): SportFold<CricketTypes> {
  const match = matchOf(input.bootstrap);
  if (typeof match === 'string') return { kind: 'unfoldable', reason: match };
  const stream = streamOf(match.engine.fixtureId, input, (before, next) =>
    mayAppend(match.engine, before, next),
  );
  const folded = foldOf(match.engine, stream.envelopes);
  if (folded === null) return { kind: 'unfoldable', reason: 'ledger' };
  const display = displayOf(match, input, stream, folded);
  return {
    kind: 'folded',
    display,
    legalQueued: stream.legal,
    history: historyOf(match, stream, folded, display),
  };
}

export { undoneTap };

// ---------------------------------------------------------------------------------------------------------------
// The match, the stream, the fold
// ---------------------------------------------------------------------------------------------------------------

function matchOf(bootstrap: Bootstrap): CricketMatch | Unfoldable {
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return 'sides';
  const engine = cricketMatchOf(bootstrap);
  if (engine === null) return 'cfg';
  const members = [...seats.first.members, ...seats.second.members];
  const names = new Map(members.map((one) => [one.personId, one.fullName]));
  return { engine, seats, context, names };
}

/** Whether the server would append `next` after `before`: the web's refusal of an undo twice, then the engine's. */
const mayAppend = (
  engine: CricketEngineMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean => !voidsAgain(before, next) && cricketRefusalOf(engine, [...before, next]) === null;

/** The read path's tolerant fold, the balls it took and the scorecard; null for a stream the engine will not replay. */
function foldOf(
  engine: CricketEngineMatch,
  envelopes: readonly EventEnvelope[],
): CricketFolded | null {
  const balls: BallSeen[] = [];
  const facts = new Map<string, CricketFacts>();
  // The innings now before each event: the one the last event left (none before the first).
  let before: CricketTurn | null = null;
  try {
    const state = foldMatch(cricket, engine.cfg, engine.lineups, envelopes, {
      onFolded: (after, event) => {
        seeBall(balls, after, event);
        facts.set(event.id, factsOf(before, after, event));
        before = turnOf(after);
      },
    });
    const scorecard = deriveCricketScorecard({ events: envelopes, ...engine });
    return { state, balls, scorecard, facts };
  } catch (error) {
    if (EngineError.is(error)) return null;
    throw error;
  }
}

/** A ball, filed under the innings the state just after it holds it in (the last of its list, by the event's type). */
function seeBall(balls: BallSeen[], state: Readonly<CricketState>, event: EventEnvelope): void {
  const superOver = event.type === SUPER_OVER_BALL;
  if (!superOver && event.type !== BALL) return;
  const ball = CricketBall.safeParse(event.payload);
  if (!ball.success) return;
  const list = superOver ? (state.superOver?.innings ?? []) : state.innings;
  balls.push({ superOver, index: list.length - 1, ball: ball.data });
}

/**
 * Where History files an event: a ball, or over totals, under the innings it went into, with that innings' score after it;
 * any other event under the innings under way when it came (a declaration, a retirement), else the one it leads to (the
 * toss and the start under the first innings, a follow-on under the third), or before play when none is named yet.
 */
function factsOf(
  before: CricketTurn | null,
  after: Readonly<CricketState>,
  event: EventEnvelope,
): CricketFacts {
  const scored = scoredIn(after, event.type);
  if (scored !== null) {
    return { group: groupOf(scored), score: `${scored.innings.runs}/${scored.innings.wickets}` };
  }
  const underWay = before?.innings?.closed === false ? before : null;
  const turn = underWay ?? turnOf(after);
  return { group: turn === null ? null : groupOf(turn), score: null };
}

/** The innings a ball or over totals went into: the last of its list, the super over's for a super-over ball. */
function scoredIn(
  state: Readonly<CricketState>,
  type: string,
): (CricketTurn & { readonly innings: InningsState }) | null {
  const superOver = type === SUPER_OVER_BALL;
  if (!superOver && type !== BALL && type !== SUMMARY) return null;
  const list = superOver ? (state.superOver?.innings ?? []) : state.innings;
  const innings = list[list.length - 1];
  if (innings === undefined) return null;
  return { superOver, index: list.length - 1, innings, battingSide: innings.battingSide };
}

const SUMMARY = 'cricket.innings.summary';

const groupOf = (turn: CricketTurn): CricketGroup => ({
  ordinal: ordinalOf(turn),
  batting: padSideOf(turn.battingSide),
});

/**
 * History's rows: every event of the stream with words, in order, this phone's queued taps on top as sending, an event a
 * void took back struck in its place under the innings it was recorded in (the one before it, since the fold no longer
 * holds it).
 */
function historyOf(
  match: CricketMatch,
  stream: SetBasedStream,
  folded: CricketFolded,
  display: CricketDisplay,
): readonly PadHistoryGroup<CricketPadKey>[] {
  const voided = voidedIn(stream.envelopes);
  let group: CricketGroup = null;
  const entries = stream.entries.flatMap((entry): CricketHistoryEntry[] => {
    const { envelope } = entry;
    const facts = folded.facts.get(envelope.id);
    group = facts === undefined ? group : facts.group;
    const did = historyDoneOf(envelope, match.seats);
    if (did === null) return [];
    const { own, sending } = entry;
    const undone = voided.has(envelope.id);
    return [{ did, group, score: facts?.score ?? null, own, undone, sending }];
  });
  return cricketLedgerHistory(entries, wordsOf(display));
}

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

function displayOf(
  match: CricketMatch,
  input: SportFoldInput,
  stream: SetBasedStream,
  folded: CricketFolded,
): CricketDisplay {
  const { state, scorecard } = folded;
  const turn = turnOf(state);
  const deliveries = deliveriesOf(folded, turn);
  const picks = picksAt(input.picks ?? NO_PICKS, state, deliveries);
  const entered = playersEntered(match.engine.lineups);
  const at = creaseAndBowler(match, folded, turn, picks);
  const needs = needsOf(turn, picks, at.bowlerId, entered.first && entered.second);
  return {
    sides: sidesOf(match.seats),
    context: match.context,
    stage: stageOf(state, turn, entered.first && entered.second, { needs, begun: picks.begun }),
    toss: tossOf(scorecard, match.seats),
    innings: turn === null ? null : inningsOf(state, turn),
    crease: at.crease,
    bowler: at.bowler,
    state,
    over: overNow(folded, turn),
    deliveries,
    freeHit: turn?.innings?.fine?.freeHitPending === true,
    needs,
    battingOrder: turn === null ? [] : picks.order[padSideOf(turn.battingSide)],
    players: { first: playersOf(match, state, 'first'), second: playersOf(match, state, 'second') },
    entered,
    result: resultOf(state, match.seats),
    scorecard,
    cfg: match.engine.cfg,
    lastTap: lastTapOf(stream.envelopes, recordedOf(match.seats, stream.envelopes), undoneTap),
    undoable: undoableOf(input, stream),
  };
}

const sidesOf = (seats: Seats): CricketDisplay['sides'] => ({
  first: { name: seats.first.name, entrantId: seats.first.entrantId },
  second: { name: seats.second.name, entrantId: seats.second.entrantId },
});

function sideOfEntrant(seats: Seats, entrantId: string | null | undefined): PadSide | null {
  if (entrantId === seats.first.entrantId) return 'first';
  return entrantId === seats.second.entrantId ? 'second' : null;
}

function tossOf(scorecard: CricketScorecard, seats: Seats): CricketDisplay['toss'] {
  const wonBy = sideOfEntrant(seats, scorecard.toss?.wonBy);
  return scorecard.toss === null || wonBy === null
    ? null
    : { wonBy, elected: scorecard.toss.elected };
}

/** What a later innings, or a super over's, waits on before its first ball: its picks, and Start innings (§4.5). */
type Due = { readonly needs: CricketDisplay['needs']; readonly begun: boolean };

/**
 * Where the match stands for the pad's screens (`CricketStage`). A super over nobody can bat in is the organiser's
 * (ruling 74); an innings scored in over totals stays so until the next innings (§4.10); a later innings, or a super
 * over's, waits on its setup while its openers or its bowler are not picked, or Start innings is not tapped.
 */
function stageOf(
  state: CricketState,
  turn: CricketTurn | null,
  entered: boolean,
  due: Due,
): CricketStage {
  if (!state.tossTaken) return 'toss';
  if (state.phase === 'pre') return 'setup';
  if (isDecided(state)) return 'decided';
  if (state.phase === 'super_over')
    return entered ? dueStage(turn, due, 'superOverSetup') : 'tiedNoPlayers';
  if (turn?.innings?.fine === null || !entered) return 'totals';
  return turn !== null && turn.index > 0 ? dueStage(turn, due, 'break') : 'live';
}

/** The setup's stage while the innings due is not yet opened and waits on a pick or on Start innings; else live. */
const dueStage = (turn: CricketTurn | null, due: Due, waiting: CricketStage): CricketStage =>
  turn?.innings === null && (due.needs !== null || !due.begun) ? waiting : 'live';

/**
 * What the next ball cannot go without (only while both sides' players are entered, in an innings scored ball by ball):
 * the openers of an innings not yet opened, then the bowler of an over due (the fold names none between overs).
 */
function needsOf(
  turn: CricketTurn | null,
  picks: CricketPicksNow,
  bowlerId: string | null,
  entered: boolean,
): CricketDisplay['needs'] {
  const innings = turn?.innings;
  if (turn === null || !entered || innings?.closed === true || innings?.fine === null) return null;
  if (innings === null && picks.openers === null) return 'openers';
  return bowlerId === null ? 'bowler' : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The innings
// ---------------------------------------------------------------------------------------------------------------

/**
 * The run a super over's second innings wins with: one more than the first's total. A Laws value (the super over's own
 * target), not the engine's export: the engine decides it privately when the innings closes (`cricket.ts:2067-2070`).
 */
const SUPER_OVER_WINNING_RUN = 1;

function inningsOf(state: CricketState, turn: CricketTurn): CricketInnings {
  const { innings } = turn;
  const runs = innings?.runs ?? 0;
  const legalBalls = innings?.legalBalls ?? 0;
  const ballsLimit =
    innings === null ? (turn.superOver ? state.cfg.ballsPerOver : state.quota) : innings.ballsLimit;
  const target = innings?.closed === true ? null : targetOf(state, turn);
  return {
    ordinal: ordinalOf(turn),
    superOver: turn.superOver,
    batting: padSideOf(turn.battingSide),
    runs,
    wickets: innings?.wickets ?? 0,
    legalBalls,
    ballsLimit,
    chase:
      target === null
        ? null
        : {
            need: target - runs,
            balls: ballsLimit === null ? null : ballsLimit - legalBalls,
            target,
          },
  };
}

/**
 * The target of the innings now, if it chases: the match's last innings (the engine's `chaseTarget`), or a super over's
 * second (one more than its first).
 */
function targetOf(state: CricketState, turn: CricketTurn): number | null {
  if (!turn.superOver) {
    return turn.index === state.cfg.inningsPerSide * 2 - 1 ? chaseTarget(state) : null;
  }
  const first = turn.index % 2 === 1 ? state.superOver?.innings[turn.index - 1] : undefined;
  return first === undefined ? null : first.runs + SUPER_OVER_WINNING_RUN;
}

// ---------------------------------------------------------------------------------------------------------------
// The crease, the bowler, the over
// ---------------------------------------------------------------------------------------------------------------

type CreaseAndBowler = {
  readonly crease: CricketDisplay['crease'];
  readonly bowler: CricketBowler | null;
  readonly bowlerId: string | null;
};

function creaseAndBowler(
  match: CricketMatch,
  folded: CricketFolded,
  turn: CricketTurn | null,
  picks: CricketPicksNow,
): CreaseAndBowler {
  const pair = turn === null ? null : creasePairOf(turn, picks);
  const bowlerId = turn === null ? null : bowlerIdOf(turn, picks);
  const line = (id: string) => batterLine(match, turn, id);
  return {
    crease:
      pair === null ? null : { striker: line(pair.striker), nonStriker: line(pair.nonStriker) },
    bowler: bowlerId === null || turn === null ? null : bowlerOf(match, folded, turn, bowlerId),
    bowlerId,
  };
}

/**
 * Who bats the next ball: the openers' pick before an innings opens; the fold's pair in one under way, reversed when a
 * hand swap stands for this ball; in a super over, the replacement's pick at the end a wicket left empty (§4.6).
 */
function creasePairOf(turn: CricketTurn, picks: CricketPicksNow): CreasePair | null {
  const { innings } = turn;
  if (innings === null) return picks.openers;
  const { fine } = innings;
  if (fine === null || innings.closed) return null;
  const striker = fine.striker ?? (turn.superOver ? picks.incoming : null);
  const nonStriker = fine.nonStriker ?? (turn.superOver ? picks.incoming : null);
  if (striker === null || nonStriker === null) return null;
  return picks.swap ?? { striker, nonStriker };
}

/** Who bowls the next ball: the fold's bowler of the over under way, else the over's pick. */
const bowlerIdOf = (turn: CricketTurn, picks: CricketPicksNow): string | null =>
  turn.innings?.fine?.currentBowler ?? picks.bowler;

const nameOf = (match: CricketMatch, id: string): string => match.names.get(id) ?? id;

function batterLine(match: CricketMatch, turn: CricketTurn | null, id: string): BatterLine {
  const fine = turn?.innings?.fine;
  return {
    id,
    name: nameOf(match, id),
    runs: fine?.batterRuns[id] ?? 0,
    balls: fine?.batterBalls[id] ?? 0,
  };
}

/** The bowler with O-M-R-W off the scorecard's line for this innings; a bowler with no line yet has bowled nothing. */
function bowlerOf(
  match: CricketMatch,
  { state, scorecard }: CricketFolded,
  turn: CricketTurn,
  id: string,
): CricketBowler {
  return { id, name: nameOf(match, id), figures: figuresIn(scorecard, state, turn, id) };
}

/** The turn's innings on the scorecard (the super over's after the main innings), or none before it opens. */
export const cardIn = (scorecard: CricketScorecard, state: CricketState, turn: CricketTurn) =>
  scorecard.innings[turn.superOver ? state.innings.length + turn.index : turn.index];

/** A bowler's O-M-R-W in the turn's innings, off the scorecard; 0-0-0-0 for one who has not bowled in it. */
export function figuresIn(
  scorecard: CricketScorecard,
  state: CricketState,
  turn: CricketTurn,
  id: string,
): string {
  const line = cardIn(scorecard, state, turn)?.bowling.find((one) => one.person === id);
  return line === undefined
    ? NO_FIGURES
    : `${line.overs}-${line.maidens ?? 0}-${line.runs}-${line.wickets}`;
}

const NO_FIGURES = '0-0-0-0';

/** The deliveries bowled in the innings now, legal and illegal: the balls the fold filed under it. */
const deliveriesOf = (folded: CricketFolded, turn: CricketTurn | null): number =>
  turn === null
    ? 0
    : folded.balls.filter((one) => one.superOver === turn.superOver && one.index === turn.index)
        .length;

/** The over the next ball is in (counted from 1) and the deliveries already bowled in it. */
function overNow(folded: CricketFolded, turn: CricketTurn | null): CricketDisplay['over'] {
  if (turn === null) return { number: 1, chips: [] };
  const over = overOf(turn, folded.state.cfg.ballsPerOver);
  const chips = folded.balls
    .filter((one) => one.superOver === turn.superOver && one.index === turn.index)
    .filter((one) => one.ball.over === over)
    .map((one) => chipOf(one.ball));
  return { number: over + 1, chips };
}

/** The scorebook's short forms of the extras: a wide, a no-ball, a bye, a leg-bye, a penalty. */
const EXTRA_TEXT: Readonly<Record<CricketExtra['kind'], string>> = {
  wide: 'wd',
  noball: 'nb',
  bye: 'b',
  legbye: 'lb',
  penalty: 'p',
};

/**
 * A delivery on the strip: `W` for a wicket whatever else came off it; `·` for a dot; the runs off the bat (a boundary
 * apart); an extra by its short form, with the runs that came off the ball before it when they are more than one ("3wd").
 */
function chipOf(ball: CricketBallEv): OverChip {
  if (ball.wicket !== undefined) return { text: 'W', tone: 'wicket' };
  const extra = ball.runs.extras;
  const { bat } = ball.runs;
  if (extra === undefined) {
    if (bat === 0) return { text: '·', tone: 'dot' };
    return { text: `${bat}`, tone: ball.boundary === undefined ? 'run' : 'boundary' };
  }
  const runs = extra.runs + bat;
  const short = EXTRA_TEXT[extra.kind];
  return { text: runs === 1 ? short : `${runs}${short}`, tone: 'extra' };
}

// ---------------------------------------------------------------------------------------------------------------
// The players, the result, the last tap
// ---------------------------------------------------------------------------------------------------------------

/** The team sheet's keeper: its `wicketkeeper` role, else its `WK` position (the engine's catalog, `cricket.positions`). */
export const KEEPER_ROLE = 'wicketkeeper';
export const KEEPER_POSITION = 'WK';

function playersOf(match: CricketMatch, state: CricketState, side: PadSide): CricketPlayer[] {
  const engineSide = engineSideOf(side);
  const slots = match.engine.lineups[engineSide].slots;
  return state.orders[engineSide].map((id) => {
    const slot = slots.find((one) => one.personId === id);
    const keeper =
      slot?.roles?.includes(KEEPER_ROLE) === true || slot?.positionKey === KEEPER_POSITION;
    return { id, name: nameOf(match, id), keeper };
  });
}

/** The engine's result: its margin when won on the field, else the outcome's own kind; the winner by the seat. */
function resultOf(state: CricketState, seats: Seats): CricketResult | null {
  const { outcome } = state;
  if (outcome === null) return null;
  const winner = 'winner' in outcome ? sideOfEntrant(seats, outcome.winner) : null;
  const margin =
    outcome.kind === 'win' && state.margin !== null ? state.margin : { kind: outcome.kind };
  return { margin, winner };
}

/** What each event the pad has words for did, by envelope id: the standing ones and the ones a void took back alike. */
function recordedOf(
  seats: Seats,
  envelopes: readonly EventEnvelope[],
): ReadonlyMap<string, Recorded<CricketSeenTap>> {
  const recorded = new Map<string, Recorded<CricketSeenTap>>();
  for (const envelope of envelopes) {
    const did = doneOf(envelope, seats);
    if (did !== null) recorded.set(envelope.id, { did, facts: CRICKET_FACTS });
  }
  return recorded;
}

/** This phone's Undo has a standing tap of its own: its latest, the legal queued taps included. */
function undoableOf(input: SportFoldInput, stream: SetBasedStream): boolean {
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  return undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true).kind !== 'blocked';
}
