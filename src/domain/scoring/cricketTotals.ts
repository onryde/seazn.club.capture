import { cricketTrial } from '@/domain/scoring/cricketEngine';
import { summaryEvent } from '@/domain/scoring/cricketEvents';
import type { CricketDisplay, CricketPadKey, CricketTap } from '@/domain/scoring/cricketTypes';
import type { PadText } from '@/domain/scoring/padView';

/**
 * Players not entered: over totals (S2-4 spec §4.10, rulings 66 and 74; plan Task 17). A side with fewer than two
 * starting players is scored over by over: runs and wickets, and the over's legal balls, sent as
 * `cricket.innings.summary` with the innings' running totals and `partial: true` (`summaryEvent`). The engine needs no
 * ids for it. Once an innings has a summary it takes no balls, so players entered mid-innings return the ball pad from
 * the next innings (the fold's `totals` stage). Which overs the engine takes is the engine's: a candidate summary is
 * tried against the fold's state (`cricketTrial`), as the wicket steps try a ball, so the entry offers exactly what the
 * server will take.
 */

/** One over as the scorer enters it: its own runs and wickets, and the legal balls it took. */
export type TotalsOver = {
  readonly runs: number;
  readonly wickets: number;
  readonly balls: number;
};

export type TotalsField = keyof TotalsOver;

type Note = PadText<CricketPadKey>;

/** The over to enter, in the keys' place while a side's players are not entered. */
export type CricketTotalsEntry = {
  readonly kind: 'entry';
  /** The line above the entry: players not entered, or an innings that stays in totals. */
  readonly note: Note;
  /** The over now, counted from 1. */
  readonly over: number;
  /**
   * What makes this entry a new one: the innings and its legal balls so far. The screen starts its figures again when
   * it changes, so a part over, a recorded over and the next innings each open fresh, and a re-render keeps them. The
   * over number is not enough: a part over leaves it where it was, and an innings that ends in its first over leaves
   * the next innings' first over with the same one.
   */
  readonly entryKey: string;
  /** What the entry starts at: nothing scored and the rest of the over, or what the innings has left if less. */
  readonly start: TotalsOver;
  /** The most legal balls an over has: the format's balls to an over. */
  readonly ballsMax: number;
  /** Whether the engine takes this over now (a stepper stops where it would not). */
  readonly fits: (over: TotalsOver) => boolean;
};

/** A tie that goes to a super over nobody can bat in (ruling 74): the organiser decides. Nothing to enter. */
export type CricketTotalsTied = { readonly kind: 'tied'; readonly note: Note };

export type CricketTotals = CricketTotalsEntry | CricketTotalsTied;

const NO_PLAYERS: Note = { key: 'scoring.cricket.totals.noPlayers' };
const STAYS: Note = { key: 'scoring.cricket.totals.stays' };
const TIED: Note = { key: 'scoring.cricket.totals.tied' };

/**
 * What the pad shows in place of the keys while the match is scored in over totals: the entry for the next over, or the
 * organiser's line for a tie. Null at any other stage: the toss and setup, a live match with its players entered, a
 * break, a decided match.
 */
export function totalsView(display: CricketDisplay): CricketTotals | null {
  if (display.stage === 'tiedNoPlayers') return { kind: 'tied', note: TIED };
  const note = entryNote(display);
  const { innings } = display;
  if (note === undefined || innings === null) return null;
  const { ballsPerOver } = display.cfg;
  return {
    kind: 'entry',
    note,
    over: Math.floor(innings.legalBalls / ballsPerOver) + 1,
    entryKey: `${innings.ordinal}.${innings.legalBalls}`,
    start: { runs: 0, wickets: 0, balls: ballsLeft(display) },
    ballsMax: ballsPerOver,
    fits: (over) => totalsTap(display, over) !== null,
  };
}

/** The line above an entry at this stage; undefined where there is no entry. */
function entryNote(display: CricketDisplay): Note | undefined {
  if (display.stage !== 'totals') return undefined;
  return display.entered.first && display.entered.second ? STAYS : NO_PLAYERS;
}

/**
 * What is left of the over under way (a whole one at its start, three after a part over of three), or what the innings
 * has left when that is less (a format that is not a whole number of overs).
 */
function ballsLeft(display: CricketDisplay): number {
  const { innings } = display;
  const { ballsPerOver } = display.cfg;
  if (innings === null) return ballsPerOver;
  const inOver = ballsPerOver - (innings.legalBalls % ballsPerOver);
  if (innings.ballsLimit === null) return inOver;
  return Math.max(1, Math.min(inOver, innings.ballsLimit - innings.legalBalls));
}

/**
 * The summary an over makes: the innings' running totals with the over added. None for an over that is not a whole
 * number of runs and wickets, one with no balls or more than an over has, or one the engine would refuse now (more
 * wickets than the side has, more balls than the innings has left, a chase total past its winning run).
 */
export function totalsTap(display: CricketDisplay, over: TotalsOver): CricketTap | null {
  const { innings } = display;
  if (innings === null || !isOver(over, display.cfg.ballsPerOver)) return null;
  const tap: CricketTap = {
    kind: 'summary',
    runs: innings.runs + over.runs,
    wickets: innings.wickets + over.wickets,
    legalBalls: innings.legalBalls + over.balls,
  };
  return cricketTrial(display.state, summaryEvent(tap)) === null ? null : tap;
}

/**
 * Between one ball and a whole over of them. Runs and wickets are not checked here: the engine refuses a fraction, a
 * number that is not one, and any over that takes the running total down (the trial in `totalsTap`), so a second check
 * would cover for it and nothing could tell them apart.
 */
function isOver({ balls }: TotalsOver, ballsPerOver: number): boolean {
  return balls >= 1 && balls <= ballsPerOver;
}

/** The fewest each field holds: an over may be a maiden, but it has at least a ball. */
const FLOOR: Readonly<Record<TotalsField, number>> = { runs: 0, wickets: 0, balls: 1 };

/**
 * A field moved one up or down, no lower than its floor and the balls no higher than an over has. What the engine takes
 * above that is `fits`'s to say.
 */
export function stepOver(
  over: TotalsOver,
  field: TotalsField,
  by: 1 | -1,
  ballsMax: number,
): TotalsOver {
  const ceiling = field === 'balls' ? ballsMax : Number.POSITIVE_INFINITY;
  const next = Math.min(ceiling, Math.max(FLOOR[field], over[field] + by));
  return next === over[field] ? over : { ...over, [field]: next };
}
