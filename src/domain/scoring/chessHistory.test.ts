import { describe, expect, it } from 'vitest';
import {
  chessHistory,
  doneSaid,
  undoneSaid,
  type ChessHistoryEntry,
} from '@/domain/scoring/chessHistory';
import type { ChessDone } from '@/domain/scoring/chessTypes';

// History (view only) for a chess game: one game, so one group, newest entry first, an entry Undo took back kept in its
// place. The words are the pad's dictionary keys with their fills; the spec's sentences are "Match started", "Colours
// swapped", "{name} won · {how}" and "Drawn · {how}". Every expected value is written out.

const NAMES = { first: 'A. Sharma', second: 'L. Chen' } as const;
const ZERO = { first: 0, second: 0 } as const;

function entry(did: ChessDone, over: Partial<ChessHistoryEntry> = {}): ChessHistoryEntry {
  return { did, game: 1, after: ZERO, own: true, undone: false, sending: false, ...over };
}

describe('doneSaid: what an event did, in the pad’s words', () => {
  it('says the match started', () => {
    expect(doneSaid(NAMES, { kind: 'start' })).toEqual({ key: 'scoring.chess.last.start' });
  });

  it('says the colours were swapped', () => {
    expect(doneSaid(NAMES, { kind: 'swap' })).toEqual({ key: 'scoring.chess.last.swap' });
  });

  it('says who won, by name, and how when a method was chosen', () => {
    expect(doneSaid(NAMES, { kind: 'result', winner: 'first', method: null })).toEqual({
      key: 'scoring.chess.last.won',
      vars: { name: 'A. Sharma' },
    });
    expect(doneSaid(NAMES, { kind: 'result', winner: 'second', method: 'checkmate' })).toEqual({
      key: 'scoring.chess.last.wonBy',
      vars: { name: 'L. Chen', how: { key: 'scoring.chess.method.checkmate' } },
    });
  });

  it('says a draw, and how when a method was chosen', () => {
    expect(doneSaid(NAMES, { kind: 'result', winner: null, method: null })).toEqual({
      key: 'scoring.chess.last.drawn',
    });
    expect(doneSaid(NAMES, { kind: 'result', winner: null, method: 'fifty_move' })).toEqual({
      key: 'scoring.chess.last.drawnBy',
      vars: { how: { key: 'scoring.chess.method.fifty_move' } },
    });
  });

  it('has a method word for each of the engine’s eleven, under its own name', () => {
    const methods = [
      'checkmate',
      'resign',
      'time',
      'adjudication',
      'illegal_move',
      'agreement',
      'stalemate',
      'insufficient',
      'repetition',
      'fifty_move',
      'dead_position',
    ] as const;
    const said = methods.map((method) => doneSaid(NAMES, { kind: 'result', winner: null, method }));
    expect(said.map((text) => (text.vars as { how: { key: string } }).how.key)).toEqual(
      methods.map((method) => `scoring.chess.method.${method}`),
    );
  });
});

describe('undoneSaid: an Undo as the tap it took back', () => {
  it('says the tap in its own words under the Undone line', () => {
    const tap = { kind: 'result', winner: null, method: 'agreement' } as const;
    expect(undoneSaid(NAMES, tap)).toEqual({
      key: 'scoring.chess.last.undone',
      vars: {
        what: {
          key: 'scoring.chess.last.drawnBy',
          vars: { how: { key: 'scoring.chess.method.agreement' } },
        },
      },
    });
  });

  it.each([
    ['first', 'A. Sharma'],
    ['second', 'L. Chen'],
  ] as const)(
    'names the winner of an undone win by the seat the tap named: %s is %s',
    (winner, name) => {
      expect(undoneSaid(NAMES, { kind: 'result', winner, method: null })).toEqual({
        key: 'scoring.chess.last.undone',
        vars: { what: { key: 'scoring.chess.last.won', vars: { name } } },
      });
    },
  );

  it('says an undone swap and start in their own words', () => {
    expect(undoneSaid(NAMES, { kind: 'swap' }).vars).toEqual({
      what: { key: 'scoring.chess.last.swap' },
    });
    expect(undoneSaid(NAMES, { kind: 'start' }).vars).toEqual({
      what: { key: 'scoring.chess.last.start' },
    });
  });
});

describe('chessHistory: the game’s sheet', () => {
  it('has no group while nothing is recorded', () => {
    expect(chessHistory([], NAMES)).toEqual([]);
  });

  it('is one group under the game’s heading, the newest entry first', () => {
    const groups = chessHistory(
      [
        entry({ kind: 'start' }),
        entry({ kind: 'swap' }),
        entry({ kind: 'result', winner: 'first', method: 'resign' }),
      ],
      NAMES,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toEqual({ key: 'scoring.chess.gameHeading' });
    expect(groups[0]?.rows.map((row) => row.said.key)).toEqual([
      'scoring.chess.last.wonBy',
      'scoring.chess.last.swap',
      'scoring.chess.last.start',
    ]);
  });

  it('shows no score on a row: chess has no points to count', () => {
    const rows = chessHistory([entry({ kind: 'start' })], NAMES)[0]?.rows ?? [];
    expect(rows.map((row) => row.score)).toEqual([null]);
  });

  it('keeps an entry Undo took back in its place, struck', () => {
    const rows =
      chessHistory(
        [
          entry({ kind: 'start' }),
          entry({ kind: 'result', winner: null, method: null }, { undone: true }),
        ],
        NAMES,
      )[0]?.rows ?? [];
    expect(rows.map((row) => [row.said.key, row.undone])).toEqual([
      ['scoring.chess.last.drawn', true],
      ['scoring.chess.last.start', false],
    ]);
  });

  it('says who recorded it, and which entry is still on its way to the server', () => {
    const rows =
      chessHistory(
        [
          entry({ kind: 'start' }, { own: false }),
          entry({ kind: 'result', winner: 'second', method: null }, { sending: true }),
        ],
        NAMES,
      )[0]?.rows ?? [];
    expect(rows.map((row) => [row.by, row.sending])).toEqual([
      ['thisPhone', true],
      ['otherScorer', false],
    ]);
  });
});
