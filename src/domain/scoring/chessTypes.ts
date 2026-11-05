import { DECISIVE_METHODS, DRAWN_METHODS } from '@seazn/engine/sports/boardgame';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * Chess on the pad: the types (plan S2-3 Task 1; spec §4 to §6). Chess records one game's result and nothing else: no
 * clock, no moves, no board (ruling 57). The match is the engine's boardgame module (key `boardgame`, shared with every
 * generic one-against-one game, ruling 61); the state is a fold of the web's ledger by `@seazn/engine`, and these types
 * are only what the pad needs of it.
 */

/**
 * A result as the game is written, by colour: the player holding White, a draw, or the player holding Black. It is what the
 * display reads off the engine's outcome (`ChessResult`) and the scoresheet's line says; a tap never names it (it names a seat).
 */
export type ChessOutcome = 'white' | 'draw' | 'black';

/** How a game ended: a member of the engine's decisive list or of its drawn list (`adjudication` is in both). */
export type ChessMethod = (typeof DECISIVE_METHODS)[number] | (typeof DRAWN_METHODS)[number];

/**
 * The methods a result offers, in the engine's own order: the decisive list for a win by either player, the drawn list for
 * a draw (`winner` null). The engine refuses a method that contradicts the winner (`RESULT_METHOD_CONTRADICTS_WINNER`), so
 * the pad builds only these. A forfeit is in neither: the web refuses it from a device link and the organiser records it.
 */
export const methodsOf = (winner: PadSide | null): readonly ChessMethod[] =>
  winner === null ? DRAWN_METHODS : DECISIVE_METHODS;

/** The engine's colour of the home side: White or Black. */
export type ChessColour = 'W' | 'B';

/**
 * One tap the scorer can make. A result names the SEAT that won (the player in the top half or the bottom one), or none for
 * a draw, and the method, or none. It never names a colour: a pairing from another scorer can land while the sheet that
 * asks How is open, and the player the scorer chose must stay the player recorded (the Batch A review's ruling).
 */
export type ChessTap =
  | { readonly kind: 'start' }
  | {
      readonly kind: 'result';
      readonly winner: PadSide | null;
      readonly method: ChessMethod | null;
    }
  | { readonly kind: 'swap' };

/**
 * What an event did, as the last-tap line and History say it. A result names the winner by the seat they sit in (the
 * names keep their places whoever holds White), or null for a draw.
 */
export type ChessDone =
  | { readonly kind: 'start' }
  | { readonly kind: 'swap' }
  | {
      readonly kind: 'result';
      readonly winner: PadSide | null;
      readonly method: ChessMethod | null;
    };

/** What the last tap did, or the tap Undo took back. */
export type ChessLastTap = ChessDone | { readonly kind: 'undone'; readonly tap: ChessTap };

/**
 * Not started; live; a drawn bracket game waiting for the organiser's tie-break; a result recorded; the result locked by
 * the organiser (or the game abandoned: nothing more can be recorded either way).
 */
export type ChessPhase = 'notStarted' | 'live' | 'tiebreak' | 'done' | 'final';

/**
 * The game's result as it stands. Whose it is, this phone's or another scorer's, is not here: it decides only whether Undo
 * is offered, and that is `ChessDisplay.undoable` (`ownEventIds`, queued taps included, never the device link, which a
 * browser on the same link shares).
 */
export type ChessResult = {
  readonly outcome: ChessOutcome;
  readonly method: ChessMethod | null;
};

/** A chess game as the pad shows it, folded from the ledger and this phone's queued taps. */
export type ChessDisplay = {
  readonly phase: ChessPhase;
  /** Whether home holds White or Black; null when the division plays without colours (`cfg.colors` false). */
  readonly colorOfHome: ChessColour | null;
  /** The names as the organiser typed them, first on top. A swap moves the chips and never these. */
  readonly names: Readonly<Record<PadSide, string>>;
  /** The result that stands; null while the game is live, while a drawn bracket game waits, and after a double walkover. */
  readonly result: ChessResult | null;
  /** Where the game sits: competition, division, round, the fixture's code, the sides. */
  readonly context: MatchContext;
  readonly lastTap: ChessLastTap | null;
  /** This phone's Undo would take the result back: it recorded it and nothing has been recorded since. */
  readonly undoable: boolean;
};

/**
 * Every dictionary key the pad and its History words name. The kit translates them as `MessageKey`, so each must exist in
 * en.json (the sheet's own words are the screen's).
 */
export type ChessPadKey =
  | `scoring.chess.chip.${'white' | 'black'}`
  | `scoring.chess.result.${'white' | 'black' | 'plain'}`
  | 'scoring.chess.hint'
  | 'scoring.chess.tool.draw'
  | 'scoring.chess.tool.swap'
  | 'scoring.chess.start.ask'
  | 'scoring.chess.waiting.tiebreak'
  | 'scoring.chess.forfeit'
  | 'scoring.chess.tallySaid'
  | 'scoring.chess.tallyNone'
  | 'scoring.chess.gameHeading'
  | 'scoring.chess.last.start'
  | 'scoring.chess.last.swap'
  | 'scoring.chess.last.won'
  | 'scoring.chess.last.wonBy'
  | 'scoring.chess.last.drawn'
  | 'scoring.chess.last.drawnBy'
  | 'scoring.chess.last.undone'
  | `scoring.chess.method.${ChessMethod}`;

/** Chess's pad types: what the match runtime is generic over (`SportTypes`). */
export type ChessTypes = {
  readonly tap: ChessTap;
  readonly display: ChessDisplay;
  readonly padKey: ChessPadKey;
  readonly undone: ChessTap;
};

// ---------------------------------------------------------------------------------------------------------------
// Colours and seats
// ---------------------------------------------------------------------------------------------------------------

const OTHER_SEAT = { first: 'second', second: 'first' } as const;

/** The seat holding White: the first, unless a pairing gave White to the second. With no colours the first stands for it. */
export const whiteSeatOf = (colorOfHome: ChessColour | null): PadSide =>
  colorOfHome === 'B' ? 'second' : 'first';

/** The seat a win by `outcome` names, or null for a draw. */
export function seatOfOutcome(
  outcome: ChessOutcome,
  colorOfHome: ChessColour | null,
): PadSide | null {
  if (outcome === 'draw') return null;
  const white = whiteSeatOf(colorOfHome);
  return outcome === 'white' ? white : OTHER_SEAT[white];
}

/** The outcome when the player in `seat` wins. */
export const outcomeOfSeat = (seat: PadSide, colorOfHome: ChessColour | null): 'white' | 'black' =>
  seat === whiteSeatOf(colorOfHome) ? 'white' : 'black';

/** The other seat. */
export const otherSeat = (seat: PadSide): PadSide => OTHER_SEAT[seat];

const ALL_METHODS: readonly string[] = [...DECISIVE_METHODS, ...DRAWN_METHODS];

/** A method of the engine's decisive or drawn list, else none (a forfeit, written as a result by an older ledger). */
export const methodOf = (value: unknown): ChessMethod | null =>
  typeof value === 'string' && ALL_METHODS.includes(value) ? (value as ChessMethod) : null;
