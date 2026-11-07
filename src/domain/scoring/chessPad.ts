import { advancesSaid, doneSaid, undoneSaid } from '@/domain/scoring/chessHistory';
import {
  methodsOf,
  seatOfOutcome,
  whiteSeatOf,
  type ChessDisplay,
  type ChessMethod,
  type ChessOutcome,
  type ChessPadKey,
  type ChessResult,
} from '@/domain/scoring/chessTypes';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadSide,
  type PadStart,
  type PadStateCard,
  type PadStripItem,
  type PadSync,
  type PadTally,
  type PadText,
  type PadTool,
  type PadView,
} from '@/domain/scoring/padView';
import { padMarks } from '@/domain/scoring/setBasedPad';

/**
 * Chess on the pad (spec §4; the owner's rulings 57 to 61; plan S2-3 Task 1). Chess has no points to tap: the two players
 * are the halves, and a tap on one records a win for that player (the sheet that asks How is the screen's). Draw and Swap
 * colours are the tools. Each half carries its colour's word on a plate (`PadHalf.plate`: WHITE, BLACK), never colour
 * alone, and says what a tap records in its action ("White won · A. Sharma"); the names keep their places and a swap moves
 * the plates. Whoever keeps the score (the engine, through `foldChess`) decides every field of the display: the pad only
 * draws them.
 */

type Tool = PadTool<ChessPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/**
 * The header's line for each outcome, as the game is written: White's score first. A draw is a bare "½", not the
 * scoresheet's "½–½": at the tally's size that is 81 dp, wider than the 72 the header's row leaves at 320 dp, and would push
 * Match details and History off the screen (`chessFit.test.ts`). Each half says "½" under its name and the strip says
 * "Drawn", so nothing is lost; Home's Finished card writes "½–½" (`chessCardLine`), which has the room.
 */
const LINE: Readonly<Record<ChessOutcome, string>> = { white: '1–0', draw: '½', black: '0–1' };

/** A point under a name: a win, half for a draw, a loss. */
const POINT = { win: '1', draw: '½', loss: '0' } as const;

/**
 * The result as it is written on a scoresheet, White's score first, or nothing while no result stands. The pad's own line
 * (its tally), where the last-tap line beside it names the winner.
 */
export const chessResultLine = (display: ChessDisplay): string =>
  display.result === null ? '' : LINE[display.result.outcome];

/**
 * The result as Home's Finished card writes it: the first side's score first, as the kit's contract for a sport's
 * `resultLine` says ("0–1" when the second name won, whoever held White), or nothing while no result stands.
 */
export function chessCardLine(display: ChessDisplay): string {
  const { result } = display;
  if (result === null) return '';
  if (result.outcome === 'draw') return `${POINT.draw}–${POINT.draw}`;
  const first = seatOfOutcome(result.outcome, display.colorOfHome) === 'first';
  return first ? `${POINT.win}–${POINT.loss}` : `${POINT.loss}–${POINT.win}`;
}

/**
 * The methods a result offers, in the engine's order: the sheet that asks How lists these and no others. `winner` is the
 * seat that won, or null for a draw.
 */
export const chessMethodsFor = (winner: PadSide | null): readonly ChessMethod[] =>
  methodsOf(winner);

/** The game is decided: a result is recorded, or the organiser has locked it. */
export const chessDecided = (display: ChessDisplay): boolean =>
  display.phase === 'done' || display.phase === 'final';

/** The pad takes a result while the game is live, and at no other time: the engine takes none before the start or after. */
export const chessTakesResult = (display: ChessDisplay): boolean => display.phase === 'live';

/**
 * The pad for a chess game: the first player on top, the second below, each with a colour plate and, once a result
 * stands, a point under the name; Draw and Swap colours while the game is live, or the one Tie-break tool while a drawn
 * knockout game waits for its tie-break; one note in the strip; a recorded result is the card over the players. Before the
 * game starts, the Start screen's question in the halves' place. `sync` is the transport's word, not the game's.
 */
