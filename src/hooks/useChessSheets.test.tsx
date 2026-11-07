import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChessDisplay, ChessMethod, ChessTiebreakTap } from '@/domain/scoring/chessTypes';
import { TAKEN, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadAsk } from '@/domain/scoring/padView';
import { useChessSheets, type ChessSheetSnapshot } from '@/hooks/useChessSheets';
import { createFakePorts, type FakePorts } from '../../test/fakePorts';
import { chessDisplay, pendingTiebreak } from '../../test/chessLedger';
import { wrapperFor } from '../../test/renderWithPorts';

// The sheets over the chess pad (plan S2-3 Task 3; spec §4): the How sheet, which holds the SEAT that won and the method
// picked, and Match details, History and the reconnect question. Expected values are written out from the engine's own
// lists (`DECISIVE_METHODS`, `DRAWN_METHODS`) and the design, never read from the code under test.

const DECISIVE: readonly ChessMethod[] = [
  'checkmate',
  'resign',
  'time',
  'adjudication',
  'illegal_move',
];
const DRAWN: readonly ChessMethod[] = [
  'agreement',
  'stalemate',
  'insufficient',
  'adjudication',
  'repetition',
  'fifty_move',
  'dead_position',
];

const snapshot = (over: Partial<ChessDisplay> = {}): ChessSheetSnapshot => {
  const display = chessDisplay(over);
  return {
    display,
    details: { context: display.context, rules: [] },
    history: [],
    card: null,
    ask: null,
  };
};

const ASK: PadAsk = {
  foreign: 1,
  queued: 1,
  score: [
    { label: 'A. Sharma', value: '' },
    { label: 'L. Chen', value: '' },
  ],
};

/** The recorded taps, as the driver was asked to make them. */
function rig(initial: ChessSheetSnapshot | null = snapshot()) {
  const fakes = createFakePorts();
  const made = vi.fn((_winner: unknown, _method: unknown): PadOutcome => TAKEN);
  const tiebreakMade = vi.fn((_tap: ChessTiebreakTap): PadOutcome => TAKEN);
  const record = vi.fn((_tap: string, make: () => PadOutcome) => make().ok);
  const arm = vi.fn((_tap: string): void => undefined);
  const view = renderHook(
    ({ snap }: { snap: ChessSheetSnapshot | null }) =>
      useChessSheets({ result: made, tiebreak: tiebreakMade }, snap, record, arm),
    { wrapper: wrapperFor(fakes), initialProps: { snap: initial } },
  );
  return { ...view, fakes, made, tiebreakMade, record, arm };
}

type Rig = ReturnType<typeof rig>;

/** Time passes: the sheet's bounce window (250 ms) of appearing is over. */
const settle = (fakes: FakePorts, ms = 1000) =>
  act(() => fakes.setNow(new Date(fakes.ports.clock().getTime() + ms)));

const how = (view: Rig) => {
  const sheet = view.result.current.view;
  return sheet?.kind === 'how' ? sheet : null;
};

/** The sheet open for a seat (or a draw), and its bounce window over. */
function opened(winner: 'first' | 'second' | null, over: Partial<ChessDisplay> = {}) {
  const view = rig(snapshot(over));
  act(() => void view.result.current.show(winner));
  settle(view.fakes);
  return view;
}

describe('opening the How sheet', () => {
  it('opens for the seat that won with the decisive methods, none picked, and records nothing', () => {
    const view = rig();
    act(() => void view.result.current.show('second'));
    expect(how(view)).toEqual({ kind: 'how', winner: 'second', picked: null, methods: DECISIVE });
    expect(view.made).not.toHaveBeenCalled();
    expect(view.result.current.open).toBe(true);
  });

  it('opens for a draw with the drawn methods, adjudication among them', () => {
    const view = rig();
    act(() => void view.result.current.show(null));
    expect(how(view)).toEqual({ kind: 'how', winner: null, picked: null, methods: DRAWN });
  });

  // The seat is held, not a colour: the same seat gets the same sheet whoever holds White.
  it.each(['W', 'B', null] as const)('holds the seat, whoever holds White (%s)', (colorOfHome) => {
    const view = rig(snapshot({ colorOfHome }));
    act(() => void view.result.current.show('first'));
    expect(how(view)?.winner).toBe('first');
  });

  it.each(['notStarted', 'tiebreak', 'done', 'final'] as const)(
    'refuses while the game is %s: the engine takes no result then, and no sheet stands',
    (phase) => {
      const view = rig(snapshot({ phase }));
      let outcome: PadOutcome = TAKEN;
      act(() => {
        outcome = view.result.current.show('first');
      });
      expect(outcome).toEqual({ ok: false, refusal: 'notNow' });
      expect(view.result.current.view).toBeNull();
      expect(view.result.current.open).toBe(false);
    },
  );

  it('shows nothing while the match is loading (no snapshot)', () => {
    const view = rig(null);
    act(() => void view.result.current.show('first'));
    expect(view.result.current.view).toBeNull();
  });
});

