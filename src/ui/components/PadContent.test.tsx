import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { badmintonPad, type BadmintonDisplay } from '@/domain/scoring/badmintonPad';
import type { PadSide, PadStart, PadStartSide, PadView } from '@/domain/scoring/padView';
import type { MessageKey } from '@/i18n/messages';
import dutch from '@/i18n/nl.json';
import en from '@/i18n/en.json';
import { PadContent, type PadContentActions } from '@/ui/components/PadContent';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The Start screen of the set-based kit (plan S2-3 Task 2): a sport with a serve pick asks who serves first and keeps
// Start match disabled until a side is picked; a sport with none shows no question and no picker, and Start match is
// ready. Driven by the view's `needsToss`, so nothing here names a sport: the view is badminton's, then the same view
// with its field turned over.

const SINGLES: BadmintonDisplay = {
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
  context: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Singles',
    round: 'Round 1',
    match: 'Match 4',
    sides: ['A. Sharma', 'L. Chen'],
  },
  points: { first: 0, second: 0 },
  finished: [],
  server: 'first',
  court: 'right',
  game: 1,
  rules: {
    bestOf: 3,
    points: 21,
    decidingPoints: 21,
    winBy: 2,
    cap: 30,
    intervalPoint: 11,
    decidingIntervalPoint: 11,
  },
  phase: 'notStarted',
  sanctions: [],
  lastTap: null,
  undoable: false,
  awaitingEnding: false,
  serverPicked: false,
};

/** Words a sport may put on a side's plate: the kit draws whatever it is given, so any dictionary word will do. */
const WHITE_PLATE = { key: 'scoring.sanction.penalty' } as const;
const BLACK_PLATE = { key: 'scoring.tabletennis.half.expedite' } as const;

type Plates = readonly [PadStartSide<MessageKey>['plate'], PadStartSide<MessageKey>['plate']];

function viewNeeding(needsToss: boolean, plates?: Plates): PadView<MessageKey> {
  const view = badmintonPad(SINGLES);
  const start = view.start as PadStart<MessageKey>;
  if (plates === undefined) return { ...view, start: { ...start, needsToss } };
  const [first, second] = start.sides;
  const sides = [
    { ...first, plate: plates[0] },
    { ...second, plate: plates[1] },
  ] as const;
  return { ...view, start: { ...start, needsToss, sides } };
}

function actionsOf() {
  const start = vi.fn<() => void>();
  const pickServer = vi.fn<(side: PadSide) => void>();
  const actions: PadContentActions = {
    home: vi.fn(),
    tapHalf: vi.fn(),
    undo: vi.fn(),
    tool: vi.fn(),
    cancel: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    browser: vi.fn(),
    details: vi.fn(),
    history: vi.fn(),
    pickServer,
    start,
  };
  return { actions, start, pickServer };
}

function renderStart(
  needsToss: boolean,
  toss: PadSide | null,
  language: 'en' | 'es' | 'fr' | 'nl' = 'en',
  plates?: Plates,
) {
  const { actions, start, pickServer } = actionsOf();
  renderWithPorts(
    <PadContent
      model={{
        view: viewNeeding(needsToss, plates),
        line: null,
        cardNote: null,
        flash: null,
        toss,
        actions,
      }}
      covered={false}
    />,
    { deviceLanguages: [language] },
  );
  return { start, pickServer };
}

const startButton = (name: string = en['scoring.start.confirm']) =>
  screen.getByRole('button', { name });