export function chessPad(display: ChessDisplay, sync: PadSync = SYNCED): PadView<ChessPadKey> {
  const halves = [half(display, 'first'), half(display, 'second')] as const;
  const view: PadView<ChessPadKey> = {
    halves,
    tally: tally(display, halves),
    details: { context: display.context, rules: [] },
    start: start(display),
    strip: strip(display),
    lastTap: lastTap(display),
    sync,
    tools: tools(display),
    card: null,
  };
  return withCard(view, cardOf(display));
}

const RESULT_RECORDED: PadStateCard = { kind: 'resultRecorded', undoLeft: null };

/**
 * An abandoned game, or a double walkover, is over with no result (the Batch A review's M2): the card that says nothing was
 * decided is the cancelled match's, which claims neither a recorded result nor the organiser's lock.
 */
const NO_RESULT: PadStateCard = { kind: 'cancelled' };

/** The card over the players: a recorded result, or a finished game with none; no card while the game can still change. */
function cardOf(display: ChessDisplay): PadStateCard | null {
  if (!chessDecided(display)) return null;
  return display.result === null ? NO_RESULT : RESULT_RECORDED;
}

// ---------------------------------------------------------------------------------------------------------------
// The halves
// ---------------------------------------------------------------------------------------------------------------

type Colour = 'white' | 'black';

/** The colour the player in `seat` holds, or null in a division without colours. */
function colourOf(display: ChessDisplay, seat: PadSide): Colour | null {
  if (display.colorOfHome === null) return null;
  return seat === whiteSeatOf(display.colorOfHome) ? 'white' : 'black';
}

function half(display: ChessDisplay, seat: PadSide): PadHalf<ChessPadKey> {
  const colour = colourOf(display, seat);
  const name = display.names[seat];
  return {
    side: seat,
    label: name,
    value: point(display, seat),
    periods: null,
    sub: null,
    marks: padMarks(null, null),
    // Chess has no server: the colour is a plate of its own, never the serving plate.
    serving: null,
    plate: plateOf(colour),
    // The bar follows the colour: lit for the player holding White.
    bar: colour === 'white' ? 'lit' : 'dim',
    // What a tap records, as the button says it: "White won · A. Sharma", or the name alone with no colours.
    action: { key: `scoring.chess.result.${colour ?? 'plain'}`, vars: { name } },
    // What a screen reader is told a tap does; the colour is in the half's name, on its plate.
    hint: { key: 'scoring.chess.hint', vars: { name } },
    tappable: chessTakesResult(display),
  };
}

/** The colour's word on its plate (WHITE, BLACK), or none in a division without colours. */
const plateOf = (colour: Colour | null): PadText<ChessPadKey> | null =>
  colour === null ? null : { key: `scoring.chess.chip.${colour}` };

/** The player's point once a result stands, else nothing. */
function point(display: ChessDisplay, seat: PadSide): string {
  const { result } = display;
  if (result === null) return '';
  if (result.outcome === 'draw') return POINT.draw;
  return seatOfOutcome(result.outcome, display.colorOfHome) === seat ? POINT.win : POINT.loss;
}

/**
 * The header's tally: the result line once a result stands, and the points said with the names. Before one stands (the
 * game in play, or over with none) the line is empty and so are the points, which a screen reader would read as
 * "Result: A. Sharma , L. Chen ": it is told there is no result.
 */