describe('picking How', () => {
  it('picks one method and shows it picked; none again clears it', () => {
    const view = opened('first');
    act(() => view.result.current.actions.pickMethod('time'));
    expect(how(view)?.picked).toBe('time');
    act(() => view.result.current.actions.pickMethod('resign'));
    expect(how(view)?.picked).toBe('resign');
    settle(view.fakes);
    act(() => view.result.current.actions.pickMethod(null));
    expect(how(view)?.picked).toBeNull();
  });

  // The second touch of a double tap on a chip is a tap on the picked chip, which clears it: it must not undo the first.
  it('a clear on the heels of the pick is a double tap’s second touch and is ignored; a later one clears', () => {
    const view = opened('first');
    act(() => view.result.current.actions.pickMethod('time'));
    act(() => view.result.current.actions.pickMethod(null));
    expect(how(view)?.picked).toBe('time');
    settle(view.fakes);
    act(() => view.result.current.actions.pickMethod(null));
    expect(how(view)?.picked).toBeNull();
  });

  it('a pick of another method on the heels of one is taken, and a clear on the heels of that is ignored', () => {
    const view = opened('first');
    act(() => view.result.current.actions.pickMethod('time'));
    settle(view.fakes, 200);
    act(() => view.result.current.actions.pickMethod('resign'));
    expect(how(view)?.picked).toBe('resign');
    settle(view.fakes, 200);
    act(() => view.result.current.actions.pickMethod(null));
    expect(how(view)?.picked).toBe('resign');
  });

  // A win's list is the decisive one and a draw's the drawn one; the engine refuses a method that contradicts the winner.
  it('takes no method outside the outcome’s list: a drawn word for a win, a decisive word for a draw', () => {
    const win = opened('first');
    act(() => win.result.current.actions.pickMethod('agreement'));
    expect(how(win)?.picked).toBeNull();
    const draw = opened(null);
    act(() => draw.result.current.actions.pickMethod('checkmate'));
    expect(how(draw)?.picked).toBeNull();
    act(() => draw.result.current.actions.pickMethod('stalemate'));
    expect(how(draw)?.picked).toBe('stalemate');
  });

  it('takes adjudication for either: it is on both lists', () => {
    const win = opened('second');
    act(() => win.result.current.actions.pickMethod('adjudication'));
    expect(how(win)?.picked).toBe('adjudication');
    const draw = opened(null);
    act(() => draw.result.current.actions.pickMethod('adjudication'));
    expect(how(draw)?.picked).toBe('adjudication');
  });

  it('takes a pick only on an open How sheet', () => {
    const view = rig();
    act(() => view.result.current.actions.pickMethod('time'));
    expect(view.result.current.view).toBeNull();
  });
});

