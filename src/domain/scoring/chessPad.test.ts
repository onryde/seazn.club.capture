import { DECISIVE_METHODS, DRAWN_METHODS } from '@seazn/engine/sports/boardgame';
import { describe, expect, it } from 'vitest';
import {
  chessCardLine,
  chessMethodsFor,
  chessPad,
  chessResultLine,
} from '@/domain/scoring/chessPad';
import type { ChessDisplay } from '@/domain/scoring/chessTypes';
import { chessDisplay } from '../../../test/chessLedger';

// The Chess pad (spec §4, rulings 57 to 61; plan S2-3 Task 1): the two players are the halves, a tap on one records a
// result for that player; Draw and Swap colours are the tools; the tie-break's waiting line is the strip's note. Every
// expected value is written out. Words are dictionary keys here: the keys' text is Task 3's.

const SHARMA = 'A. Sharma';
const CHEN = 'L. Chen';

const OWN_WHITE_WIN = chessDisplay({
  phase: 'done',
  result: { outcome: 'white', method: 'checkmate', own: true },
  lastTap: { kind: 'result', winner: 'first', method: 'checkmate' },
  undoable: true,
});

describe('chessPad: the undone line names the player in the seat the tap named', () => {
  it.each([
    ['first', SHARMA],
    ['second', CHEN],
  ] as const)('an undone win by the %s player is %s’s, whoever holds White', (winner, name) => {
    for (const colorOfHome of ['W', 'B', null] as const) {
      const view = chessPad(
        chessDisplay({
          colorOfHome,
          lastTap: { kind: 'undone', tap: { kind: 'result', winner, method: null } },
        }),
      );
      expect(view.lastTap?.text, `${colorOfHome}`).toEqual({
        key: 'scoring.chess.last.undone',
        vars: { what: { key: 'scoring.chess.last.won', vars: { name } } },
      });
    }
  });
});

