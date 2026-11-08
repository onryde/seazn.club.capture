import type { EventEnvelope } from '@seazn/engine/core';
import type { SetBasedServeContext, SetBasedState, SetState } from '@seazn/engine/sports/setbased';
import type { PadSide } from '@/domain/scoring/padView';
import type { EventFacts, Recorded } from '@/domain/scoring/setBasedLedgerHistory';
import { scoreText } from '@/domain/scoring/setBasedSides';

/**
 * What the set-based sports (badminton, table tennis) read off a folded state to draw the board (plan S2-2 Task 3,
 * lifted from badminton's fold): the game under way and the games over, the phase, the server, this phone's pick and the
 * last tap. A generic file: it names no sport, and a sport's fold adds only what is the sport's.
 */

export const ZERO: Readonly<Record<PadSide, number>> = { first: 0, second: 0 };

/** Not started (the Start screen); started, before the first point; a game under way; a game won; the match over. */
export type SetBasedPhase = 'notStarted' | 'pre' | 'live' | 'betweenGames' | 'decided';

/** A game over: each side's points when it ended, and the side that won it on points. */
export type SetBasedGame = {
  readonly points: Readonly<Record<PadSide, number>>;
  readonly winner: PadSide;
};

export type SetBasedBoard = {
  readonly points: Readonly<Record<PadSide, number>>;
  readonly finished: readonly SetBasedGame[];
  readonly game: number;
};

export const pointsOf = (set: SetState): Readonly<Record<PadSide, number>> => ({
  first: set.home,
  second: set.away,
});

export const wonGame = (set: SetState): SetBasedGame => ({
  points: pointsOf(set),
  winner: set.home > set.away ? 'first' : 'second',
});

/** The games over, in order. */
export const wonGames = (state: SetBasedState): readonly SetBasedGame[] =>
  state.sets.filter((set) => set.closed).map(wonGame);

/**
 * The games over as one line, the top side's score first in each: Home's Finished card ("11–7, 11–9"). Numbers and
 * punctuation, never translated; a game that ended at its points (a disqualification's) is there at them.
 */
export const resultLineOf = (
  finished: readonly { readonly points: Readonly<Record<PadSide, number>> }[],
): string => finished.map((game) => scoreText(game.points)).join(', ');

/** The game under way, or undefined between games and before the first. */
export function openGameOf(state: SetBasedState): SetState | undefined {
  const last = state.sets[state.sets.length - 1];
  return last !== undefined && !last.closed ? last : undefined;
}

/** The game under way and the games over. Once decided, the last game's points stay up. */
export function boardOf(state: SetBasedState): SetBasedBoard {
  const closed = wonGames(state);
  const open = openGameOf(state);
  if (open !== undefined) {
    return { points: pointsOf(open), finished: closed, game: state.sets.length };
  }
  const lastWon = closed[closed.length - 1];
  if (state.phase !== 'live' && lastWon !== undefined) {
    return { points: lastWon.points, finished: closed, game: closed.length };
  }
  return { points: ZERO, finished: closed, game: closed.length + 1 };
}

/** The game whose rally (an event of type `rally`) was the last to stand, or 0 before any. */
export function lastRallyGame(
  envelopes: readonly EventEnvelope[],
  facts: ReadonlyMap<string, EventFacts>,
  rally: string,
): number {
  return envelopes.reduce(
    (game, envelope) => (envelope.type === rally ? (facts.get(envelope.id)?.game ?? game) : game),
    0,
  );
}

/** A game is under way once a rally of it stands; before that, the match's first or between games. */
export function phaseOf(state: SetBasedState, game: number, rallyGame: number): SetBasedPhase {
  if (state.phase === 'pre') return 'notStarted';
  if (state.phase !== 'live') return 'decided';
  if (rallyGame === game) return 'live';
  return game === 1 ? 'pre' : 'betweenGames';
}

/** The side due to serve, as the engine reads the ledger; else this phone's pick while it is shown; else null. */
export function serverOf(serve: SetBasedServeContext, picked: PadSide | null): PadSide | null {
  if (serve.side === null) return picked;
  return serve.side === 'home' ? 'first' : 'second';
}

/**
 * This phone's pick on the Start screen while it is the server to show, else null (the controller's rulings,
 * 2026-11-02): only at the match's 0–0, started, with the engine naming nobody because nothing has said who serves
 * (`undeclared`). An undone rally does not count as played, so undoing the first rally brings the pick back; a rally
 * still standing has scored, so the 0–0 rules the pick out then, as it does after a set score (the engine still says
 * `undeclared` there: a `serving` at 5–3 would be a false fact in the ledger).
 */
export function pickedServer(
  state: SetBasedState,
  serve: SetBasedServeContext,
  toss: PadSide | null,
): PadSide | null {
  // At a started 0–0 with no standing rally the engine can give no other reason: an equivalent mutant (task7.txt, R9).
  if (state.phase !== 'live' || serve.unknownBecause !== 'undeclared') return null;
  return state.sets.some((set) => set.home > 0 || set.away > 0) ? null : toss;
}

/**
 * The last thing done that the pad has words for: the latest event, or the one the latest void took back, said as
 * undone (`undoneTap` names the tap, or null for one whose Undo shows no line: the start's, which returns to the Start
 * screen). The sport's types: `D` is what a tap did, `T` the tap an Undo names.
 */
export function lastTapOf<D, T>(
  envelopes: readonly EventEnvelope[],
  recorded: ReadonlyMap<string, Pick<Recorded<D>, 'did'>>,
  undoneTap: (did: D) => T | null,
): D | { readonly kind: 'undone'; readonly tap: T } | null {
  for (const envelope of [...envelopes].reverse()) {
    const taken = envelope.voids === undefined ? undefined : recorded.get(envelope.voids);
    if (taken !== undefined) {
      const tap = undoneTap(taken.did);
      return tap === null ? null : { kind: 'undone', tap };
    }
    const did = recorded.get(envelope.id)?.did;
    if (did !== undefined) return did;
  }
  return null;
}