describe('Record', () => {
  it('records the seat and no method, once, and the sheet leaves with it', () => {
    const view = opened('second');
    act(() => view.result.current.actions.record());
    expect(view.made).toHaveBeenCalledTimes(1);
    expect(view.made).toHaveBeenCalledWith('second', null);
    expect(view.result.current.view).toBeNull();
  });

  it('records the method picked', () => {
    const view = opened('first');
    act(() => view.result.current.actions.pickMethod('illegal_move'));
    act(() => view.result.current.actions.record());
    expect(view.made).toHaveBeenCalledWith('first', 'illegal_move');
  });

  it('records a draw as nobody, with its method', () => {
    const view = opened(null);
    act(() => view.result.current.actions.pickMethod('fifty_move'));
    act(() => view.result.current.actions.record());
    expect(view.made).toHaveBeenCalledWith(null, 'fifty_move');
  });

  it('records through the bounce memory, under one name', () => {
    const view = opened('first');
    act(() => view.result.current.actions.record());
    expect(view.record).toHaveBeenCalledTimes(1);
    expect(view.record.mock.calls[0]?.[0]).toBe('result');
  });

  it('records nothing with no sheet open', () => {
    const view = rig();
    act(() => view.result.current.actions.record());
    expect(view.made).not.toHaveBeenCalled();
  });

  // The second touch of a double tap on the half lands on the sheet's bottom edge, where Record is.
  it('takes no Record in the bounce window of the sheet appearing, and no pick either', () => {
    const view = rig();
    act(() => void view.result.current.show('first'));
    act(() => view.result.current.actions.record());
    act(() => view.result.current.actions.pickMethod('time'));
    expect(view.made).not.toHaveBeenCalled();
    expect(how(view)?.picked).toBeNull();
    expect(view.result.current.view).not.toBeNull();
    settle(view.fakes);
    act(() => view.result.current.actions.record());
    expect(view.made).toHaveBeenCalledTimes(1);
  });
});

describe('Cancel', () => {
  it('closes the sheet and records nothing', () => {
    const view = opened('first');
    act(() => view.result.current.cancel());
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.open).toBe(false);
    expect(view.made).not.toHaveBeenCalled();
  });

  it('a pick does not survive it: the next sheet starts with none picked', () => {
    const view = opened('first');
    act(() => view.result.current.actions.pickMethod('time'));
    act(() => view.result.current.cancel());
    act(() => void view.result.current.show('first'));
    expect(how(view)?.picked).toBeNull();
  });
});

describe('the sheet closes when the ledger moves under it', () => {
  const closes = (before: Partial<ChessDisplay>, after: Partial<ChessDisplay>) => {
    const view = opened('first', before);
    expect(how(view)).not.toBeNull();
    view.rerender({ snap: snapshot(after) });
    return view.result.current.view === null;
  };

  it('closes when another scorer recorded a result', () => {
    expect(closes({}, { phase: 'done', result: { outcome: 'black', method: null } })).toBe(true);
  });

  it('closes when the game goes to the tie-break, is locked or is abandoned', () => {
    expect(closes({}, { phase: 'tiebreak' })).toBe(true);
    expect(closes({}, { phase: 'final' })).toBe(true);
    expect(closes({}, { phase: 'done' })).toBe(true);
  });

  // Ruling 3: the sheet named a player holding a colour; a pairing changes who holds it, so it closes and the scorer chooses again.
  it('closes when a pairing changed the colours, either way', () => {
    expect(closes({ colorOfHome: 'W' }, { colorOfHome: 'B' })).toBe(true);
    expect(closes({ colorOfHome: 'B' }, { colorOfHome: 'W' })).toBe(true);
  });

  it('stays open for a ledger move that changes nothing it was for', () => {
    expect(closes({}, { lastTap: { kind: 'start' } })).toBe(false);
    expect(closes({}, { undoable: true })).toBe(false);
  });

  it('keeps the pick it holds across such a move', () => {
    const view = opened('first');
    act(() => view.result.current.actions.pickMethod('time'));
    view.rerender({ snap: snapshot({ lastTap: { kind: 'start' } }) });
    expect(how(view)?.picked).toBe('time');
  });

  it('closes when the match is gone (no snapshot)', () => {
    const view = opened('first');
    view.rerender({ snap: null });
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.open).toBe(false);
  });

  it('closes under the reconnect question, which stands over every sheet', () => {
    const view = opened('first');
    view.rerender({ snap: { ...snapshot(), ask: ASK } });
    expect(view.result.current.view?.kind).toBe('ask');
    view.rerender({ snap: snapshot() });
    expect(view.result.current.view).toBeNull();
  });
});