function tally(
  display: ChessDisplay,
  halves: readonly [PadHalf<ChessPadKey>, PadHalf<ChessPadKey>],
): PadTally<ChessPadKey> {
  const [top, bottom] = halves;
  return {
    shown: chessResultLine(display),
    said:
      display.result === null
        ? { key: 'scoring.chess.tallyNone' }
        : {
            key: 'scoring.chess.tallySaid',
            vars: {
              first: top.label,
              firstPoints: top.value,
              second: bottom.label,
              secondPoints: bottom.value,
            },
          },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Before the start, the strip, the last tap
// ---------------------------------------------------------------------------------------------------------------

/**
 * Before the game starts: the two names, top first, each with its colour's plate. The kit draws the match details above
 * Start match. Chess has no side to pick (no serve), so `needsToss` is false: the kit draws no question and no picker, the
 * names with their plates as read-only rows, and Start match is ready.
 */
function start(display: ChessDisplay): PadStart<ChessPadKey> | null {
  if (display.phase !== 'notStarted') return null;
  return {
    ask: { key: 'scoring.chess.start.ask' },
    needsToss: false,
    sides: [
      { side: 'first', label: display.names.first, plate: plateOf(colourOf(display, 'first')) },
      { side: 'second', label: display.names.second, plate: plateOf(colourOf(display, 'second')) },
    ],
  };
}

/** One slot, the note, so the strip never shifts: what the pad says of the game now (`noteOf`), or nothing. */
function strip(display: ChessDisplay): readonly PadStripItem<ChessPadKey>[] {
  return [{ slot: 'note', text: noteOf(display) }];
}

/**
 * Before the result: a forfeit is the organiser's to record, which the pad cannot (the web refuses it from a device link).
 * While a drawn knockout game waits for its tie-break: nothing, since the Tie-break tool is the call (S2-3b). A drawn game
 * the stage plays no tie-break for: the organiser's to decide, said. A tie-break that decided it: who advances and by which
 * rung; the organiser's drawing of lots, who advances "by lot" (ruling 63b). Once a result stands: who won it, in words,
 * since an organiser's walkover leaves the last-tap line without a name; the header's result line reads White's score
 * first. A game over with no result says nothing here: its card does.
 */
function noteOf(display: ChessDisplay): PadText<ChessPadKey> | null {
  const { pending, held, decided } = display.tiebreak;
  if (pending) return null;
  if (held) return { key: 'scoring.chess.waiting.tiebreak' };
  if (decided !== null) return advancesSaid(display.names[decided.advances], decided.rung);
  if (display.result !== null) return resultSaid(display, display.result);
  return chessDecided(display) ? null : { key: 'scoring.chess.forfeit' };
}

/** "A. Sharma won" or "Drawn", with no method: the last-tap line says how when it can. */
function resultSaid(display: ChessDisplay, result: ChessResult): PadText<ChessPadKey> {
  const winner = seatOfOutcome(result.outcome, display.colorOfHome);
  return doneSaid(display.names, { kind: 'result', winner, method: null });
}

/** What the last tap did, and the one Undo while this phone can still take its own result back. */
function lastTap(display: ChessDisplay): PadLastTap<ChessPadKey> | null {
  const did = display.lastTap;
  if (did === null) return null;
  if (did.kind === 'undone') {
    return { text: undoneSaid(display.names, did.tap), undo: false };
  }
  return { text: doneSaid(display.names, did), undo: display.undoable };
}

// ---------------------------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------------------------

/** The cells with no second line: a plain outline, usable. */
const PLAIN = { detail: null, kind: 'standard', enabled: true } as const;

const DRAW = 'draw';
const SWAP = 'swap';
const TIEBREAK = 'tiebreak';

/** The one call while a tie-break is owed: the lime plate, since nothing else on the pad can be done (the sheet asks which). */
const TIEBREAK_TOOL: Tool = {
  id: TIEBREAK,
  label: { key: 'scoring.chess.tiebreak.tool' },
  detail: null,
  kind: 'primary',
  enabled: true,
};

/**
 * Draw, and Swap colours when the division plays with colours, while the game is live. A draw is a result like the
 * players' halves (the sheet asks How); a swap is the arbiter's pairing card, offered only while the game is live. While a
 * drawn knockout game waits for its tie-break, the Tie-break tool alone, in their place (the web hides them too).
 */
function tools(display: ChessDisplay): readonly Tool[] {
  if (display.tiebreak.pending) return [TIEBREAK_TOOL];
  if (!chessTakesResult(display)) return [];
  const draw: Tool = { id: DRAW, label: { key: 'scoring.chess.tool.draw' }, ...PLAIN };
  const swap: Tool = { id: SWAP, label: { key: 'scoring.chess.tool.swap' }, ...PLAIN };
  return display.colorOfHome === null ? [draw] : [draw, swap];
}
