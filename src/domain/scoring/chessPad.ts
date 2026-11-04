import { doneSaid, undoneSaid } from '@/domain/scoring/chessHistory';
import {
  METHODS_FOR,
  seatOfOutcome,
  whiteSeatOf,
  type ChessDisplay,
  type ChessMethod,
  type ChessOutcome,
  type ChessPadKey,
} from '@/domain/scoring/chessTypes';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadServing,
  type PadSide,
  type PadStart,
  type PadStateCard,
  type PadStripItem,
  type PadSync,
  type PadTally,
  type PadTool,
  type PadView,
} from '@/domain/scoring/padView';
import { padMarks } from '@/domain/scoring/setBasedPad';

/**
 * Chess on the pad (spec §4; the owner's rulings 57 to 61; plan S2-3 Task 1). Chess has no points to tap: the two players
 * are the halves, and a tap on one records a win for that player (the sheet that asks How is the screen's). Draw and Swap
 * colours are the tools. Each half carries its colour's word on the kit's one corner plate (WHITE, BLACK), never colour
 * alone; the names keep their places and a swap moves the plates. Whoever keeps the score (the engine, through
 * `foldChess`) decides every field of the display: the pad only draws them.
 */

type Tool = PadTool<ChessPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/** The engine's own words for each outcome, as the game is written: White's score first. */
const LINE: Readonly<Record<ChessOutcome, string>> = { white: '1–0', draw: '½–½', black: '0–1' };

/** A point under a name: a win, half for a draw, a loss. */
const POINT = { win: '1', draw: '½', loss: '0' } as const;

/** The result as it is written on a scoresheet, or nothing while no result stands. */
export const chessResultLine = (display: ChessDisplay): string =>
  display.result === null ? '' : LINE[display.result.outcome];

/** The methods an outcome offers, in the engine's order: the sheet that asks How lists these and no others. */
export const chessMethodsFor = (outcome: ChessOutcome): readonly ChessMethod[] =>
  METHODS_FOR[outcome];

/** The game is decided: a result is recorded, or the organiser has locked it. */
export const chessDecided = (display: ChessDisplay): boolean =>
  display.phase === 'done' || display.phase === 'final';

/** The pad takes a result while the game is live, and at no other time: the engine takes none before the start or after. */
const takesResult = (display: ChessDisplay): boolean => display.phase === 'live';

/**
 * The pad for a chess game: the first player on top, the second below, each with a colour plate and, once a result
 * stands, a point under the name; Draw and Swap colours while the game is live; one note in the strip (the tie-break
 * waits for the organiser); a recorded result is the card over the players. Before the game starts, the Start screen's
 * question in the halves' place. `sync` is the transport's word, not the game's.
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
  return withCard(view, chessDecided(display) ? RESULT_RECORDED : null);
}

const RESULT_RECORDED: PadStateCard = { kind: 'resultRecorded', undoLeft: null };

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
    serving: colour === null ? null : plate(colour),
    // The bar follows the plate, as the server's does elsewhere: lit for the player holding White.
    bar: colour === 'white' ? 'lit' : 'dim',
    // What a tap records, as the button says it: "White won · A. Sharma", or the name alone with no colours.
    hint: { key: `scoring.chess.result.${colour ?? 'plain'}`, vars: { name } },
    tappable: takesResult(display),
  };
}

/** The colour's plate: its word drawn, and the same said to a screen reader. */
function plate(colour: Colour): PadServing<ChessPadKey> {
  return {
    shown: { key: `scoring.chess.chip.${colour}` },
    said: { key: `scoring.chess.chipSaid.${colour}` },
  };
}

/** The player's point once a result stands, else nothing. */
function point(display: ChessDisplay, seat: PadSide): string {
  const { result } = display;
  if (result === null) return '';
  if (result.outcome === 'draw') return POINT.draw;
  return seatOfOutcome(result.outcome, display.colorOfHome) === seat ? POINT.win : POINT.loss;
}

/** The header's tally: the result line once a result stands, and the points said with the names. */
function tally(
  display: ChessDisplay,
  halves: readonly [PadHalf<ChessPadKey>, PadHalf<ChessPadKey>],
): PadTally<ChessPadKey> {
  const [top, bottom] = halves;
  return {
    shown: chessResultLine(display),
    said: {
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
 * Before the game starts: the two names, top first. The kit draws the match details above Start match. Chess has no side
 * to pick (no serve), so `needsToss` is false: the kit draws no question and no picker, and Start match is ready.
 */
function start(display: ChessDisplay): PadStart<ChessPadKey> | null {
  if (display.phase !== 'notStarted') return null;
  return {
    ask: { key: 'scoring.chess.start.ask' },
    needsToss: false,
    sides: [
      { side: 'first', label: display.names.first },
      { side: 'second', label: display.names.second },
    ],
  };
}

/** One slot, the note: the tie-break waits for the organiser, who records it; else empty, so the strip never shifts. */
function strip(display: ChessDisplay): readonly PadStripItem<ChessPadKey>[] {
  const waiting = display.phase === 'tiebreak';
  return [{ slot: 'note', text: waiting ? { key: 'scoring.chess.waiting.tiebreak' } : null }];
}

/** What the last tap did, and the one Undo while this phone can still take its own result back. */
function lastTap(display: ChessDisplay): PadLastTap<ChessPadKey> | null {
  const did = display.lastTap;
  if (did === null) return null;
  if (did.kind === 'undone') {
    return { text: undoneSaid(display.names, display.colorOfHome, did.tap), undo: false };
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

/**
 * Draw, and Swap colours when the division plays with colours, while the game is live. A draw is a result like the
 * players' halves (the sheet asks How); a swap is the arbiter's pairing card, recordable before or during the game.
 */
function tools(display: ChessDisplay): readonly Tool[] {
  if (!takesResult(display)) return [];
  const draw: Tool = { id: DRAW, label: { key: 'scoring.chess.tool.draw' }, ...PLAIN };
  const swap: Tool = { id: SWAP, label: { key: 'scoring.chess.tool.swap' }, ...PLAIN };
  return display.colorOfHome === null ? [draw] : [draw, swap];
}