describe('Match details, History and the reconnect question', () => {
  it('opens Match details, with the game’s context', () => {
    const view = rig();
    act(() => view.result.current.actions.details());
    const sheet = view.result.current.view;
    expect(sheet?.kind).toBe('details');
    expect(sheet?.kind === 'details' && sheet.details.context.competition).toBe('Spring Open 2026');
  });

  it('opens History with the groups it is handed', () => {
    const groups = [{ heading: { key: 'scoring.chess.gameHeading' as const }, rows: [] }];
    const view = rig({ ...snapshot(), history: groups });
    act(() => view.result.current.actions.history());
    expect(view.result.current.view).toEqual({ kind: 'history', groups });
  });

  it('closes them with cancel', () => {
    const view = rig();
    act(() => view.result.current.actions.details());
    act(() => view.result.current.cancel());
    expect(view.result.current.view).toBeNull();
  });

  it('dismisses Match details, but not in the bounce window of its appearing', () => {
    const view = rig();
    act(() => view.result.current.actions.details());
    act(() => view.result.current.actions.dismiss());
    expect(view.result.current.view?.kind).toBe('details');
    settle(view.fakes);
    act(() => view.result.current.actions.dismiss());
    expect(view.result.current.view).toBeNull();
  });

  // A close leaves the screen with the touch, so it arms the bounce window (the second touch of a double tap lands on the
  // pad under it), and it makes no tap of its own: a tap says something on the line, which a close must not wipe.
  it('arms the bounce window when it closes, and makes no tap', () => {
    const view = rig();
    act(() => view.result.current.actions.details());
    settle(view.fakes);
    act(() => view.result.current.actions.dismiss());
    expect(view.arm).toHaveBeenCalledTimes(1);
    expect(view.record).not.toHaveBeenCalled();
    expect(view.result.current.view).toBeNull();
  });

  it('arms nothing in the bounce window of the sheet appearing, where it closes nothing', () => {
    const view = rig();
    act(() => view.result.current.actions.details());
    act(() => view.result.current.actions.dismiss());
    expect(view.arm).not.toHaveBeenCalled();
    expect(view.result.current.view?.kind).toBe('details');
  });

  it('arms nothing for Back, which is no touch on the pad', () => {
    const view = rig();
    act(() => view.result.current.actions.details());
    settle(view.fakes);
    act(() => view.result.current.cancel());
    expect(view.arm).not.toHaveBeenCalled();
  });

  it('puts the question over the pad, and its confirm over that, quiet in the bounce window', () => {
    const view = rig({ ...snapshot(), ask: ASK });
    expect(view.result.current.view?.kind).toBe('ask');
    settle(view.fakes);
    act(() => view.result.current.actions.askDiscard());
    expect(view.result.current.view?.kind).toBe('discard');
  });

  // The second touch of a double tap on the question's button lands on the confirm it opens; it must not answer it.
  it('takes no Discard in the bounce window of the question appearing, and takes it after', () => {
    const view = rig({ ...snapshot(), ask: ASK });
    act(() => view.result.current.actions.askDiscard());
    expect(view.result.current.view?.kind).toBe('ask');
    settle(view.fakes);
    act(() => view.result.current.actions.askDiscard());
    expect(view.result.current.view?.kind).toBe('discard');
  });

  it('opens no How sheet while the question stands: the ledger is not settled, so a half is not now', () => {
    const view = rig({ ...snapshot(), ask: ASK });
    let outcome: PadOutcome = TAKEN;
    act(() => {
      outcome = view.result.current.show('first');
    });
    expect(outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(view.result.current.view?.kind).toBe('ask');
    view.rerender({ snap: snapshot() });
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.open).toBe(false);
  });

  it('opens nothing over a dead link’s card', () => {
    const view = rig({ ...snapshot(), ask: ASK, card: { kind: 'linkInvalid' } });
    expect(view.result.current.view).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The tie-break sheet (S2-3b Task 2; design §3). Steps: the rung (skipped for a stage that lists one), then who won and
// the optional score (rapid, blitz) or who had Black and the result and the confirm (Armageddon). Nothing is sent before
// Record. Every choice is a SEAT. Expected taps are the design's, written out.
// ---------------------------------------------------------------------------------------------------------------

const OWED = (rungs?: Parameters<typeof pendingTiebreak>[0]) =>
  snapshot({ phase: 'tiebreak', tiebreak: pendingTiebreak(rungs) });

const tie = (view: Rig) => {
  const sheet = view.result.current.view;
  return sheet?.kind === 'tiebreak' ? sheet : null;
};

/** The tie-break sheet open and its bounce window over. */
function owed(rungs?: Parameters<typeof pendingTiebreak>[0], over: Partial<ChessDisplay> = {}) {
  const view = rig({ ...OWED(rungs), display: { ...OWED(rungs).display, ...over } });
  act(() => void view.result.current.showTiebreak());
  settle(view.fakes);
  return view;
}

/** One pick, then the time the next step needs before it takes a pick. */
function then(view: Rig, make: (actions: Rig['result']['current']['actions']) => void) {
  act(() => make(view.result.current.actions));
  settle(view.fakes);
}

const BLANK = { rung: null, winner: null, score: null, black: null, result: null };

describe('opening the tie-break sheet', () => {
  it('opens on the rung with the stage’s rungs in its order, nothing chosen, and sends nothing', () => {
    const view = rig(OWED(['blitz', 'rapid']));
    act(() => void view.result.current.showTiebreak());
    expect(tie(view)).toEqual({
      kind: 'tiebreak',
      step: 'rung',
      rungs: ['blitz', 'rapid'],
      draft: BLANK,
      advances: null,
    });
    expect(view.result.current.open).toBe(true);
    expect(view.result.current.tiebreakOpen).toBe(true);
    expect(view.tiebreakMade).not.toHaveBeenCalled();
  });

  it.each([
    ['rapid', 'winner'],
    ['blitz', 'winner'],
    ['armageddon', 'black'],
  ] as const)('skips the rung step for a stage that lists only %s', (rung, step) => {
    const view = rig(OWED([rung]));
    act(() => void view.result.current.showTiebreak());
    expect(tie(view)).toMatchObject({ step, draft: { ...BLANK, rung } });
  });

  it('is no How sheet: a half or Draw is refused while the tie-break is owed', () => {
    const view = rig(OWED());
    let outcome: PadOutcome = TAKEN;
    act(() => {
      outcome = view.result.current.show('first');
    });
    expect(outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(view.result.current.view).toBeNull();
  });

  it.each([
    ['a live game', snapshot()],
    [
      'a game with a result',
      snapshot({ phase: 'done', result: { outcome: 'draw', method: null } }),
    ],
    [
      'a game held for the organiser (the stage lists no rung)',
      snapshot({
        phase: 'done',
        tiebreak: { rungs: [], pending: false, held: true, decided: null },
      }),
    ],
    [
      'a tie-break already decided',
      snapshot({
        phase: 'done',
        tiebreak: {
          rungs: ['rapid'],
          pending: false,
          held: false,
          decided: { rung: 'rapid', advances: 'first' },
        },
      }),
    ],
    ['a game not started', snapshot({ phase: 'notStarted' })],
  ])('refuses on %s, and no sheet stands', (_name, snap) => {
    const view = rig(snap);
    let outcome: PadOutcome = TAKEN;
    act(() => {
      outcome = view.result.current.showTiebreak();
    });
    expect(outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.tiebreakOpen).toBe(false);
  });

  it('refuses a tie-break owed with no rung listed: there is nothing to ask', () => {
    const view = rig(OWED([]));
    let outcome: PadOutcome = TAKEN;
    act(() => {
      outcome = view.result.current.showTiebreak();
    });
    expect(outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(view.result.current.view).toBeNull();
  });

  it('shows nothing while the match is loading (no snapshot)', () => {
    const view = rig(null);
    act(() => void view.result.current.showTiebreak());
    expect(view.result.current.view).toBeNull();
  });

  it('opens none while the reconnect question stands', () => {
    const view = rig({ ...OWED(), ask: ASK });
    let outcome: PadOutcome = TAKEN;
    act(() => {
      outcome = view.result.current.showTiebreak();
    });
    expect(outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(view.result.current.view?.kind).toBe('ask');
  });
});

describe('a rapid or blitz tie-break', () => {
  it.each(['rapid', 'blitz'] as const)('%s: rung, the winner, no score, Record', (rung) => {
    const view = owed();
    then(view, (a) => a.pickRung(rung));
    expect(tie(view)).toMatchObject({ step: 'winner', draft: { rung } });
    then(view, (a) => a.pickTiebreakWinner('second'));
    expect(tie(view)).toMatchObject({ step: 'score', advances: 'second' });
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledTimes(1);
    expect(view.tiebreakMade).toHaveBeenCalledWith({
      kind: 'tiebreak',
      rung,
      winner: 'second',
      score: null,
    });
    expect(view.result.current.view).toBeNull();
  });

  it.each(['2–0', '1½–½'] as const)('records the score %s', (score) => {
    const view = owed();
    then(view, (a) => a.pickRung('rapid'));
    then(view, (a) => a.pickTiebreakWinner('first'));
    then(view, (a) => a.pickScore(score));
    expect(tie(view)?.draft.score).toBe(score);
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledWith({
      kind: 'tiebreak',
      rung: 'rapid',
      winner: 'first',
      score,
    });
  });

  it('No score after a score is no score', () => {
    const view = owed(['blitz']);
    then(view, (a) => a.pickTiebreakWinner('first'));
    then(view, (a) => a.pickScore('2–0'));
    then(view, (a) => a.pickScore(null));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledWith(expect.objectContaining({ score: null }));
  });

  it('a stage that lists one rung goes straight to the winner', () => {
    const view = owed(['blitz']);
    then(view, (a) => a.pickTiebreakWinner('second'));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledWith({
      kind: 'tiebreak',
      rung: 'blitz',
      winner: 'second',
      score: null,
    });
  });

  // The seat is what is held, so the same pick names the same player whoever holds White, and with no colours at all.
  it.each(['W', 'B', null] as const)(
    'names the seat the same way whoever holds White (%s)',
    (colorOfHome) => {
      const view = owed(['rapid'], { colorOfHome });
      then(view, (a) => a.pickTiebreakWinner('first'));
      act(() => view.result.current.actions.recordTiebreak());
      expect(view.tiebreakMade).toHaveBeenCalledWith(expect.objectContaining({ winner: 'first' }));
    },
  );

  it('takes no Record before the score step: the rung and the winner are not a tie-break yet', () => {
    const view = owed();
    act(() => view.result.current.actions.recordTiebreak());
    then(view, (a) => a.pickRung('rapid'));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).not.toHaveBeenCalled();
    expect(tie(view)).not.toBeNull();
  });

  it('takes a pick for another step as nothing: Black or a result on the winner step', () => {
    const view = owed();
    then(view, (a) => a.pickRung('rapid'));
    then(view, (a) => a.pickBlack('first'));
    then(view, (a) => a.pickArmageddonResult('draw'));
    then(view, (a) => a.pickScore('2–0'));
    expect(tie(view)).toMatchObject({
      step: 'winner',
      draft: { rung: 'rapid', black: null, result: null, score: null },
    });
  });

  it('takes no rung the stage does not list', () => {
    const view = owed(['rapid', 'blitz']);
    then(view, (a) => a.pickRung('armageddon'));
    expect(tie(view)?.step).toBe('rung');
  });
});

describe('an Armageddon', () => {
  it.each(['white', 'black', 'draw'] as const)(
    'records Black and the result %s, and never a winner',
    (result) => {
      const view = owed();
      then(view, (a) => a.pickRung('armageddon'));
      expect(tie(view)?.step).toBe('black');
      then(view, (a) => a.pickBlack('second'));
      expect(tie(view)?.step).toBe('result');
      then(view, (a) => a.pickArmageddonResult(result));
      // White won sends the other seat through; Black won and a draw send Black (BG-KO-2).
      expect(tie(view)).toMatchObject({
        step: 'confirm',
        advances: result === 'white' ? 'first' : 'second',
      });
      act(() => view.result.current.actions.recordTiebreak());
      expect(view.tiebreakMade).toHaveBeenCalledTimes(1);
      expect(view.tiebreakMade).toHaveBeenCalledWith({
        kind: 'tiebreak',
        rung: 'armageddon',
        black: 'second',
        result,
      });
      expect(view.result.current.view).toBeNull();
    },
  );

  // A division that plays without colours has no White or Black in the main game, and the Armageddon still asks who had Black.
  it('asks who had Black in a division that plays without colours', () => {
    const view = owed(undefined, { colorOfHome: null });
    then(view, (a) => a.pickRung('armageddon'));
    expect(tie(view)?.step).toBe('black');
    then(view, (a) => a.pickBlack('first'));
    then(view, (a) => a.pickArmageddonResult('black'));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledWith({
      kind: 'tiebreak',
      rung: 'armageddon',
      black: 'first',
      result: 'black',
    });
  });

  it('a stage that lists only Armageddon opens on Black', () => {
    const view = owed(['armageddon']);
    expect(tie(view)?.step).toBe('black');
  });

  it('takes no Record before the confirm', () => {
    const view = owed();
    then(view, (a) => a.pickRung('armageddon'));
    then(view, (a) => a.pickBlack('first'));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).not.toHaveBeenCalled();
  });
});

describe('the tie-break sheet and the bounce memory', () => {
  it('records through it under one name of its own', () => {
    const view = owed(['rapid']);
    then(view, (a) => a.pickTiebreakWinner('first'));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.record).toHaveBeenCalledTimes(1);
    expect(view.record.mock.calls[0]?.[0]).toBe('tiebreak');
  });

  // The second touch of a double tap on the Tie-break tile lands on the sheet's first choice, on the same edge.
  it('takes no pick in the bounce window of the sheet appearing, and takes it after', () => {
    const view = rig(OWED());
    act(() => void view.result.current.showTiebreak());
    act(() => view.result.current.actions.pickRung('rapid'));
    expect(tie(view)?.step).toBe('rung');
    settle(view.fakes);
    act(() => view.result.current.actions.pickRung('rapid'));
    expect(tie(view)?.step).toBe('winner');
  });

  // The second touch of a double tap on a row lands on the next step, where the same edge holds another choice.
  it('takes no pick on the heels of the pick that moved it to the next step', () => {
    const view = owed();
    act(() => view.result.current.actions.pickRung('armageddon'));
    act(() => view.result.current.actions.pickBlack('first'));
    expect(tie(view)).toMatchObject({ step: 'black', draft: { black: null } });
    settle(view.fakes);
    act(() => view.result.current.actions.pickBlack('first'));
    expect(tie(view)?.step).toBe('result');
    act(() => view.result.current.actions.pickArmageddonResult('draw'));
    expect(tie(view)?.step).toBe('result');
  });

  it('takes no winner, score or Record on the heels of the step that asks for it', () => {
    const view = owed();
    act(() => view.result.current.actions.pickRung('rapid'));
    act(() => view.result.current.actions.pickTiebreakWinner('first'));
    expect(tie(view)?.step).toBe('winner');
    settle(view.fakes);
    act(() => view.result.current.actions.pickTiebreakWinner('first'));
    expect(tie(view)?.step).toBe('score');
    act(() => view.result.current.actions.recordTiebreak());
    act(() => view.result.current.actions.pickScore('2–0'));
    expect(view.tiebreakMade).not.toHaveBeenCalled();
    expect(tie(view)?.draft.score).toBeNull();
    settle(view.fakes);
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledTimes(1);
  });

  it('takes no Record in the window of the confirm appearing', () => {
    const view = owed(['armageddon']);
    then(view, (a) => a.pickBlack('first'));
    act(() => view.result.current.actions.pickArmageddonResult('white'));
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).not.toHaveBeenCalled();
    settle(view.fakes);
    act(() => view.result.current.actions.recordTiebreak());
    expect(view.tiebreakMade).toHaveBeenCalledTimes(1);
  });

  it('records nothing with no sheet open, and no pick lands on a closed one', () => {
    const view = rig(OWED());
    act(() => {
      view.result.current.actions.recordTiebreak();
      view.result.current.actions.pickRung('rapid');
      view.result.current.actions.pickTiebreakWinner('first');
    });
    expect(view.tiebreakMade).not.toHaveBeenCalled();
    expect(view.result.current.view).toBeNull();
  });

  it('Cancel closes it with nothing sent, and nothing chosen survives into the next sheet', () => {
    const view = owed();
    then(view, (a) => a.pickRung('rapid'));
    then(view, (a) => a.pickTiebreakWinner('first'));
    act(() => view.result.current.cancel());
    expect(view.result.current.view).toBeNull();
    expect(view.tiebreakMade).not.toHaveBeenCalled();
    act(() => void view.result.current.showTiebreak());
    expect(tie(view)).toMatchObject({ step: 'rung', draft: BLANK });
  });

  it('a dismiss closes it, arms the bounce window, and not in the window of appearing', () => {
    const view = rig(OWED());
    act(() => void view.result.current.showTiebreak());
    act(() => view.result.current.actions.dismiss());
    expect(tie(view)).not.toBeNull();
    expect(view.arm).not.toHaveBeenCalled();
    settle(view.fakes);
    act(() => view.result.current.actions.dismiss());
    expect(view.result.current.view).toBeNull();
    expect(view.arm).toHaveBeenCalledTimes(1);
    expect(view.tiebreakMade).not.toHaveBeenCalled();
  });
});

describe('the tie-break sheet closes when the ledger moves under it', () => {
  const closes = (
    before: Parameters<typeof owed>[0],
    after: Snap,
    step: 'rung' | 'blitz' = 'rung',
  ) => {
    const view = owed(before);
    if (step === 'blitz') then(view, (a) => a.pickRung('blitz'));
    expect(tie(view)).not.toBeNull();
    view.rerender({ snap: after });
    return view.result.current.view === null;
  };
  type Snap = ChessSheetSnapshot;
  const resolved = (extra: Partial<ChessDisplay> = {}): Snap =>
    snapshot({
      phase: 'done',
      tiebreak: {
        rungs: ['rapid'],
        pending: false,
        held: false,
        decided: { rung: 'rapid', advances: 'second' },
      },
      ...extra,
    });

  it('closes when another scorer recorded the tie-break, on any step', () => {
    expect(closes(undefined, resolved())).toBe(true);
    expect(closes(undefined, resolved(), 'blitz')).toBe(true);
  });

  it('closes when the organiser settled the game or locked it, or the draw was voided', () => {
    expect(
      closes(undefined, snapshot({ phase: 'done', result: { outcome: 'draw', method: null } })),
    ).toBe(true);
    expect(closes(undefined, snapshot({ phase: 'final' }))).toBe(true);
    expect(closes(undefined, snapshot())).toBe(true);
  });

  it('closes when the rung chosen is no longer one the stage lists, and not before one is chosen', () => {
    expect(closes(undefined, OWED(['rapid', 'armageddon']), 'blitz')).toBe(true);
    expect(closes(undefined, OWED(['rapid', 'armageddon']))).toBe(false);
  });

  it('closes when the stage lists no rung any more', () => {
    expect(closes(undefined, OWED([]))).toBe(true);
  });

  it('stays open, with its choices, for a ledger move that changes nothing it was for', () => {
    const view = owed();
    then(view, (a) => a.pickRung('rapid'));
    then(view, (a) => a.pickTiebreakWinner('first'));
    view.rerender({
      snap: {
        ...OWED(),
        display: { ...OWED().display, lastTap: { kind: 'start' }, undoable: true },
      },
    });
    expect(tie(view)).toMatchObject({ step: 'score', draft: { rung: 'rapid', winner: 'first' } });
  });

  // The sheet holds seats, not colours: a pairing from another scorer changes nothing the scorer chose (and the How sheet
  // closes for one, where a player holds a colour).
  it('stays open when the colours change, either way', () => {
    const view = owed(undefined, { colorOfHome: 'W' });
    then(view, (a) => a.pickRung('armageddon'));
    then(view, (a) => a.pickBlack('first'));
    view.rerender({ snap: { ...OWED(), display: { ...OWED().display, colorOfHome: 'B' } } });
    expect(tie(view)).toMatchObject({ step: 'result', draft: { black: 'first' } });
  });

  it('closes when the match is gone (no snapshot)', () => {
    const view = owed();
    view.rerender({ snap: null });
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.open).toBe(false);
  });

  it('closes under the reconnect question, which stands over every sheet', () => {
    const view = owed();
    view.rerender({ snap: { ...OWED(), ask: ASK } });
    expect(view.result.current.view?.kind).toBe('ask');
    view.rerender({ snap: OWED() });
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.tiebreakOpen).toBe(false);
  });
});
