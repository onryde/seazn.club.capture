import { foldMatch, type EventEnvelope } from '@seazn/engine/core';
import {
  setBasedServeContext,
  tabletennis,
  type SetBasedServeContext,
  type SetBasedState,
} from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import {
  boardOf,
  lastRallyGame,
  lastTapOf,
  openGameOf,
  phaseOf,
  pickedServer,
  resultLineOf,
  serverOf,
  wonGames,
  ZERO,
} from '@/domain/scoring/setBasedBoard';
import { envelopeOf, lineupOf, setBasedCfgOf } from '@/domain/scoring/setBasedEngine';
import type { EventFacts, Recorded } from '@/domain/scoring/setBasedLedgerHistory';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import {
  DECIDED_3_0,
  GAME_ONE_11_7,
  SINGLES,
  anchored,
  ledgerOf,
  rally,
  start,
  summary,
  voiding,
  wholeGame,
  type Spec,
} from '../../../test/tableTennisLedger';

// What the set-based sports read off a folded state to draw the board (lifted from badminton's fold, plan S2-2 fix round
// 1). The states are the engine's own fold of a table tennis ledger (11 points a game, best of 5); the expected boards are
// written out from the rules of the game, not from the code under test.

const seats = seatsOf(SINGLES)!;
const cfg = setBasedCfgOf(tabletennis, {})!;
const lineups = { home: lineupOf(seats.first), away: lineupOf(seats.second) };

function envelopesOf(specs: readonly Spec[]): EventEnvelope[] {
  return ledgerOf(specs).map((event) => envelopeOf(SINGLES.fixtureId, event));
}

const stateOf = (specs: readonly Spec[]): SetBasedState =>
  foldMatch(tabletennis, cfg, lineups, envelopesOf(specs));

describe('boardOf', () => {
  it('is nothing played, game 1, before the first point', () => {
    expect(boardOf(stateOf([start()]))).toEqual({ points: ZERO, finished: [], game: 1 });
  });

  it('is the game under way and no game over yet', () => {
    expect(boardOf(stateOf(anchored('H', 'AH')))).toEqual({
      points: { first: 2, second: 1 },
      finished: [],
      game: 1,
    });
  });

  it('boxes a game over with its winner and starts the next at nothing', () => {
    expect(boardOf(stateOf(GAME_ONE_11_7))).toEqual({
      points: ZERO,
      finished: [{ points: { first: 11, second: 7 }, winner: 'first' }],
      game: 2,
    });
  });

  it('boxes a game the other side won with that side as the winner', () => {
    const board = boardOf(stateOf([start(), wholeGame(4, 11)]));
    expect(board.finished).toEqual([{ points: { first: 4, second: 11 }, winner: 'second' }]);
  });

  it('keeps the last game’s points up once the match is decided', () => {
    const board = boardOf(stateOf(DECIDED_3_0));
    expect(board.points).toEqual({ first: 11, second: 0 });
    expect(board.game).toBe(3);
    expect(board.finished).toHaveLength(3);
  });

  it('is nothing at all before the match starts', () => {
    expect(boardOf(stateOf([]))).toEqual({ points: ZERO, finished: [], game: 1 });
  });
});

describe('wonGames and openGameOf', () => {
  it('list the games over in order and the game under way, apart', () => {
    const state = stateOf([...GAME_ONE_11_7, ...anchored('A', 'H').slice(1)]);
    expect(wonGames(state).map((game) => game.points)).toEqual([{ first: 11, second: 7 }]);
    expect(openGameOf(state)).toMatchObject({ home: 1, away: 1 });
  });

  it('find no game under way between games or before the first', () => {
    expect(openGameOf(stateOf(GAME_ONE_11_7))).toBeUndefined();
    expect(openGameOf(stateOf([start()]))).toBeUndefined();
  });
});

describe('phaseOf', () => {
  it.each([
    ['not started', [] as Spec[], 1, 0, 'notStarted'],
    ['started, before the first point', [start()], 1, 0, 'pre'],
    ['a game under way', anchored('H', 'A'), 1, 1, 'live'],
    ['a game won, the next not begun', GAME_ONE_11_7, 2, 1, 'betweenGames'],
    ['the match decided', DECIDED_3_0, 3, 3, 'decided'],
  ])('%s', (_, specs, game, rallyGame, phase) => {
    expect(phaseOf(stateOf(specs), game, rallyGame)).toBe(phase);
  });

  it('is the match’s start again, not between games, when game 1 was only set', () => {
    expect(phaseOf(stateOf([start(), summary(5, 3)]), 1, 0)).toBe('pre');
  });
});

