import { activeInnings, type CricketState, type InningsState } from '@seazn/engine/sports/cricket';
import {
  doneSaid,
  headingOf,
  oversText,
  pickedSaid,
  undoneSaid,
  type CricketWords,
} from '@/domain/scoring/cricketHistory';
import { summaryOf, type SummaryBlock } from '@/domain/scoring/cricketSummary';
import { tapEndedInnings } from '@/domain/scoring/cricketPicks';
import { cricketResultWords } from '@/domain/scoring/cricketResult';
import { cricketRuleRows } from '@/domain/scoring/cricketRules';
import {
  numberOfOrdinal,
  padSideOf,
  superOverNumber,
  turnOf,
  type CricketTurn,
} from '@/domain/scoring/cricketTurn';
import type {
  BatterLine,
  CricketBowler,
  CricketDisplay,
  CricketInnings,
  CricketPadKey,
  CricketStage,
  OverChip,
} from '@/domain/scoring/cricketTypes';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadTally,
  type PadText,
  type PadView,
} from '@/domain/scoring/padView';
import { padMarks } from '@/domain/scoring/setBasedPad';

/**
 * Cricket on the pad (S2-4 spec §5; plan Task 7): the kit's view of a cricket match. Cricket is not scored by tapping a
 * side's half: its screen draws its own board in the halves' place (Task 8), so the halves only carry the sides' names and
 * their latest innings, with no tap. Every fact is the display's, which is the engine's fold: the pad only says it. The
 * toss and the setup are the screen's own steps, so there is no Start screen here (`start` null), and no tools yet: the
 * keys are the screen's.
 */

const SYNCED: PadSync = { kind: 'synced' };

/** The recorded result's card: its title is the engine's result in words once there is one (T19 fix 5, Part 2). */
function recordedCard(display: CricketDisplay): PadStateCard<CricketPadKey> {
  const { result } = display;
  if (result === null) return { kind: 'resultRecorded', undoLeft: null };
  return {
    kind: 'resultRecorded',
    undoLeft: null,
    title: cricketResultWords(result, display.sides),
  };
}

/** The match is decided: the engine has a result, which the organiser may have finalized. */
export const cricketDecided = (display: CricketDisplay): boolean => display.stage === 'decided';

/** The match has not started: the toss or the setup before Start. */
export const cricketNotStarted = (display: CricketDisplay): boolean =>
  display.stage === 'toss' || display.stage === 'setup';

/**
 * The innings as Home's Finished card writes them, in the order they were played: runs/wickets each, joined ("25/3 ·
 * 25/4"). Numbers only; the main innings, since a super over's are the result's words. Empty before an innings is played.
 */
export function cricketResultLine(display: CricketDisplay): string {
  return display.state.innings.map((one) => `${one.runs}/${one.wickets}`).join(' · ');
}

/** What the words need, from the display: the players' names, the sides' and the balls in an over. */
export function wordsOf(display: CricketDisplay): CricketWords {
  const players = [...display.players.first, ...display.players.second];
  return {
    names: new Map(players.map((one) => [one.id, one.name])),
    sides: display.sides,
    ballsPerOver: display.cfg.ballsPerOver,
  };
}

/**
 * The pad for a cricket match: the sides' halves, the rules for Match details, no strip, the last tap with the one Undo, and a recorded result's card. `sync` is the transport's word, not the match's.
 */
export function cricketPad(
  display: CricketDisplay,
  sync: PadSync = SYNCED,
): PadView<CricketPadKey> {
  const view: PadView<CricketPadKey> = {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: tallyOf(display),
    details: { context: display.context, rules: cricketRuleRows(display.cfg) },
    start: null,
    // No strip (T20 fix 12): the result is the card's title (T19 fix 5), and no other fact comes and goes above the board.
    strip: [],
    lastTap: lastTapOf(display),
    sync,
    tools: [],
    card: null,
  };
  return withCard(view, cricketDecided(display) ? recordedCard(display) : null);
}

