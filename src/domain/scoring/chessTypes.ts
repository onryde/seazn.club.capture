import {
  ARMAGEDDON_RESULTS,
  DECISIVE_METHODS,
  DRAWN_METHODS,
  type TiebreakRung,
} from '@seazn/engine/sports/boardgame';
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

/**
 * The rungs of a drawn knockout game's tie-break, the engine's own list: rapid, blitz and Armageddon. Lots are not a rung: a
 * drawing of lots is the organiser's settle, and the pad never sends one.
 */
export type ChessRung = TiebreakRung;

/**
 * What sent a drawn knockout game's player through: a tie-break of one of the rungs, or the organiser's drawing of lots
 * (`core.settle {method: 'lot'}`; ruling 63b), which the strip, the last-tap line and History say as "{name} advances · by lot".
 * The pad never offers or sends lots.
 */
export type ChessDecider = ChessRung | 'lots';

/**
 * How an Armageddon ended, from White's side. The scorer never names its winner: White won sends the other entrant through,
 * Black won or a draw sends Black (BG-KO-2), and the engine works that out.
 */
export type ChessArmageddonResult = (typeof ARMAGEDDON_RESULTS)[number];

/** The engine's three results of an Armageddon, in its order: the sheet lists these and no others. */
export const CHESS_ARMAGEDDON_RESULTS: readonly ChessArmageddonResult[] = ARMAGEDDON_RESULTS;

/**
 * The mini-match scores the web's pad offers for a rapid or blitz tie-break, besides none: the wire takes whole points with an
 * optional half either side of an en dash (`CHESS_SCORE`).
 */
export const CHESS_TIEBREAK_SCORES = ['2–0', '1½–½'] as const;

export type ChessTiebreakScore = (typeof CHESS_TIEBREAK_SCORES)[number];

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
  | { readonly kind: 'swap' }
  | ChessTiebreakTap;

/**
 * The tie-break of a drawn knockout game, as the scorer chooses it, by SEAT like a result (a pairing from another scorer
 * must not change the player recorded). A rapid or blitz one names the seat that won and the score, or none; an Armageddon
 * names the seat that had Black and how it ended, and never a winner.
 */
export type ChessTiebreakTap =
  | {
      readonly kind: 'tiebreak';
      readonly rung: Exclude<ChessRung, 'armageddon'>;
      readonly winner: PadSide;
      readonly score: ChessTiebreakScore | null;
    }
  | {
      readonly kind: 'tiebreak';
      readonly rung: 'armageddon';
      readonly black: PadSide;
      readonly result: ChessArmageddonResult;
    };

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
    }
  | ChessTiebreakTap
  /** The organiser's drawing of lots, by the seat of the entrant it sent through (ruling 63b). Never a tap of this phone's. */
  | { readonly kind: 'lots'; readonly advances: PadSide };

/** What the last tap did, or the tap Undo took back. */
export type ChessLastTap = ChessDone | { readonly kind: 'undone'; readonly tap: ChessTap };

/**
 * Not started; live; a drawn bracket game waiting for its tie-break; a result recorded (a tie-break included); the result
 * locked by the organiser (or the game abandoned: nothing more can be recorded either way).
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

/**
 * Where a drawn knockout game stands on its tie-break. A game is a knockout game when the stage has `cfg.tiebreak`; its
 * `rungs` are then the stage's own list in the stage's order (all three when it names none, none when it names an empty
 * list). The listed rungs are a menu: the engine has no "next rung", and one tie-break ends the match.
 */
export type ChessTiebreakState = {
  /** The rungs the stage plays, in its order; none outside a knockout stage and where the stage plays no tie-break game. */
  readonly rungs: readonly ChessRung[];
  /** A drawn game waits for a tie-break this phone may record (the engine's `deciderPending`). */
  readonly pending: boolean;
  /**
   * A drawn knockout game whose stage lists no rung: the server holds it level for the organiser (the engine folds it a done
   * draw), and nothing the pad records decides it.
   */
  readonly held: boolean;
  /**
   * What decided it: a tie-break's rung, or the organiser's drawing of lots (`lots`, ruling 63b), and the seat that advances.
   * The game itself stays a draw.
   */
  readonly decided: { readonly rung: ChessDecider; readonly advances: PadSide } | null;
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
  readonly tiebreak: ChessTiebreakState;
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
  | 'scoring.chess.tiebreak.tool'
  | 'scoring.chess.tiebreak.advances'
  | `scoring.chess.tiebreak.rung.${ChessDecider}`
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

/**
 * The seat a tie-break sends through. A rapid or blitz one is the winner the scorer named. An Armageddon is worked out as the
 * engine works it out (BG-KO-2): White won, the other seat advances; Black won, or the game was drawn, Black does.
 */
export function advancerOf(choice: ChessTiebreakTap): PadSide {
  if (choice.rung !== 'armageddon') return choice.winner;
  return choice.result === 'white' ? OTHER_SEAT[choice.black] : choice.black;
}

const ALL_METHODS: readonly string[] = [...DECISIVE_METHODS, ...DRAWN_METHODS];

/** A method of the engine's decisive or drawn list, else none (a forfeit, written as a result by an older ledger). */
export const methodOf = (value: unknown): ChessMethod | null =>
  typeof value === 'string' && ALL_METHODS.includes(value) ? (value as ChessMethod) : null;
