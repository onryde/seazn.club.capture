import { DECISIVE_METHODS, DRAWN_METHODS } from '@seazn/engine/sports/boardgame';
import { describe, expect, it } from 'vitest';
import {
  chessCardLine,
  chessMethodsFor,
  chessPad,
  chessResultLine,
  chessTakesResult,
} from '@/domain/scoring/chessPad';
import type { ChessDisplay, ChessLastTap } from '@/domain/scoring/chessTypes';
import { NO_TIEBREAK, chessDisplay, pendingTiebreak } from '../../../test/chessLedger';

// The Chess pad (spec §4, rulings 57 to 61; plan S2-3 Task 1): the two players are the halves, a tap on one records a
// result for that player; Draw and Swap colours are the tools; the tie-break's waiting line is the strip's note. Every
// expected value is written out. Words are dictionary keys here: the keys' text is Task 3's.

const SHARMA = 'A. Sharma';
const CHEN = 'L. Chen';

const OWN_WHITE_WIN = chessDisplay({
  phase: 'done',
  result: { outcome: 'white', method: 'checkmate' },
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
        result: { outcome, method: null },
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

describe('chessPad: a tie-break is owed', () => {
  const DRAWN_TAP: ChessLastTap = { kind: 'result', winner: null, method: 'agreement' };
  const owed = (rungs?: Parameters<typeof pendingTiebreak>[0]) =>
    chessPad(
      chessDisplay({
        phase: 'tiebreak',
        tiebreak: pendingTiebreak(rungs),
        lastTap: DRAWN_TAP,
        undoable: true,
      }),
    );

  // The web's pad hides the result buttons while a tie-break is owed and shows the tie-break panel instead (S2-3b §3).
  it('offers one Tie-break tool in place of Draw and Swap colours, and no result', () => {
    const view = owed();
    expect(view.tools).toEqual([
      {
        id: 'tiebreak',
        label: { key: 'scoring.chess.tiebreak.tool' },
        detail: null,
        kind: 'primary',
        enabled: true,
      },
    ]);
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it('offers the same tool for a stage that lists one rung, two or three: the sheet chooses', () => {
    for (const rungs of [
      ['blitz'],
      ['armageddon', 'rapid'],
      ['rapid', 'blitz', 'armageddon'],
    ] as const) {
      expect(
        owed(rungs).tools.map((tool) => tool.id),
        rungs.join(),
      ).toEqual(['tiebreak']);
    }
  });

  it('says nothing in the strip: the tool replaces the waiting line', () => {
    expect(owed().strip).toEqual([{ slot: 'note', text: null }]);
  });

  it('shows no card, and still lets this phone take its own draw back', () => {
    const view = owed();
    expect(view.card).toBeNull();
    expect(view.lastTap?.undo).toBe(true);
  });

  it('offers the tool only while a tie-break is owed: not live, drawn in a table, decided or locked', () => {
    for (const phase of ['notStarted', 'live', 'done', 'final'] as const) {
      const tools = chessPad(chessDisplay({ phase })).tools.map((tool) => tool.id);
      expect(tools, phase).not.toContain('tiebreak');
    }
  });

  it('keeps Draw and Swap colours while the game is live, in a bracket stage too', () => {
    const live = chessPad(
      chessDisplay({ phase: 'live', tiebreak: { ...NO_TIEBREAK, rungs: ['rapid'] } }),
    );
    expect(live.tools.map((tool) => tool.id)).toEqual(['draw', 'swap']);
  });
});

// A stage that lists no rung plays no tie-break game: the drawn game is held for the organiser (ruling 79). The engine folds
// it as a done draw, so the S2-3 line says who is to act, and no tool is offered.
describe('chessPad: a drawn game the organiser holds', () => {
  const view = chessPad(
    chessDisplay({
      phase: 'done',
      result: { outcome: 'draw', method: 'agreement' },
      lastTap: { kind: 'result', winner: null, method: 'agreement' },
      undoable: true,
      tiebreak: { ...NO_TIEBREAK, held: true },
    }),
  );

  it('says the organiser decides, in the strip’s note, and offers no tool', () => {
    expect(view.strip).toEqual([{ slot: 'note', text: { key: 'scoring.chess.waiting.tiebreak' } }]);
    expect(view.tools).toEqual([]);
  });

  it('still shows the recorded draw as the result, with the card and the Undo', () => {
    expect(view.tally.shown).toBe('½');
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(view.lastTap?.undo).toBe(true);
  });
});

describe('chessPad: a tie-break decided it', () => {
  const decided = (rung: 'rapid' | 'blitz' | 'armageddon', advances: 'first' | 'second') =>
    chessPad(
      chessDisplay({
        phase: 'done',
        result: { outcome: 'draw', method: 'agreement' },
        tiebreak: {
          ...NO_TIEBREAK,
          rungs: ['rapid', 'blitz', 'armageddon'],
          decided: { rung, advances },
        },
      }),
    );

  it('names the player who advances and the rung in the strip, in the line’s own words', () => {
    expect(decided('rapid', 'second').strip).toEqual([
      {
        slot: 'note',
        text: {
          key: 'scoring.chess.tiebreak.advances',
          vars: { name: CHEN, how: { key: 'scoring.chess.tiebreak.rung.rapid' } },
        },
      },
    ]);
    expect(decided('blitz', 'first').strip[0]?.text).toEqual({
      key: 'scoring.chess.tiebreak.advances',
      vars: { name: SHARMA, how: { key: 'scoring.chess.tiebreak.rung.blitz' } },
    });
    expect(decided('armageddon', 'second').strip[0]?.text).toEqual({
      key: 'scoring.chess.tiebreak.advances',
      vars: { name: CHEN, how: { key: 'scoring.chess.tiebreak.rung.armageddon' } },
    });
  });

  it('keeps the header level: the game was drawn, the tie-break only says who goes through', () => {
    const view = decided('rapid', 'second');
    expect(view.tally.shown).toBe('½');
    expect(view.halves.map((half) => half.value)).toEqual(['½', '½']);
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(view.tools).toEqual([]);
  });

  // Home's card line is numbers and punctuation (`ScoringSport.resultLine`, never translated): the game's score stays the
  // game's, "½–½", and the words of who advances are the pad's.
  it('leaves Home’s card line at the game’s score', () => {
    const display = chessDisplay({
      phase: 'done',
      result: { outcome: 'draw', method: null },
      tiebreak: { ...NO_TIEBREAK, decided: { rung: 'rapid', advances: 'first' } },
    });
    expect(chessCardLine(display)).toBe('½–½');
  });

  it('says a settle by lot, which leaves no decided tie-break, as the drawn game', () => {
    const view = chessPad(
      chessDisplay({
        phase: 'done',
        result: { outcome: 'draw', method: null },
        tiebreak: NO_TIEBREAK,
      }),
    );
    expect(view.strip).toEqual([{ slot: 'note', text: { key: 'scoring.chess.last.drawn' } }]);
  });
});

describe('chessPad: the last tap names a tie-break', () => {
  const lastTapOf = (lastTap: ChessLastTap, over: Partial<ChessDisplay> = {}) =>
    chessPad(
      chessDisplay({
        phase: 'done',
        result: { outcome: 'draw', method: 'agreement' },
        lastTap,
        undoable: true,
        ...over,
      }),
    ).lastTap;
  const advances = (name: string, rung: string) => ({
    key: 'scoring.chess.tiebreak.advances',
    vars: { name, how: { key: `scoring.chess.tiebreak.rung.${rung}` } },
  });

  it('says who advances and by which rung, for a rapid or blitz winner’s seat', () => {
    expect(lastTapOf({ kind: 'tiebreak', rung: 'rapid', winner: 'second', score: null })).toEqual({
      text: advances(CHEN, 'rapid'),
      undo: true,
    });
    expect(
      lastTapOf({ kind: 'tiebreak', rung: 'blitz', winner: 'first', score: '2–0' })?.text,
    ).toEqual(advances(SHARMA, 'blitz'));
  });

  // BG-KO-2: White won, the other advances; Black won or a drawn Armageddon, Black advances. The line names the player.
  it.each([
    ['first', 'white', CHEN],
    ['first', 'black', SHARMA],
    ['first', 'draw', SHARMA],
    ['second', 'white', SHARMA],
    ['second', 'black', CHEN],
    ['second', 'draw', CHEN],
  ] as const)(
    'says the player who advances from an Armageddon with %s on Black, result %s: %s',
    (black, outcome, name) => {
      const tap = { kind: 'tiebreak', rung: 'armageddon', black, result: outcome } as const;
      expect(lastTapOf(tap)?.text).toEqual(advances(name, 'armageddon'));
    },
  );

  it('says it the same whoever holds White', () => {
    const tap = { kind: 'tiebreak', rung: 'armageddon', black: 'first', result: 'white' } as const;
    for (const colorOfHome of ['W', 'B', null] as const) {
      expect(lastTapOf(tap, { colorOfHome })?.text, `${colorOfHome}`).toEqual(
        advances(CHEN, 'armageddon'),
      );
    }
  });

  it('says an undone tie-break as the tap, and offers no second Undo', () => {
    const tap = { kind: 'tiebreak', rung: 'rapid', winner: 'first', score: null } as const;
    expect(lastTapOf({ kind: 'undone', tap })).toEqual({
      text: { key: 'scoring.chess.last.undone', vars: { what: advances(SHARMA, 'rapid') } },
      undo: false,
    });
  });
});

describe('chessPad: the strip', () => {
  const note = (display: ChessDisplay) => chessPad(display).strip;

  // Task 3, ruling 7: the pad says in one line that a forfeit is the organiser's. The web refuses one from a device link.
  it('says a forfeit is the organiser’s to record, before the start and while the game is live', () => {
    const says = [{ slot: 'note', text: { key: 'scoring.chess.forfeit' } }];
    expect(note(chessDisplay())).toEqual(says);
    expect(note(chessDisplay({ phase: 'notStarted' }))).toEqual(says);
  });

  // Task 3, ruling 7: an organiser's walkover leaves the last-tap line without a name, so the strip names who won,
  // beside the result line in the header (which reads White's score first).
  it('names the winner once a result stands, whoever holds White, and says a draw as a draw', () => {
    const decided = (colorOfHome: 'W' | 'B', outcome: 'white' | 'draw' | 'black') =>
      note(
        chessDisplay({
          phase: 'done',
          colorOfHome,
          result: { outcome, method: 'checkmate' },
        }),
      );
    const won = (name: string) => [
      { slot: 'note', text: { key: 'scoring.chess.last.won', vars: { name } } },
    ];
    expect(decided('W', 'white')).toEqual(won(SHARMA));
    expect(decided('W', 'black')).toEqual(won(CHEN));
    expect(decided('B', 'white')).toEqual(won(CHEN));
    expect(decided('B', 'black')).toEqual(won(SHARMA));
    expect(decided('W', 'draw')).toEqual([
      { slot: 'note', text: { key: 'scoring.chess.last.drawn' } },
    ]);
  });

  it('names the winner after the organiser locks the result, and says nothing of a result that is none', () => {
    expect(
      note(chessDisplay({ phase: 'final', result: { outcome: 'black', method: null } })),
    ).toEqual([{ slot: 'note', text: { key: 'scoring.chess.last.won', vars: { name: CHEN } } }]);
    expect(note(chessDisplay({ phase: 'final', result: null }))).toEqual([
      { slot: 'note', text: null },
    ]);
    expect(note(chessDisplay({ phase: 'done', result: null }))).toEqual([
      { slot: 'note', text: null },
    ]);
  });
});

describe('chessPad: a game that ended with no result (the Batch A review, M2)', () => {
  // An abandoned game, or a double walkover: the engine's phase says it is over and there is no outcome. The card must not
  // claim a result was recorded, and must not claim the organiser finalised one either.
  it.each(['done', 'final'] as const)(
    'is not the recorded-result card when phase is %s',
    (phase) => {
      const view = chessPad(chessDisplay({ phase, result: null }));
      expect(view.card).toEqual({ kind: 'cancelled' });
      expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
      expect(view.tools).toEqual([]);
    },
  );

  it('keeps the recorded-result card for a game that has a result', () => {
    expect(
      chessPad(chessDisplay({ phase: 'done', result: { outcome: 'draw', method: null } })).card,
    ).toEqual({ kind: 'resultRecorded', undoLeft: null });
  });

  it('shows no card while the game is live, not started or waiting for a tie-break', () => {
    for (const phase of ['notStarted', 'live', 'tiebreak'] as const) {
      expect(chessPad(chessDisplay({ phase, result: null })).card, phase).toBeNull();
    }
  });
});

describe('chessTakesResult', () => {
  it('is true only while the game is live', () => {
    const takes = (phase: ChessDisplay['phase']) => chessTakesResult(chessDisplay({ phase }));
    expect(takes('live')).toBe(true);
    for (const phase of ['notStarted', 'tiebreak', 'done', 'final'] as const) {
      expect(takes(phase), phase).toBe(false);
    }
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
      result: { outcome: 'white', method: 'checkmate' },
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
        result: { outcome: 'draw', method: null },
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

  // Before a result the visible tally is empty and the points are too: a screen reader must not read "Result: A. Sharma , L. Chen ".
  it.each([
    ['a game in play', chessDisplay()],
    ['a game over with no result', chessDisplay({ phase: 'done', result: null })],
    ['an abandoned game', chessDisplay({ phase: 'final', result: null })],
  ])(
    'says "no result" to a screen reader for %s, with no names and no empty points',
    (_name, display) => {
      expect(chessPad(display).tally.said).toEqual({ key: 'scoring.chess.tallyNone' });
    },
  );

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

  // A draw is a bare "½": "½–½" is 81 dp at the tally's size, wider than the header's room at 320 dp (chessFit.test.ts).
  it('is 1–0, ½ or 0–1, White’s score first, with an en dash', () => {
    expect(lineOf({ outcome: 'white', method: null })).toBe('1–0');
    expect(lineOf({ outcome: 'draw', method: null })).toBe('½');
    expect(lineOf({ outcome: 'black', method: null })).toBe('0–1');
  });

  it('is empty while the game is live, and while the tie-break waits', () => {
    expect(lineOf(null)).toBe('');
  });

  it('does not change with the method', () => {
    expect(lineOf({ outcome: 'white', method: 'resign' })).toBe('1–0');
  });

  it('stays White’s score first when home holds Black: the pad’s tally reads like a scoresheet', () => {
    const tally = (colorOfHome: 'W' | 'B', outcome: 'white' | 'black') =>
      chessPad(
        chessDisplay({
          phase: 'done',
          colorOfHome,
          result: { outcome, method: null },
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
    chessCardLine(chessDisplay({ phase: 'done', colorOfHome, result: { outcome, method: null } }));

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
