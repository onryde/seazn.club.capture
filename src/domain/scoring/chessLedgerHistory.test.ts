import type { EventEnvelope } from '@seazn/engine/core';
import { describe, expect, it } from 'vitest';
import { CHESS_FACTS, doneOf, doneOfTap, tapOfDone } from '@/domain/scoring/chessLedgerHistory';
import { namesOf } from '@/domain/scoring/setBasedSides';
import { AWAY, GAME, HOME } from '../../../test/chessLedger';

// What a chess event did, in the pad's words, read off one event on its own (the fold and History build on it).

const SIDES = GAME.sides;
if (SIDES.home === null || SIDES.away === null) throw new Error('the fixture has two sides');
const NAMES = namesOf({ first: SIDES.home, second: SIDES.away });

const envelope = (type: string, payload: unknown): EventEnvelope => ({
  id: 'ev-1',
  fixtureId: GAME.fixtureId,
  seq: 1,
  type,
  payload,
  recordedAt: '2026-11-04T10:00:01.000Z',
  recordedBy: null,
});

describe('doneOf', () => {
  it('reads the start', () => {
    expect(doneOf(envelope('core.start', {}), NAMES)).toEqual({ kind: 'start' });
  });

  it('reads a pairing that names White as a swap, and any other pairing card as nothing', () => {
    expect(doneOf(envelope('boardgame.pairing', { white: AWAY }), NAMES)).toEqual({
      kind: 'swap',
    });
    expect(doneOf(envelope('boardgame.pairing', { homePerson: 'p-sharma' }), NAMES)).toBeNull();
    expect(doneOf(envelope('boardgame.pairing', { board: 4 }), NAMES)).toBeNull();
  });

  it('reads a result by the seat its winner sits in, with its method', () => {
    expect(doneOf(envelope('boardgame.result', { winner: HOME }), NAMES)).toEqual({
      kind: 'result',
      winner: 'first',
      method: null,
    });
    expect(doneOf(envelope('boardgame.result', { winner: AWAY, method: 'resign' }), NAMES)).toEqual(
      { kind: 'result', winner: 'second', method: 'resign' },
    );
  });

  it('reads a result with a null winner, or none, as a draw', () => {
    expect(
      doneOf(envelope('boardgame.result', { winner: null, method: 'agreement' }), NAMES),
    ).toEqual({ kind: 'result', winner: null, method: 'agreement' });
    expect(doneOf(envelope('boardgame.result', { method: 'stalemate' }), NAMES)).toEqual({
      kind: 'result',
      winner: null,
      method: 'stalemate',
    });
  });

  it('reads no method from a forfeit written as a result: it is not a method the pad names', () => {
    expect(
      doneOf(envelope('boardgame.result', { winner: HOME, method: 'forfeit' }), NAMES),
    ).toEqual({ kind: 'result', winner: 'first', method: null });
  });

  it('has no words for a winner who is neither side, nor for the organiser’s events', () => {
    expect(doneOf(envelope('boardgame.result', { winner: 'ent-stranger' }), NAMES)).toBeNull();
    for (const type of ['core.forfeit', 'boardgame.tiebreak', 'core.finalize', 'core.void']) {
      expect(doneOf(envelope(type, {}), NAMES), type).toBeNull();
    }
  });
});

describe('tapOfDone and doneOfTap: a tap and what it did name the same seat', () => {
  it('turns what was done into the tap an Undo names, the start never', () => {
    expect(tapOfDone({ kind: 'start' })).toBeNull();
    expect(tapOfDone({ kind: 'swap' })).toEqual({ kind: 'swap' });
    expect(tapOfDone({ kind: 'result', winner: null, method: 'agreement' })).toEqual({
      kind: 'result',
      winner: null,
      method: 'agreement',
    });
    expect(tapOfDone({ kind: 'result', winner: 'first', method: null })).toEqual({
      kind: 'result',
      winner: 'first',
      method: null,
    });
    expect(tapOfDone({ kind: 'result', winner: 'second', method: 'resign' })).toEqual({
      kind: 'result',
      winner: 'second',
      method: 'resign',
    });
  });

  it('turns a tap back into what it did', () => {
    expect(doneOfTap({ kind: 'start' })).toEqual({ kind: 'start' });
    expect(doneOfTap({ kind: 'swap' })).toEqual({ kind: 'swap' });
    expect(doneOfTap({ kind: 'result', winner: null, method: null })).toEqual({
      kind: 'result',
      winner: null,
      method: null,
    });
    expect(doneOfTap({ kind: 'result', winner: 'second', method: 'time' })).toEqual({
      kind: 'result',
      winner: 'second',
      method: 'time',
    });
  });
});

describe('CHESS_FACTS: what chess tells the shared History rows of any event', () => {
  it('is one game with no points, nothing won in the set-based sense and no sanction', () => {
    expect(CHESS_FACTS).toEqual({
      game: 1,
      after: { first: 0, second: 0 },
      won: 'none',
      sanctionedPerson: null,
    });
  });
});