describe('chessPad: the halves are the players', () => {
  it('carries the names as typed, first on top, the first name’s seat never moved by a swap', () => {
    for (const colorOfHome of ['W', 'B', null] as const) {
      const [top, bottom] = chessPad(chessDisplay({ colorOfHome })).halves;
      expect([top.side, top.label, bottom.side, bottom.label]).toEqual([
        'first',
        SHARMA,
        'second',
        CHEN,
      ]);
    }
  });

  it('puts the words WHITE and BLACK on the plates, home holding White', () => {
    const [top, bottom] = chessPad(chessDisplay({ colorOfHome: 'W' })).halves;
    expect(top.plate).toEqual({ key: 'scoring.chess.chip.white' });
    expect(bottom.plate).toEqual({ key: 'scoring.chess.chip.black' });
  });

  it('moves the plates and not the names after a swap', () => {
    const [top, bottom] = chessPad(chessDisplay({ colorOfHome: 'B' })).halves;
    expect(top.label).toBe(SHARMA);
    expect(top.plate).toEqual({ key: 'scoring.chess.chip.black' });
    expect(bottom.label).toBe(CHEN);
    expect(bottom.plate).toEqual({ key: 'scoring.chess.chip.white' });
  });

  it('draws no plate words in a division without colours', () => {
    const [top, bottom] = chessPad(chessDisplay({ colorOfHome: null })).halves;
    expect(top.plate).toBeNull();
    expect(bottom.plate).toBeNull();
  });

  // The plate is a colour, not a serve: chess claims no server, and the kit's serving plate is lime and says who serves.
  it('claims no server: the serving plate is never used', () => {
    for (const colorOfHome of ['W', 'B', null] as const) {
      for (const half of chessPad(chessDisplay({ colorOfHome })).halves) {
        expect(half.serving).toBeNull();
      }
    }
  });

  it('keeps the plates once the game is over, as a scoresheet keeps the colours', () => {
    for (const phase of ['live', 'tiebreak', 'done', 'final'] as const) {
      const plates = chessPad(chessDisplay({ phase, colorOfHome: 'B' })).halves.map(
        (half) => half.plate,
      );
      expect(plates, phase).toEqual([
        { key: 'scoring.chess.chip.black' },
        { key: 'scoring.chess.chip.white' },
      ]);
    }
  });

  it('lights the bar of the side holding White, and neither without colours', () => {
    expect(chessPad(chessDisplay({ colorOfHome: 'W' })).halves.map((half) => half.bar)).toEqual([
      'lit',
      'dim',
    ]);
    expect(chessPad(chessDisplay({ colorOfHome: 'B' })).halves.map((half) => half.bar)).toEqual([
      'dim',
      'lit',
    ]);
    expect(chessPad(chessDisplay({ colorOfHome: null })).halves.map((half) => half.bar)).toEqual([
      'dim',
      'dim',
    ]);
  });

  it('labels the tap with what it records: White won, Black won, or just the name without colours', () => {
    const actions = (colorOfHome: ChessDisplay['colorOfHome']) =>
      chessPad(chessDisplay({ colorOfHome })).halves.map((half) => half.action);
    expect(actions('W')).toEqual([
      { key: 'scoring.chess.result.white', vars: { name: SHARMA } },
      { key: 'scoring.chess.result.black', vars: { name: CHEN } },
    ]);
    expect(actions('B')).toEqual([
      { key: 'scoring.chess.result.black', vars: { name: SHARMA } },
      { key: 'scoring.chess.result.white', vars: { name: CHEN } },
    ]);
    expect(actions(null)).toEqual([
      { key: 'scoring.chess.result.plain', vars: { name: SHARMA } },
      { key: 'scoring.chess.result.plain', vars: { name: CHEN } },
    ]);
  });

  it('keeps the hint a screen reader’s sentence of what a tap does, naming the player and no colour', () => {
    for (const colorOfHome of ['W', 'B', null] as const) {
      expect(
        chessPad(chessDisplay({ colorOfHome })).halves.map((half) => half.hint),
        `${colorOfHome}`,
      ).toEqual([
        { key: 'scoring.chess.hint', vars: { name: SHARMA } },
        { key: 'scoring.chess.hint', vars: { name: CHEN } },
      ]);
    }
  });

  it('takes a tap while the game is live and at no other time', () => {
    const tappable = (phase: ChessDisplay['phase']) =>
      chessPad(chessDisplay({ phase })).halves.map((half) => half.tappable);
    expect(tappable('live')).toEqual([true, true]);
    for (const phase of ['notStarted', 'tiebreak', 'done', 'final'] as const) {
      expect(tappable(phase), phase).toEqual([false, false]);
    }
  });

  it('shows no finished games, no server words and no marks: chess has none', () => {
    for (const half of chessPad(chessDisplay()).halves) {
      expect(half.periods).toBeNull();
      expect(half.sub).toBeNull();
      expect(half.marks).toEqual({ clock: false, cards: [], said: [] });
    }
  });

  it('shows a point under each name only once a result stands: 1, ½ or 0', () => {
    const values = (display: ChessDisplay) => chessPad(display).halves.map((half) => half.value);
    expect(values(chessDisplay())).toEqual(['', '']);
    const decided = (colorOfHome: 'W' | 'B' | null, outcome: 'white' | 'draw' | 'black') =>
      chessDisplay({
        phase: 'done',
        colorOfHome,
        result: { outcome, method: null, own: false },
      });
    expect(values(decided('W', 'white'))).toEqual(['1', '0']);
    expect(values(decided('W', 'black'))).toEqual(['0', '1']);
    expect(values(decided('W', 'draw'))).toEqual(['½', '½']);
    expect(values(decided('B', 'white'))).toEqual(['0', '1']);
    expect(values(decided('B', 'black'))).toEqual(['1', '0']);
    expect(values(decided(null, 'white'))).toEqual(['1', '0']);
  });
});

describe('chessPad: the tools are Draw and Swap colours', () => {
  const tools = (display: ChessDisplay) =>
    chessPad(display).tools.map((tool) => [tool.id, tool.label, tool.enabled, tool.kind]);

  it('offers Draw and Swap on a live game with colours', () => {
    expect(tools(chessDisplay())).toEqual([
      ['draw', { key: 'scoring.chess.tool.draw' }, true, 'standard'],
      ['swap', { key: 'scoring.chess.tool.swap' }, true, 'standard'],
    ]);
  });

  it('offers no Swap in a division without colours: there is nothing to swap', () => {
    expect(tools(chessDisplay({ colorOfHome: null })).map(([id]) => id)).toEqual(['draw']);
  });

  it('offers neither before the start, while the tie-break waits, nor after the result', () => {
    for (const phase of ['notStarted', 'tiebreak', 'done', 'final'] as const) {
      expect(chessPad(chessDisplay({ phase })).tools, phase).toEqual([]);
    }
  });
});

