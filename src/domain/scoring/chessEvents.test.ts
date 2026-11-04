import { describe, expect, it } from 'vitest';
import { chessEventFor, chessPayloadForSend } from '@/domain/scoring/chessEvents';
import type { ChessMethod, ChessTap } from '@/domain/scoring/chessTypes';
import type { PadSide } from '@/domain/scoring/padView';
import {
  AWAY,
  GAME,
  HOME,
  chessDisplay,
  ledgerOf,
  queuedOf,
  result,
  start,
} from '../../../test/chessLedger';

// A pad tap as the event the server records (spec §5; plan S2-3 Task 1). Every payload is written out from the spec's
// table, never computed by the code under test. The top half is home; White is home unless a pairing flipped it.

/** The first (top) player's win, the second's, and a draw: a tap names the seat, never the colour (the Batch A review's ruling). */
const FIRST = (method: ChessMethod | null = null): ChessTap => ({
  kind: 'result',
  winner: 'first',
  method,
});
const SECOND = (method: ChessMethod | null = null): ChessTap => ({
  kind: 'result',
  winner: 'second',
  method,
});
const DRAW = (method: ChessMethod | null = null): ChessTap => ({
  kind: 'result',
  winner: null,
  method,
});

const HOME_WHITE = chessDisplay({ colorOfHome: 'W' });
const HOME_BLACK = chessDisplay({ colorOfHome: 'B' });
const NO_COLOURS = chessDisplay({ colorOfHome: null });

const eventFor = (tap: ChessTap, display = HOME_WHITE) =>
  chessEventFor(tap, { bootstrap: GAME, display });

describe('chessEventFor: the start', () => {
  it('is core.start with an empty payload', () => {
    expect(eventFor({ kind: 'start' })).toEqual({ type: 'core.start', payload: {} });
  });

  it('is the same on any display: the start asks nothing of the colours', () => {
    expect(eventFor({ kind: 'start' }, NO_COLOURS)).toEqual({ type: 'core.start', payload: {} });
    expect(eventFor({ kind: 'start' }, HOME_BLACK)).toEqual({ type: 'core.start', payload: {} });
  });
});

describe('chessEventFor: a result names the seat’s entrant, never a colour', () => {
  it('the first player’s win is home’s entrant, and the second’s is away’s, whoever holds White', () => {
    for (const display of [HOME_WHITE, HOME_BLACK, NO_COLOURS]) {
      expect(eventFor(FIRST(), display)).toEqual({
        type: 'boardgame.result',
        payload: { winner: HOME },
      });
      expect(eventFor(SECOND(), display)).toEqual({
        type: 'boardgame.result',
        payload: { winner: AWAY },
      });
    }
  });

  // The How sheet is open while a pairing from another scorer lands: the colours flip between the choice and Record, and the
  // event must still name the player the scorer chose.
  it('names the player chosen even when the colours flipped between the choice and Record', () => {
    const chosen = FIRST();
    const asChosen = eventFor(chosen, HOME_WHITE);
    const afterPairing = eventFor(chosen, HOME_BLACK);
    expect(afterPairing).toEqual(asChosen);
    expect(afterPairing).toEqual({ type: 'boardgame.result', payload: { winner: HOME } });
  });

  it('a draw has no winner, with the winner key present and null, whoever holds White', () => {
    for (const display of [HOME_WHITE, HOME_BLACK, NO_COLOURS]) {
      expect(eventFor(DRAW(), display)).toEqual({
        type: 'boardgame.result',
        payload: { winner: null },
      });
    }
  });

  it('carries a method as method, and no method key when none was chosen', () => {
    expect(eventFor(FIRST('checkmate'))).toEqual({
      type: 'boardgame.result',
      payload: { winner: HOME, method: 'checkmate' },
    });
    expect(eventFor(SECOND('resign'))).toEqual({
      type: 'boardgame.result',
      payload: { winner: AWAY, method: 'resign' },
    });
    expect(eventFor(DRAW('agreement'))).toEqual({
      type: 'boardgame.result',
      payload: { winner: null, method: 'agreement' },
    });
    expect(Object.keys((eventFor(FIRST()) as { payload: object }).payload)).toEqual(['winner']);
  });

  it('accepts adjudication on both sides of the line: the engine lists it for a win and for a draw', () => {
    expect(eventFor(FIRST('adjudication'))?.payload).toEqual({
      winner: HOME,
      method: 'adjudication',
    });
    expect(eventFor(DRAW('adjudication'))?.payload).toEqual({
      winner: null,
      method: 'adjudication',
    });
  });

  // The web refuses what the engine's RESULT_METHOD_CONTRADICTS_WINNER names; a pad that could build it would be
  // refused at the server with a word the scorer cannot act on.
  it.each(['checkmate', 'resign', 'time', 'illegal_move'] as const)(
    'builds no draw by %s: a method only a win ends by',
    (method) => {
      expect(eventFor(DRAW(method))).toBeNull();
    },
  );

  it.each([
    'agreement',
    'stalemate',
    'insufficient',
    'repetition',
    'fifty_move',
    'dead_position',
  ] as const)('builds no win by %s, for either player: a method only a draw ends by', (method) => {
    expect(eventFor(FIRST(method))).toBeNull();
    expect(eventFor(SECOND(method))).toBeNull();
  });

  it('builds no forfeit: the forfeit words are not a method the pad can name', () => {
    const forfeit = { kind: 'result', winner: 'first', method: 'forfeit' } as unknown as ChessTap;
    expect(eventFor(forfeit)).toBeNull();
  });
});