describe('lastRallyGame', () => {
  const envelopes = envelopesOf(GAME_ONE_11_7);
  const factsOf = (game: number): EventFacts => ({
    game,
    after: ZERO,
    won: 'none',
    sanctionedPerson: null,
  });

  it('is the game of the last rally standing, and 0 before any', () => {
    const facts = new Map(envelopes.map((envelope) => [envelope.id, factsOf(2)]));
    expect(lastRallyGame(envelopes, facts, 'tabletennis.rally')).toBe(2);
    expect(lastRallyGame(envelopes.slice(0, 1), facts, 'tabletennis.rally')).toBe(0);
    expect(lastRallyGame([], facts, 'tabletennis.rally')).toBe(0);
  });

  it('counts only the sport’s own rally, and only one the fold kept', () => {
    const facts = new Map([[envelopes[2]!.id, factsOf(1)]]);
    expect(lastRallyGame(envelopes, facts, 'badminton.rally')).toBe(0);
    expect(lastRallyGame(envelopes, facts, 'tabletennis.rally')).toBe(1);
  });
});

describe('serverOf', () => {
  const named = (side: 'home' | 'away' | null): SetBasedServeContext => ({
    servingSide: side === null ? null : `ent-${side}`,
    side,
    serverPersonId: null,
    serveOrderKnown: side !== null,
  });

  it('is the engine’s server, top side for home, whoever this phone picked', () => {
    expect(serverOf(named('home'), 'second')).toBe('first');
    expect(serverOf(named('away'), 'first')).toBe('second');
  });

  it('is this phone’s pick when the engine names nobody, and nobody with no pick', () => {
    expect(serverOf(named(null), 'second')).toBe('second');
    expect(serverOf(named(null), null)).toBeNull();
  });
});

describe('pickedServer', () => {
  const pickFor = (specs: readonly Spec[], toss: PadSide | null) => {
    const state = stateOf(specs);
    return pickedServer(state, setBasedServeContext(tabletennis, state, envelopesOf(specs)), toss);
  };

  it('is the pick at a started 0–0 nobody has named a server of', () => {
    expect(pickFor([start()], 'second')).toBe('second');
    expect(pickFor([start()], null)).toBeNull();
  });

  it('is nobody before the start, or once the match is over', () => {
    expect(pickFor([], 'first')).toBeNull();
    expect(pickFor(DECIDED_3_0, 'first')).toBeNull();
  });

  it('is nobody once a point stands, or once a game was set whole, though the engine still knows no server', () => {
    expect(pickFor([start(), rally({ wonBy: 'H' })], 'first')).toBeNull();
    expect(pickFor([start(), wholeGame(11, 7)], 'first')).toBeNull();
  });

  it('is the pick again when the only point was undone', () => {
    expect(pickFor([start(), rally({ wonBy: 'H' }), voiding(2)], 'second')).toBe('second');
  });

  it('is nobody when a point has named the server: the ledger speaks, not the pick', () => {
    expect(pickFor(anchored('H', ''), 'second')).toBeNull();
  });
});

describe('lastTapOf', () => {
  type Did = { readonly kind: 'start' | 'point' };
  const recordedOf = (...ids: readonly [string, Did['kind']][]) =>
    new Map<string, Recorded<Did>>(
      ids.map(([id, kind]) => [
        id,
        { did: { kind }, facts: { game: 1, after: ZERO, won: 'none', sanctionedPerson: null } },
      ]),
    );
  const undoneTap = (did: Did) => (did.kind === 'start' ? null : did);
  const envelopes = envelopesOf([start(), rally({ wonBy: 'H', serving: 'H' }), voiding(2)]);

  it('is the latest event the pad has words for', () => {
    const recorded = recordedOf(['ev-1', 'start'], ['ev-2', 'point']);
    expect(lastTapOf(envelopes.slice(0, 2), recorded, undoneTap)).toEqual({ kind: 'point' });
  });

  it('is the tap a void took back, said as undone', () => {
    const recorded = recordedOf(['ev-1', 'start'], ['ev-2', 'point']);
    expect(lastTapOf(envelopes, recorded, undoneTap)).toEqual({
      kind: 'undone',
      tap: { kind: 'point' },
    });
  });

  it('is no line when the tap taken back was the start, which returns to the Start screen', () => {
    const recorded = recordedOf(['ev-1', 'start']);
    const voidedStart = envelopesOf([start(), voiding(1)]);
    expect(lastTapOf(voidedStart, recorded, undoneTap)).toBeNull();
  });

  it('skips events with no words and is null with nothing recorded', () => {
    expect(lastTapOf(envelopes, recordedOf(['ev-1', 'start']), undoneTap)).toEqual({
      kind: 'start',
    });
    expect(lastTapOf(envelopes, recordedOf(), undoneTap)).toBeNull();
    expect(lastTapOf([], recordedOf(['ev-1', 'start']), undoneTap)).toBeNull();
  });
});

describe('resultLineOf: the games over as one line (Home’s Finished card)', () => {
  const game = (first: number, second: number) => ({
    points: { first, second },
    winner: first > second ? ('first' as const) : ('second' as const),
  });

  it('is empty while no game is over', () => {
    expect(resultLineOf([])).toBe('');
  });

  it('writes each game top side first with an en dash, joined by a comma and a space', () => {
    expect(resultLineOf([game(11, 7)])).toBe('11–7');
    expect(resultLineOf([game(11, 7), game(11, 9), game(5, 11)])).toBe('11–7, 11–9, 5–11');
  });

  it('keeps the top side first when the bottom side won the game', () => {
    expect(resultLineOf([game(4, 11)])).toBe('4–11');
  });
});