describe('chessPad: before the start', () => {
  const view = chessPad(chessDisplay({ phase: 'notStarted' }));

  it('asks to start, with the two names as typed and no side to pick (chess has no serve)', () => {
    expect(view.start).toEqual({
      ask: { key: 'scoring.chess.start.ask' },
      needsToss: false,
      sides: [
        { side: 'first', label: SHARMA, plate: { key: 'scoring.chess.chip.white' } },
        { side: 'second', label: CHEN, plate: { key: 'scoring.chess.chip.black' } },
      ],
    });
  });

  it('puts each name’s colour plate on the Start screen, following a pairing', () => {
    const swapped = chessPad(chessDisplay({ phase: 'notStarted', colorOfHome: 'B' })).start;
    expect(swapped?.sides.map((side) => side.plate)).toEqual([
      { key: 'scoring.chess.chip.black' },
      { key: 'scoring.chess.chip.white' },
    ]);
  });

  it('puts no plate on the Start screen in a division without colours', () => {
    const plain = chessPad(chessDisplay({ phase: 'notStarted', colorOfHome: null })).start;
    expect(plain?.sides.map((side) => side.plate ?? null)).toEqual([null, null]);
  });

  it('is no Start screen once the game is under way', () => {
    expect(chessPad(chessDisplay({ phase: 'live' })).start).toBeNull();
  });
});

describe('chessPad: the tie-break', () => {
  const view = chessPad(
    chessDisplay({
      phase: 'tiebreak',
      lastTap: { kind: 'result', winner: null, method: 'agreement' },
      undoable: true,
    }),
  );

  it('says the organiser records it, in the strip’s note, and offers no result', () => {
    expect(view.strip).toEqual([{ slot: 'note', text: { key: 'scoring.chess.waiting.tiebreak' } }]);
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
    expect(view.tools).toEqual([]);
    expect(view.card).toBeNull();
  });

  it('still lets this phone take its own draw back', () => {
    expect(view.lastTap?.undo).toBe(true);
  });
});

describe('chessPad: the strip', () => {
  it('has its one slot empty while nothing waits, so the strip never shifts', () => {
    expect(chessPad(chessDisplay()).strip).toEqual([{ slot: 'note', text: null }]);
    expect(chessPad(OWN_WHITE_WIN).strip).toEqual([{ slot: 'note', text: null }]);
  });
});

describe('chessPad: a result stands', () => {
  it('shows the recorded-result card over the players, and Undo for this phone’s own result', () => {
    const view = chessPad(OWN_WHITE_WIN);
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(view.lastTap).toEqual({
      text: {
        key: 'scoring.chess.last.wonBy',
        vars: { name: SHARMA, how: { key: 'scoring.chess.method.checkmate' } },
      },
      undo: true,
    });
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
    expect(view.tools).toEqual([]);
  });

  it('hides Undo for a result another scorer recorded', () => {
    const view = chessPad({
      ...OWN_WHITE_WIN,
      undoable: false,
      result: { outcome: 'white', method: 'checkmate', own: false },
    });
    expect(view.lastTap?.undo).toBe(false);
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
  });

  it('hides Undo once the organiser has finalised', () => {
    const view = chessPad({ ...OWN_WHITE_WIN, phase: 'final', undoable: false });
    expect(view.lastTap?.undo).toBe(false);
  });

  it('says a draw and the line of an undone result', () => {
    const drawn = chessPad(
      chessDisplay({
        phase: 'done',
        result: { outcome: 'draw', method: null, own: true },
        lastTap: { kind: 'result', winner: null, method: null },
        undoable: true,
      }),
    );
    expect(drawn.lastTap?.text).toEqual({ key: 'scoring.chess.last.drawn' });
    const undone = chessPad(
      chessDisplay({
        lastTap: { kind: 'undone', tap: { kind: 'result', winner: 'second', method: 'resign' } },
      }),
    );
    expect(undone.lastTap).toEqual({
      text: {
        key: 'scoring.chess.last.undone',
        vars: {
          what: {
            key: 'scoring.chess.last.wonBy',
            vars: { name: CHEN, how: { key: 'scoring.chess.method.resign' } },
          },
        },
      },
      undo: false,
    });
  });

  it('says nothing in the last-tap line while nothing was recorded', () => {
    expect(chessPad(chessDisplay({ lastTap: null })).lastTap).toBeNull();
  });
});

