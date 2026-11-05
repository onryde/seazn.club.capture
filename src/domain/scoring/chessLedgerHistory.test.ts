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
    for (const type of ['core.forfeit', 'core.settle', 'core.finalize', 'core.void']) {
      expect(doneOf(envelope(type, {}), NAMES), type).toBeNull();
    }
  });
});

// The tie-break (S2-3b): a rapid or blitz one is read by the seat its winner sits in, an Armageddon by the seat that had
// Black and its result; both are the same words a tap of that choice makes.
describe('doneOf: a tie-break', () => {
  const read = (payload: unknown) => doneOf(envelope('boardgame.tiebreak', payload), NAMES);

  it('reads a rapid or blitz tie-break by the seat of its winner, with its score or none', () => {
    expect(read({ rung: 'rapid', winner: HOME })).toEqual({
      kind: 'tiebreak',
      rung: 'rapid',
      winner: 'first',
      score: null,
    });
    expect(read({ rung: 'blitz', winner: AWAY, score: '2–0' })).toEqual({
      kind: 'tiebreak',
      rung: 'blitz',
      winner: 'second',
      score: '2–0',
    });
    expect(read({ rung: 'rapid', winner: HOME, score: '1½–½' })).toMatchObject({ score: '1½–½' });
  });

  it('reads a score the pad does not offer as none: the line never speaks it', () => {
    expect(read({ rung: 'rapid', winner: HOME, score: '3–1' })).toMatchObject({ score: null });
  });

  it('reads an Armageddon by the seat that had Black and the result, with no winner of its own', () => {
    expect(read({ rung: 'armageddon', black: AWAY, result: 'draw' })).toEqual({
      kind: 'tiebreak',
      rung: 'armageddon',
      black: 'second',
      result: 'draw',
    });
    expect(read({ rung: 'armageddon', black: HOME, result: 'white' })).toEqual({
      kind: 'tiebreak',
      rung: 'armageddon',
      black: 'first',
      result: 'white',
    });
    expect(read({ rung: 'armageddon', black: HOME, result: 'black' })).toMatchObject({
      result: 'black',
    });
  });

  it('has no words for a tie-break that names nobody on this game, or that is not one', () => {
    expect(read({})).toBeNull();
    expect(read({ rung: 'rapid', winner: 'ent-stranger' })).toBeNull();
    expect(read({ rung: 'rapid' })).toBeNull();
    expect(read({ rung: 'armageddon', black: 'ent-stranger', result: 'draw' })).toBeNull();
    expect(read({ rung: 'armageddon', result: 'draw' })).toBeNull();
    expect(read({ rung: 'armageddon', black: HOME, result: 'unknown' })).toBeNull();
    expect(read({ rung: 'armageddon', black: HOME })).toBeNull();
    expect(read({ rung: 'lots', winner: HOME })).toBeNull();
    // The fields of an Armageddon under a rung that is not one: the rung decides, not the shape of the rest.
    expect(read({ rung: 'lots', black: HOME, result: 'draw' })).toBeNull();
    expect(read(null)).toBeNull();
  });

  it('turns into the tap an Undo names, and back, naming the same seats', () => {
    const rapid = { kind: 'tiebreak', rung: 'rapid', winner: 'second', score: '2–0' } as const;
    const arma = { kind: 'tiebreak', rung: 'armageddon', black: 'first', result: 'draw' } as const;
    expect(tapOfDone(rapid)).toEqual(rapid);
    expect(tapOfDone(arma)).toEqual(arma);
    expect(doneOfTap(rapid)).toEqual(rapid);
    expect(doneOfTap(arma)).toEqual(arma);
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