/** A side's latest innings, runs/wickets ("25/3"), or nothing before it has batted. */
function scoreOf(display: CricketDisplay, side: PadSide): string {
  const batted = display.state.innings.filter((one) => sideOf(one.battingSide) === side);
  const last = batted[batted.length - 1];
  return last === undefined ? '' : `${last.runs}/${last.wickets}`;
}

const sideOf = (side: 'home' | 'away'): PadSide => (side === 'home' ? 'first' : 'second');

function half(display: CricketDisplay, side: PadSide): PadHalf<CricketPadKey> {
  return {
    side,
    label: display.sides[side].name,
    value: scoreOf(display, side),
    periods: null,
    sub: null,
    marks: padMarks(null, null),
    serving: null,
    plate: null,
    action: null,
    // The lime follows the side batting now.
    bar: display.innings?.batting === side ? 'lit' : 'dim',
    hint: { key: 'scoring.pad.tap' },
    tappable: false,
  };
}

/** The header says nothing (the board shows the score); a screen reader hears the innings now, or that there is none yet. */
function tallyOf(display: CricketDisplay): PadTally<CricketPadKey> {
  const { innings } = display;
  if (innings === null) {
    return { shown: '', said: { key: 'scoring.cricket.tallyNone' } };
  }
  return {
    shown: '',
    said: {
      key: 'scoring.cricket.tallySaid',
      vars: { score: `${innings.runs}/${innings.wickets}` },
    },
  };
}

/**
 * What the last tap did, or a pick made since it (`CricketPicked`), and the one Undo while this phone's own tap is the
 * last standing on the ledger. After an Undo the line names what was undone and Undo stays lit while another of this
 * phone's balls stands under it, so a second Undo takes that one back (T19 D8: every sport's pad chains; each tap takes
 * back the current last ball, never an older one). An Undo's line is never covered by a pick.
 *
 * At an innings break, a tie or a super over's setup, a tap that ended the innings (`tapEndedInnings`: a ball, over
 * totals, a retirement, a declaration, More's close) has no words until the next action, the break's card being the
 * news (T19 D13); its Undo stays, since it takes that tap back. An Undo's line, a tap made at the break (a stoppage, a
 * revision, the follow-on) and Start innings (`picked`, which is the live stage's) speak as ever.
 */
function lastTapOf(display: CricketDisplay): PadLastTap<CricketPadKey> | null {
  const did = display.lastTap;
  if (did === null) return null;
  const words = wordsOf(display);
  if (did.kind === 'undone') return { text: undoneSaid(did.tap, words), undo: display.undoable };
  if (BREAK_STAGES.has(display.stage) && tapEndedInnings(did)) {
    return { text: null, undo: display.undoable };
  }
  const text = display.picked === null ? doneSaid(did, words) : pickedSaid(display.picked, words);
  return { text, undo: display.undoable };
}

// ---------------------------------------------------------------------------------------------------------------
// The board (plan Task 8): what the screen draws in the halves' place
// ---------------------------------------------------------------------------------------------------------------

/** A batter at the crease as the board lists them, and whether they face the next ball (the board's lime dot). */
export type CreaseLine = BatterLine & { readonly striker: boolean };

/**
 * The score panel: the batting team's name, runs/wickets, the overs bowled ("1.5"), the innings ("Innings 2", "Super over
 * 2"; the team is the line above it) and the chase while one stands.
 */
export type BoardScore = {
  readonly team: string;
  readonly runs: number;
  readonly wickets: number;
  readonly overs: string;
  readonly innings: PadText<CricketPadKey>;
  readonly chase: PadText<CricketPadKey> | null;
};

/**
 * The cricket board (S2-4 spec §5 rows 2 to 4), read only: the score of the innings now, the crease (striker first,
 * marked), the bowler with O-M-R-W, this over's deliveries, and a free hit when one is due. No score before an innings
 * is due; no crease or bowler until they are picked. Once the match is decided the crease holds the batters left not
 * out, none marked, and a lone one when the side was all out (T19 D6). Every fact is the display's, which is the
 * engine's fold.
 */
