import {
  activeInnings,
  nextBattingSide,
  soBattingSideAt,
  type CricketState,
  type InningsState,
} from '@seazn/engine/sports/cricket';
import type { CricketOrdinal } from '@/domain/scoring/cricketTypes';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * The innings now, read off the engine's fold (S2-4 plan Task 5): the one under way, else the one due (which the engine
 * opens only on its first ball), else the last one played. Who bats a due innings is the engine's (`nextBattingSide`,
 * `soBattingSideAt`); this names its place (`CricketOrdinal`), which the pending picks are keyed by.
 */

export type EngineSide = InningsState['battingSide'];

export type CricketTurn = {
  readonly superOver: boolean;
  /** Its place in its list: the main innings', or the super over's. */
  readonly index: number;
  /** The engine's innings, or null for one due and not yet opened. */
  readonly innings: InningsState | null;
  readonly battingSide: EngineSide;
};

const DECIDED: ReadonlySet<CricketState['phase']> = new Set(['done', 'final']);

/** The engine has a result (the organiser may have finalized it): no innings is due. */
export const isDecided = (state: CricketState): boolean => DECIDED.has(state.phase);

/** The innings now; null before the toss, when no innings is anybody's yet. */
export function turnOf(state: CricketState): CricketTurn | null {
  if (!state.tossTaken) return null;
  const { list, inSuperOver } = activeInnings(state);
  const last = list[list.length - 1];
  if (last !== undefined && !last.closed) return turn(inSuperOver, list.length - 1, last);
  const due = isDecided(state) ? null : dueSide(state, inSuperOver, list.length);
  if (due !== null) {
    return { superOver: inSuperOver, index: list.length, innings: null, battingSide: due };
  }
  return last === undefined ? null : turn(inSuperOver, list.length - 1, last);
}

const turn = (superOver: boolean, index: number, innings: InningsState): CricketTurn => ({
  superOver,
  index,
  innings,
  battingSide: innings.battingSide,
});

function dueSide(state: CricketState, superOver: boolean, count: number): EngineSide | null {
  return superOver
    ? soBattingSideAt(state, count)
    : nextBattingSide({ ...state, inningsCount: count });
}

/** `i1`…`i4` for the main innings, `s1`, `s2`, … for the super over's. */
export const ordinalOf = (turn: CricketTurn): CricketOrdinal =>
  turn.superOver ? `s${turn.index + 1}` : `i${turn.index + 1}`;

/** Above any main innings' rank (there are four at most). */
const SUPER_OVER_RANK = 100;

/**
 * An innings' place in the match from its ordinal: the main innings by number, every super-over innings after them; null
 * for a word that names no innings (an order's side).
 */
export function rankOfOrdinal(ordinal: string): number | null {
  const found = /^([is])(\d+)$/.exec(ordinal);
  if (found === null) return null;
  return (found[1] === 's' ? SUPER_OVER_RANK : 0) + Number(found[2]);
}

/** The legal balls bowled in the innings now: none in one not yet opened. */
export const legalBallsOf = (turn: CricketTurn): number => turn.innings?.legalBalls ?? 0;

/** The over the next ball is in, counted from 0 as a ball's `over` is. */
export const overOf = (turn: CricketTurn, ballsPerOver: number): number =>
  Math.floor(legalBallsOf(turn) / ballsPerOver);

/** The pad's side of an engine side: home is the first. */
export const padSideOf = (side: EngineSide): PadSide => (side === 'home' ? 'first' : 'second');

/** The engine's side of a pad side. */
export const engineSideOf = (side: PadSide): EngineSide => (side === 'first' ? 'home' : 'away');

/** The other side. */
export const otherSide = (side: EngineSide): EngineSide => (side === 'home' ? 'away' : 'home');