describe('chessEventFor: swapping colours', () => {
  it('names the entrant who will now hold White, which is the one holding Black today', () => {
    expect(eventFor({ kind: 'swap' }, HOME_WHITE)).toEqual({
      type: 'boardgame.pairing',
      payload: { white: AWAY },
    });
    expect(eventFor({ kind: 'swap' }, HOME_BLACK)).toEqual({
      type: 'boardgame.pairing',
      payload: { white: HOME },
    });
  });

  it('is nothing in a division without colours: there is no colour to swap', () => {
    expect(eventFor({ kind: 'swap' }, NO_COLOURS)).toBeNull();
  });
});

describe('chessEventFor: an empty seat', () => {
  it('builds nothing for any tap while a seat has no entrant', () => {
    const bye = { ...GAME, sides: { home: GAME.sides.home, away: null } };
    const taps: ChessTap[] = [{ kind: 'start' }, FIRST(), DRAW(), { kind: 'swap' }];
    for (const tap of taps) {
      expect(chessEventFor(tap, { bootstrap: bye, display: HOME_WHITE })).toBeNull();
    }
  });
});

describe('chessPayloadForSend', () => {
  // Chess stamps nothing a later ledger could make stale: a result names its winner by entrant, a pairing its White.
  // So a send is what was queued, whether it is the first send, a resend whose copy the ledger holds, or a resend whose
  // copy it does not.
  const queued = queuedOf('tap-1', result('H', 'checkmate'));
  const ledger = ledgerOf([start(), result('A')]);

  it.each([
    ['a first send', false, []],
    ['a resend whose copy the ledger holds', true, ledger],
    ['a resend with no copy', false, ledger],
  ] as const)('sends the queued payload as it is: %s', (_name, copied, held) => {
    expect(chessPayloadForSend(queued, held, copied)).toEqual({
      winner: HOME,
      method: 'checkmate',
    });
  });

  it('sends a pairing and a start unchanged too', () => {
    const pairing = queuedOf('tap-2', { type: 'boardgame.pairing', payload: { white: AWAY } });
    expect(chessPayloadForSend(pairing, ledger, false)).toEqual({ white: AWAY });
    expect(chessPayloadForSend(queuedOf('tap-3', start()), [], false)).toEqual({});
  });
});

// A result is one of three: the first player's win, the second's, or a draw; a fourth would be a decision for the owner.
const WINNERS: readonly PadSide[] = ['first', 'second'];
describe('chessEventFor: every result has an event', () => {
  it('builds one for each winner and for a draw on a live game', () => {
    for (const winner of [...WINNERS, null] as const) {
      expect(eventFor({ kind: 'result', winner, method: null })?.type).toBe('boardgame.result');
    }
  });
});