export type CricketBoardView = {
  readonly score: BoardScore | null;
  /** At a result, both sides' scores of the deciding contest in place of the score (T19 fix 5, Part 2). */
  readonly result: BoardResult | null;
  readonly crease: readonly [CreaseLine, CreaseLine | null] | null;
  readonly bowler: CricketBowler | null;
  /** Null when there is no over to show: a decided match with no delivery, an innings break (T19 fix 9). */
  readonly over: { readonly number: number; readonly chips: readonly OverChip[] } | null;
  readonly status: PadText<CricketPadKey> | null;
  /** At a result, each main innings' top bat, best bowl and extras (T19 fix 10); null while the match is played. */
  readonly summary: readonly SummaryBlock[] | null;
};

/** A side's line at a result: its name, its runs/wickets (an innings each joined by " & " in a longer match), its overs. */
export type BoardResultRow = {
  readonly team: string;
  readonly figures: string;
  readonly overs: string | null;
};

/** The deciding contest's two sides, the side that batted first on top. */
export type BoardResult = readonly [BoardResultRow, BoardResultRow];

export function cricketBoard(display: CricketDisplay): CricketBoardView {
  const result = display.stage === 'decided' ? resultRows(display) : null;
  return {
    score: display.innings === null ? null : scoreOfInnings(display, display.innings),
    result,
    crease: creaseShown(display),
    bowler: display.bowler,
    over: overShown(display),
    status: display.freeHit ? { key: 'scoring.cricket.board.freeHit' } : null,
    summary: summaryOf(display, wordsOf(display).names),
  };
}

/** Stages with no over under way: a break, a super over due, and a tie waiting on the organiser (nobody can bat it). */
const BETWEEN_OVERS: ReadonlySet<CricketDisplay['stage']> = new Set([
  'break',
  'superOverSetup',
  'tiedNoPlayers',
]);

/**
 * The over the strip shows. A decided match shows the over that ended it (the next one will never be bowled); an innings
 * break, a super over due or a tie waiting on the organiser shows none, rather than an empty next over (T19 fix 9). Otherwise the over under way.
 */
function overShown(display: CricketDisplay): CricketBoardView['over'] {
  if (display.stage === 'decided') return display.lastOver;
  if (BETWEEN_OVERS.has(display.stage)) return null;
  return display.over;
}

/**
 * The batters the board shows at the crease, and the Players sheet lists as in (T19 P1: one source for both): who bats
 * the next ball while the match is played, who was left not out once it is decided.
 */
export function creaseShown(display: CricketDisplay): CricketBoardView['crease'] {
  return display.stage === 'decided' ? notOutAtResult(display) : creaseOf(display);
}

/** The pair that bats the next ball, the striker first and marked. */
function creaseOf({ crease }: CricketDisplay): CricketBoardView['crease'] {
  if (crease === null) return null;
  return [
    { ...crease.striker, striker: true },
    { ...crease.nonStriker, striker: false },
  ];
}

/**
 * The batters left at the crease when the match was decided (T19 D6; the fold's crease is who bats the NEXT ball, so it
 * is empty by then): the engine's card of the last innings names them not out, in the order they came in, and the
 * fold's pair is who was at the crease when it closed, which leaves out a batter who retired hurt and did not return.
 * None is marked: no ball is due. An all-out side leaves one, an innings in over totals none.
 */
function notOutAtResult(display: CricketDisplay): CricketBoardView['crease'] {
  const card = display.scorecard.innings.at(-1);
  const fine = turnOf(display.state)?.innings?.fine;
  if (card === undefined || fine === null || fine === undefined) return null;
  const names = wordsOf(display).names;
  const atCrease = [fine.striker, fine.nonStriker];
  const [first, second] = card.batting
    .filter(({ dismissal, person }) => dismissal.kind === 'not_out' && atCrease.includes(person))
    .map(({ person, runs, balls }): CreaseLine => ({
      id: person,
      name: names.get(person) ?? person,
      runs,
      balls,
      striker: false,
    }));
  return first === undefined ? null : [first, second ?? null];
}