describe('PadContent: the Start screen of a sport with a serve pick', () => {
  it('asks who serves first and keeps Start match disabled until a side is picked', () => {
    const { start } = renderStart(true, null);
    expect(screen.getByRole('heading', { name: en['scoring.badminton.start.ask'] })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((side) => side.textContent)).toEqual([
      'A. Sharma',
      'L. Chen',
    ]);
    expect(startButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(startButton());
    expect(start).not.toHaveBeenCalled();
  });

  it('starts, once per press, when a side is picked', () => {
    const { start } = renderStart(true, 'second');
    expect(startButton().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(startButton());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('hands a tap on a side to pickServer, which starts nothing by itself', () => {
    const { start, pickServer } = renderStart(true, null);
    fireEvent.click(screen.getByRole('radio', { name: 'L. Chen' }));
    expect(pickServer.mock.calls).toEqual([['second']]);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('PadContent: the Start screen of a sport with no serve pick', () => {
  it('shows the match card and Start match, with no question and no side to pick', () => {
    renderStart(false, null);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.getByText('Spring Open 2026')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.queryByTestId('toss')).toBeNull();
    expect(screen.queryByText(en['scoring.badminton.start.ask'])).toBeNull();
  });

  it('has Start match enabled with nothing picked, and a press starts once', () => {
    const { start, pickServer } = renderStart(false, null);
    expect(startButton().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(startButton());
    expect(start).toHaveBeenCalledTimes(1);
    expect(pickServer).not.toHaveBeenCalled();
  });

  it('says Start match in the operator’s language, from the dictionary', () => {
    renderStart(false, null, 'nl');
    expect(startButton(dutch['scoring.start.confirm']).getAttribute('aria-disabled')).not.toBe(
      'true',
    );
    expect(dutch['scoring.start.confirm']).not.toBe(en['scoring.start.confirm']);
  });
});

// A sport whose sides carry a plate word (chess: WHITE, BLACK) and has no serve to pick shows each name with its plate before
// Start match, as read-only rows (Batch A review). Nothing here names a sport: the plates are any words.
describe('PadContent: the Start screen shows the sides’ plates when there is no serve to pick', () => {
  const rows = () => screen.queryByTestId('start-sides');

  it('draws each name with its plate, first on top, as rows that take no tap', () => {
    const { pickServer, start } = renderStart(false, null, 'en', [WHITE_PLATE, BLACK_PLATE]);
    const first = screen.getByTestId('start-side-first');
    const second = screen.getByTestId('start-side-second');
    expect(within(first).getByText('A. Sharma')).toBeTruthy();
    expect(within(first).getByTestId('plate').textContent).toBe(en['scoring.sanction.penalty']);
    expect(within(second).getByText('L. Chen')).toBeTruthy();
    expect(within(second).getByTestId('plate').textContent).toBe(
      en['scoring.tabletennis.half.expedite'],
    );
    expect(rows()?.children[0]).toBe(first);
    fireEvent.click(first);
    fireEvent.click(second);
    expect(pickServer).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(within(first).queryByRole('button')).toBeNull();
  });

  it('reads each row to a screen reader as the name and its plate', () => {
    renderStart(false, null, 'en', [WHITE_PLATE, BLACK_PLATE]);
    expect(
      screen.getByTestId('start-side-first').getAttribute('aria-label') ??
        screen.getByTestId('start-side-first').textContent,
    ).toBe(`A. Sharma, ${en['scoring.sanction.penalty']}`);
  });

  it('keeps Start match ready and pressing it starts once', () => {
    const { start } = renderStart(false, null, 'en', [WHITE_PLATE, BLACK_PLATE]);
    expect(startButton().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(startButton());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('draws the rows when only one side has a plate, and no plate on the other', () => {
    renderStart(false, null, 'en', [WHITE_PLATE, null]);
    expect(within(screen.getByTestId('start-side-first')).getByTestId('plate')).toBeTruthy();
    expect(within(screen.getByTestId('start-side-second')).queryByTestId('plate')).toBeNull();
    expect(within(screen.getByTestId('start-side-second')).getByText('L. Chen')).toBeTruthy();
  });

  it('draws no rows when no side has a plate: badminton’s Start screen is as it was', () => {
    renderStart(false, null);
    expect(rows()).toBeNull();
    renderStart(false, null, 'en', [null, null]);
    expect(rows()).toBeNull();
  });

  it('draws the picker and not the rows when a serve is to be picked, plates or not', () => {
    renderStart(true, null, 'en', [WHITE_PLATE, BLACK_PLATE]);
    expect(rows()).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('says the plate in the operator’s language, from the dictionary', () => {
    renderStart(false, null, 'nl', [WHITE_PLATE, BLACK_PLATE]);
    expect(within(screen.getByTestId('start-side-first')).getByTestId('plate').textContent).toBe(
      dutch['scoring.sanction.penalty'],
    );
    expect(dutch['scoring.sanction.penalty']).not.toBe(en['scoring.sanction.penalty']);
  });
});
