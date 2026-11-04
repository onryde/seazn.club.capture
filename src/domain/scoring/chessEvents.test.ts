import { describe, expect, it } from 'vitest';
import { chessEventFor, chessPayloadForSend } from '@/domain/scoring/chessEvents';
import type { ChessMethod, ChessOutcome, ChessTap } from '@/domain/scoring/chessTypes';
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

const WHITE = (method: ChessMethod | null = null): ChessTap => ({
  kind: 'result',
  outcome: 'white',
  method,
});
const BLACK = (method: ChessMethod | null = null): ChessTap => ({
  kind: 'result',
  outcome: 'black',
  method,
});
const DRAW = (method: ChessMethod | null = null): ChessTap => ({
  kind: 'result',
  outcome: 'draw',
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

describe('chessEventFor: a result names the player, not the seat', () => {
  it('a White win is the entrant holding White: home when home has White, away after a pairing flipped it', () => {
    expect(eventFor(WHITE(), HOME_WHITE)).toEqual({
      type: 'boardgame.result',
      payload: { winner: HOME },
    });
    expect(eventFor(WHITE(), HOME_BLACK)).toEqual({
      type: 'boardgame.result',
      payload: { winner: AWAY },
    });
  });

  it('a Black win is the entrant holding Black', () => {
    expect(eventFor(BLACK(), HOME_WHITE)).toEqual({
      type: 'boardgame.result',
      payload: { winner: AWAY },
    });
    expect(eventFor(BLACK(), HOME_BLACK)).toEqual({
      type: 'boardgame.result',
      payload: { winner: HOME },
    });
  });

  it('a division without colours has no White: the first side is the White win, the second the Black', () => {
    expect(eventFor(WHITE(), NO_COLOURS)).toEqual({
      type: 'boardgame.result',
      payload: { winner: HOME },
    });
    expect(eventFor(BLACK(), NO_COLOURS)).toEqual({
      type: 'boardgame.result',
      payload: { winner: AWAY },
    });
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
    expect(eventFor(WHITE('checkmate'))).toEqual({
      type: 'boardgame.result',
      payload: { winner: HOME, method: 'checkmate' },
    });
    expect(eventFor(BLACK('resign'))).toEqual({
      type: 'boardgame.result',
      payload: { winner: AWAY, method: 'resign' },
    });
    expect(eventFor(DRAW('agreement'))).toEqual({
      type: 'boardgame.result',
      payload: { winner: null, method: 'agreement' },
    });
    expect(Object.keys((eventFor(WHITE()) as { payload: object }).payload)).toEqual(['winner']);
  });

  it('accepts adjudication on both sides of the line: the engine lists it for a win and for a draw', () => {
    expect(eventFor(WHITE('adjudication'))?.payload).toEqual({
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
  ] as const)('builds no win by %s, for either colour: a method only a draw ends by', (method) => {
    expect(eventFor(WHITE(method))).toBeNull();
    expect(eventFor(BLACK(method))).toBeNull();
  });

  it('builds no forfeit: the forfeit words are not a method the pad can name', () => {
    const forfeit = { kind: 'result', outcome: 'white', method: 'forfeit' } as unknown as ChessTap;
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
    const taps: ChessTap[] = [{ kind: 'start' }, WHITE(), DRAW(), { kind: 'swap' }];
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

// The outcome type is the three-way word the pad speaks; a fourth would be a decision for the owner.
const OUTCOMES: readonly ChessOutcome[] = ['white', 'draw', 'black'];
describe('chessEventFor: every outcome has an event', () => {
  it('builds one for each outcome on a live game', () => {
    for (const outcome of OUTCOMES) {
      expect(eventFor({ kind: 'result', outcome, method: null })?.type).toBe('boardgame.result');
    }
  });
});