function scoreOfInnings(display: CricketDisplay, innings: CricketInnings): BoardScore {
  return {
    team: display.sides[innings.batting].name,
    runs: innings.runs,
    wickets: innings.wickets,
    overs: oversText(innings.legalBalls, display.cfg.ballsPerOver),
    innings: {
      key: innings.superOver ? 'scoring.cricket.board.superOver' : 'scoring.cricket.board.innings',
      vars: { number: numberOfOrdinal(innings.ordinal) },
    },
    chase: display.stage === 'decided' ? null : chaseOf(innings),
  };
}

/**
 * The deciding contest's scores (T19 fix 5, Part 2): a match decided on a super over shows that super over's two halves
 * (the tied main totals are Match details'), any other the innings of the match. Each side's line, the side that batted
 * first on top; a side with more than one innings joins their runs/wickets and shows no overs. None when no innings
 * stands (a walkover, an award).
 */
function resultRows(display: CricketDisplay): BoardResult | null {
  const { superOver } = display.state;
  const list =
    superOver !== null && superOver.innings.length > 0 ? superOver.innings : display.state.innings;
  const last =
    superOver !== null && superOver.innings.length > 0 ? superOverNumber(list.length - 1) : null;
  const played = list.filter((_, index) => last === null || superOverNumber(index) === last);
  const sides = [...new Set(played.map((one) => one.battingSide))];
  const rows = sides.map((side): BoardResultRow => {
    const own = played.filter((one) => one.battingSide === side);
    const only = own.length === 1 ? own[0] : undefined;
    return {
      team: display.sides[padSideOf(side)].name,
      figures: own.map((one) => `${one.runs}/${one.wickets}`).join(' & '),
      overs: only === undefined ? null : oversText(only.legalBalls, display.cfg.ballsPerOver),
    };
  });
  const [first, second] = rows;
  return first === undefined || second === undefined ? null : [first, second];
}

/** "Need 9 off 12 balls", or "Need 9" in an innings with no ball limit; nothing when no chase stands. */
function chaseOf(innings: CricketInnings): PadText<CricketPadKey> | null {
  const { chase } = innings;
  if (chase === null) return null;
  const runs = chase.need;
  if (chase.balls === null) return { key: 'scoring.cricket.board.need', vars: { runs } };
  return { key: 'scoring.cricket.board.chase.other', count: chase.balls, vars: { runs } };
}

// ---------------------------------------------------------------------------------------------------------------
// The innings break (plan Task 16): the card over the next innings' setup
// ---------------------------------------------------------------------------------------------------------------

/** The break's card: its title, and the innings just closed with what the next one needs (or the lead). */
export type CricketBreakCard = {
  readonly title: PadText<CricketPadKey>;
  readonly line: PadText<CricketPadKey> | null;
};

/** The breaks: a later innings (or a super over's) is due and waits on its setup, which stands under the break's card. */
export const BREAK_STAGES: ReadonlySet<CricketStage> = new Set<CricketStage>([
  'break',
  'superOverSetup',
]);

/**
 * The innings break (S2-4 spec §4.5, §4.6), while the next innings waits on its openers, its bowler or Start innings: the
 * innings just closed ("Home CC 8/0 (2 ov)"), then what the next needs, its target and balls shown before its first ball
 * (the web shows them only after it), or, two innings a side, the lead. A tie's super over is "Tied — super over", a
 * tied super over's next "Tied again — super over 2", each with the tied pair's scores (T19 D12); the super over's
 * second innings "Super over", with its chase. Null when no break stands.
 */
