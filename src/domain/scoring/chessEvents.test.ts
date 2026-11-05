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
  pendingTiebreak,
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

// The tie-break of a drawn knockout game (S2-3b; the engine's `boardgame.tiebreak`, `boardgame.js:189-209`). Both payloads are
// STRICT: a rapid or blitz one is {rung, winner, score?} (the winner an entrant, the score an en-dash shape); an Armageddon
// is {rung, black, result} and names no winner, so there is no way to record a draw that advances White. The tap names SEATS.
describe('chessEventFor: a tie-break', () => {
  const PENDING = chessDisplay({
    phase: 'tiebreak',
    tiebreak: pendingTiebreak(['rapid', 'blitz', 'armageddon']),
  });
  const PENDING_FLIPPED = { ...PENDING, colorOfHome: 'B' } as const;
  const tiebreakEvent = (tap: ChessTap, display = PENDING) => eventFor(tap, display);
  const decided = (rung: 'rapid' | 'blitz', winner: PadSide, score: '2–0' | '1½–½' | null) =>
    ({ kind: 'tiebreak', rung, winner, score }) as const;
  const armageddon = (black: PadSide, outcome: 'white' | 'black' | 'draw') =>
    ({ kind: 'tiebreak', rung: 'armageddon', black, result: outcome }) as const;

  it('records a rapid tie-break as the winner’s entrant, with no score key when none was said', () => {
    expect(tiebreakEvent(decided('rapid', 'first', null))).toEqual({
      type: 'boardgame.tiebreak',
      payload: { rung: 'rapid', winner: HOME },
    });
    expect(tiebreakEvent(decided('rapid', 'second', null))).toEqual({
      type: 'boardgame.tiebreak',
      payload: { rung: 'rapid', winner: AWAY },
    });
    const payload = tiebreakEvent(decided('rapid', 'first', null))?.payload as object;
    expect(Object.keys(payload)).toEqual(['rung', 'winner']);
  });

  it('records a blitz tie-break the same way, and carries the score the scorer chose, en dash and all', () => {
    expect(tiebreakEvent(decided('blitz', 'second', '2–0'))).toEqual({
      type: 'boardgame.tiebreak',
      payload: { rung: 'blitz', winner: AWAY, score: '2–0' },
    });
    expect(tiebreakEvent(decided('blitz', 'first', '1½–½'))?.payload).toEqual({
      rung: 'blitz',
      winner: HOME,
      score: '1½–½',
    });
  });

  it('records an Armageddon as Black’s entrant and the result from White’s side, with no winner', () => {
    expect(tiebreakEvent(armageddon('first', 'white'))).toEqual({
      type: 'boardgame.tiebreak',
      payload: { rung: 'armageddon', black: HOME, result: 'white' },
    });
    expect(tiebreakEvent(armageddon('second', 'draw'))).toEqual({
      type: 'boardgame.tiebreak',
      payload: { rung: 'armageddon', black: AWAY, result: 'draw' },
    });
    expect(tiebreakEvent(armageddon('second', 'black'))?.payload).toEqual({
      rung: 'armageddon',
      black: AWAY,
      result: 'black',
    });
  });

  it('never names a winner for an Armageddon, whatever the result: the engine decides who advances', () => {
    for (const black of ['first', 'second'] as const) {
      for (const outcome of ['white', 'black', 'draw'] as const) {
        const payload = tiebreakEvent(armageddon(black, outcome))?.payload as object;
        expect(Object.keys(payload).sort(), `${black} ${outcome}`).toEqual([
          'black',
          'result',
          'rung',
        ]);
      }
    }
  });

  it('names the entrant of the seat chosen, not of the colour: the same event whoever holds White', () => {
    for (const tap of [decided('rapid', 'first', null), armageddon('second', 'draw')]) {
      expect(tiebreakEvent(tap, PENDING_FLIPPED)).toEqual(tiebreakEvent(tap, PENDING));
    }
  });

  it('builds the event on a stage that lists only that rung, and nothing for a rung it does not list', () => {
    const only = (...rungs: ('rapid' | 'blitz' | 'armageddon')[]) =>
      chessDisplay({ phase: 'tiebreak', tiebreak: pendingTiebreak(rungs) });
    expect(tiebreakEvent(decided('blitz', 'first', null), only('blitz'))).not.toBeNull();
    expect(tiebreakEvent(decided('rapid', 'first', null), only('blitz', 'armageddon'))).toBeNull();
    expect(tiebreakEvent(armageddon('first', 'draw'), only('rapid', 'blitz'))).toBeNull();
    expect(tiebreakEvent(armageddon('first', 'draw'), only('armageddon'))).not.toBeNull();
  });

  it('builds nothing where the stage lists no rung', () => {
    expect(tiebreakEvent(decided('rapid', 'first', null), chessDisplay())).toBeNull();
    expect(tiebreakEvent(armageddon('first', 'white'), chessDisplay())).toBeNull();
  });

  it('builds nothing while a seat has no entrant', () => {
    const bye = { ...GAME, sides: { home: GAME.sides.home, away: null } };
    for (const tap of [decided('rapid', 'first', null), armageddon('first', 'white')]) {
      expect(chessEventFor(tap, { bootstrap: bye, display: PENDING })).toBeNull();
    }
  });

  it('is sent as it was queued: a tie-break names its entrants and stamps nothing a later ledger could make stale', () => {
    const queued = queuedOf('tap-1', {
      type: 'boardgame.tiebreak',
      payload: { rung: 'armageddon', black: AWAY, result: 'draw' },
    });
    expect(chessPayloadForSend(queued, ledgerOf([start()]), false)).toEqual({
      rung: 'armageddon',
      black: AWAY,
      result: 'draw',
    });
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
