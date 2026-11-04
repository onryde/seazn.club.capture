import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { badmintonPad, type BadmintonDisplay } from '@/domain/scoring/badmintonPad';
import type { PadSide, PadStart, PadView } from '@/domain/scoring/padView';
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

function viewNeeding(needsToss: boolean): PadView<MessageKey> {
  const view = badmintonPad(SINGLES);
  const start = view.start as PadStart<MessageKey>;
  return { ...view, start: { ...start, needsToss } };
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
) {
  const { actions, start, pickServer } = actionsOf();
  renderWithPorts(
    <PadContent
      model={{
        view: viewNeeding(needsToss),
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