describe('chessPad: the header and the rest of the view', () => {
  it('shows the result line as the tally once a result stands, and nothing before', () => {
    expect(chessPad(chessDisplay()).tally.shown).toBe('');
    expect(chessPad(OWN_WHITE_WIN).tally.shown).toBe('1–0');
  });

  it('says the points to a screen reader with the names', () => {
    expect(chessPad(OWN_WHITE_WIN).tally.said).toEqual({
      key: 'scoring.chess.tallySaid',
      vars: { first: SHARMA, firstPoints: '1', second: CHEN, secondPoints: '0' },
    });
  });

  it('carries the match context into the details, with no rules table', () => {
    const display = chessDisplay();
    expect(chessPad(display).details).toEqual({ context: display.context, rules: [] });
  });

  it('passes the transport’s word through, and is synced by default', () => {
    expect(chessPad(chessDisplay()).sync).toEqual({ kind: 'synced' });
    expect(chessPad(chessDisplay(), { kind: 'offline', count: 2 }).sync).toEqual({
      kind: 'offline',
      count: 2,
    });
  });
});

describe('chessResultLine: the pad’s own line, in chess notation', () => {
  const lineOf = (result: ChessDisplay['result']) => chessResultLine(chessDisplay({ result }));

  it('is 1–0, ½–½ or 0–1, White’s score first, with an en dash', () => {
    expect(lineOf({ outcome: 'white', method: null, own: false })).toBe('1–0');
    expect(lineOf({ outcome: 'draw', method: null, own: false })).toBe('½–½');
    expect(lineOf({ outcome: 'black', method: null, own: false })).toBe('0–1');
  });

  it('is empty while the game is live, and while the tie-break waits', () => {
    expect(lineOf(null)).toBe('');
  });

  it('does not change with the method', () => {
    expect(lineOf({ outcome: 'white', method: 'resign', own: true })).toBe('1–0');
  });

  it('stays White’s score first when home holds Black: the pad’s tally reads like a scoresheet', () => {
    const tally = (colorOfHome: 'W' | 'B', outcome: 'white' | 'black') =>
      chessPad(
        chessDisplay({
          phase: 'done',
          colorOfHome,
          result: { outcome, method: null, own: false },
        }),
      ).tally.shown;
    expect(tally('B', 'white')).toBe('1–0');
    expect(tally('B', 'black')).toBe('0–1');
  });
});

describe('chessCardLine: Home’s card, the first side’s score first', () => {
  const cardLine = (
    colorOfHome: ChessDisplay['colorOfHome'],
    outcome: 'white' | 'draw' | 'black',
  ) =>
    chessCardLine(
      chessDisplay({ phase: 'done', colorOfHome, result: { outcome, method: null, own: false } }),
    );

  it('is the first side’s point and then the second’s, with home holding White', () => {
    expect(cardLine('W', 'white')).toBe('1–0');
    expect(cardLine('W', 'black')).toBe('0–1');
    expect(cardLine('W', 'draw')).toBe('½–½');
  });

  it('turns over with the colours: with home holding Black, Black’s win is the first side’s', () => {
    expect(cardLine('B', 'white')).toBe('0–1');
    expect(cardLine('B', 'black')).toBe('1–0');
    expect(cardLine('B', 'draw')).toBe('½–½');
  });

  it('is White-first with no colours: the first name stands for White', () => {
    expect(cardLine(null, 'white')).toBe('1–0');
    expect(cardLine(null, 'black')).toBe('0–1');
  });

  it('is empty while no result stands', () => {
    expect(chessCardLine(chessDisplay())).toBe('');
    expect(chessCardLine(chessDisplay({ phase: 'tiebreak' }))).toBe('');
  });
});

describe('chessMethodsFor', () => {
  it('is the engine’s decisive list for either player’s win, in its order', () => {
    const decisive = ['checkmate', 'resign', 'time', 'adjudication', 'illegal_move'];
    expect(chessMethodsFor('first')).toEqual(decisive);
    expect(chessMethodsFor('second')).toEqual(decisive);
    expect(chessMethodsFor('first')).toEqual([...DECISIVE_METHODS]);
  });

  it('is the engine’s drawn list for a draw, in its order', () => {
    const drawn = [
      'agreement',
      'stalemate',
      'insufficient',
      'adjudication',
      'repetition',
      'fifty_move',
      'dead_position',
    ];
    expect(chessMethodsFor(null)).toEqual(drawn);
    expect(chessMethodsFor(null)).toEqual([...DRAWN_METHODS]);
  });

  it('never lists a forfeit: the web refuses it from a device link', () => {
    for (const winner of ['first', 'second', null] as const) {
      expect(chessMethodsFor(winner)).not.toContain('forfeit');
      expect(chessMethodsFor(winner)).not.toContain('double_forfeit');
    }
  });
});
