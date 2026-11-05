import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChessDisplay, ChessMethod } from '@/domain/scoring/chessTypes';
import { TAKEN, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadAsk } from '@/domain/scoring/padView';
import { useChessSheets, type ChessSheetSnapshot } from '@/hooks/useChessSheets';
import { createFakePorts, type FakePorts } from '../../test/fakePorts';
import { chessDisplay } from '../../test/chessLedger';
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
  const record = vi.fn((_tap: string, make: () => PadOutcome) => make().ok);
  const view = renderHook(
    ({ snap }: { snap: ChessSheetSnapshot | null }) =>
      useChessSheets({ result: made }, snap, record),
    { wrapper: wrapperFor(fakes), initialProps: { snap: initial } },
  );
  return { ...view, fakes, made, record };
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