export function cricketBreakCard(display: CricketDisplay): CricketBreakCard | null {
  const turn = turnOf(display.state);
  const { innings } = display;
  if (!BREAK_STAGES.has(display.stage) || turn === null || innings === null) return null;
  const closed = closedBefore(display.state, turn);
  if (closed === undefined) return null;
  const said = closedSaid(display, closed);
  const tied = tiedWith(display.state, turn);
  if (tied !== undefined) {
    const first = closedSaid(display, tied);
    return { title: breakTitle(turn), line: joined(first, said) };
  }
  const next = nextSaid(display, innings);
  return { title: breakTitle(turn), line: next === null ? said : joined(said, next) };
}

const joined = (
  closed: PadText<CricketPadKey>,
  next: PadText<CricketPadKey>,
): PadText<CricketPadKey> => ({ key: 'scoring.cricket.break.line', vars: { closed, next } });

/**
 * At a tie's card (a super over's first innings due), the innings the last one tied with: the main innings' first (the
 * engine takes a super over only in a match of one innings a side), else the tied super over's first. None at any other
 * break.
 */
function tiedWith(state: CricketState, turn: CricketTurn): InningsState | undefined {
  if (!turn.superOver || turn.index % 2 !== 0) return undefined;
  return turn.index > 0
    ? activeInnings(state).list[turn.index - 2]
    : state.innings[state.innings.length - 2];
}

/**
 * A main innings' break, a tie's super over (the first of a pair; after a tied super over, "Tied again" with the next's
 * number), or the super over's second innings.
 */
function breakTitle(turn: CricketTurn): PadText<CricketPadKey> {
  if (!turn.superOver) return { key: 'scoring.cricket.break.title' };
  if (turn.index % 2 !== 0) return { key: 'scoring.cricket.break.superOver' };
  if (turn.index === 0) return { key: 'scoring.cricket.break.tied' };
  return { key: 'scoring.cricket.break.tiedAgain', vars: { number: superOverNumber(turn.index) } };
}

/** The innings before the one due: the last of its list, or the match's last main innings before a first super over. */
function closedBefore(state: CricketState, turn: CricketTurn): InningsState | undefined {
  const { list } = activeInnings(state);
  return turn.index > 0 ? list[turn.index - 1] : state.innings[state.innings.length - 1];
}

function closedSaid(display: CricketDisplay, closed: InningsState): PadText<CricketPadKey> {
  return {
    key: 'scoring.cricket.break.closed',
    vars: {
      team: display.sides[padSideOf(closed.battingSide)].name,
      score: `${closed.runs}/${closed.wickets}`,
      overs: oversText(closed.legalBalls, display.cfg.ballsPerOver),
    },
  };
}

/** "Away CC need 9 off 12 balls", "Away CC need 42" with no ball limit, the lead two innings a side, else nothing. */
function nextSaid(display: CricketDisplay, innings: CricketInnings): PadText<CricketPadKey> | null {
  const { chase } = innings;
  if (chase === null) return leadOf(display);
  const vars = { team: display.sides[innings.batting].name, target: chase.target };
  if (chase.balls === null) return { key: 'scoring.cricket.break.need', vars };
  return { key: 'scoring.cricket.break.chase.other', count: chase.balls, vars };
}

/** Two innings a side: the side ahead on the main innings' runs and by how many, or level. Nothing in a match of one. */
function leadOf(display: CricketDisplay): PadText<CricketPadKey> | null {
  const { state } = display;
  if (state.cfg.inningsPerSide < 2) return null;
  const runsOf = (side: PadSide) =>
    state.innings
      .filter((one) => padSideOf(one.battingSide) === side)
      .reduce((sum, one) => sum + one.runs, 0);
  const lead = runsOf('first') - runsOf('second');
  if (lead === 0) return { key: 'scoring.cricket.break.level' };
  const ahead: PadSide = lead > 0 ? 'first' : 'second';
  return {
    key: 'scoring.cricket.break.lead.other',
    count: Math.abs(lead),
    vars: { team: display.sides[ahead].name },
  };
}
