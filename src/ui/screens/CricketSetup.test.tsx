import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CricketSetupView } from '@/domain/scoring/cricketSetup';
import type { PadMatchDetails } from '@/domain/scoring/padView';
import type { CricketPadActions } from '@/hooks/useCricketMatch';
import type { CricketSetupModel } from '@/hooks/useCricketSetup';
import en from '@/i18n/en.json';
import type { MessageKey } from '@/i18n/messages';
import { CricketSetup } from '@/ui/screens/CricketSetup';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The setup before the first ball (S2-4 spec §4.1; plan Task 10): each step as the hook hands it, written out here, and
// which action each button calls. Which step comes when, and what the actions record, is the hook's
// (`useCricketMatch.test.tsx`) and the routed flow's (`test/routedApp.cricket.test.tsx`). The lime is the phone's (Task 19).

const DETAILS: PadMatchDetails<MessageKey> = {
  context: {
    competition: 'Summer Bash 2026',
    division: 'Open T2',
    round: 'Final',
    match: 'Match 7',
    sides: ['Riverside CC', 'Hillcrest CC'],
  },
  rules: [
    {
      label: { key: 'scoring.cricket.rules.overs.label' },
      value: { key: 'scoring.cricket.rules.overs.value', vars: { overs: 2 } },
    },
  ],
};

const RIVERSIDE = { id: 'first', label: 'Riverside CC' } as const;
const HILLCREST = { id: 'second', label: 'Hillcrest CC' } as const;

const VIEW: CricketSetupView = {
  teams: [RIVERSIDE, HILLCREST],
  batting: RIVERSIDE,
  fielding: HILLCREST,
  order: [
    { id: 'r1', name: 'A. Sharma', opener: true },
    { id: 'r2', name: 'B. Okafor', opener: true },
    { id: 'r3', name: 'C. Mendes', opener: false },
  ],
  nextOpeners: { striker: 'r1', nonStriker: 'r2' },
  openers: null,
  bowlers: [
    { id: 'h10', name: 'V. Kaur', chosen: false },
    { id: 'h11', name: 'W. Murphy', chosen: false },
  ],
};

const OPENED: CricketSetupView = {
  ...VIEW,
  openers: {
    striker: { id: 'r1', name: 'A. Sharma' },
    nonStriker: { id: 'r2', name: 'B. Okafor' },
  },
};

/** Every action a spy: the screen calls a few, by name. */
function spies(): CricketPadActions {
  const made = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy({} as CricketPadActions, {
    get: (_target, name) => {
      const known = made.get(name) ?? vi.fn();
      made.set(name, known);
      return known;
    },
  });
}

function renderSetup(setup: CricketSetupModel) {
  const actions = spies();
  renderWithPorts(<CricketSetup setup={setup} details={DETAILS} actions={actions} />);
  return actions;
}

const model = (over: Partial<CricketSetupModel>): CricketSetupModel => ({
  step: 'order',
  view: VIEW,
  tossWinner: null,
  ready: false,
  ...over,
});

const startMatch = () => screen.getByRole('button', { name: en['scoring.start.confirm'] });

describe('CricketSetup', () => {
  it('the toss step is the toss on the whole screen, and nothing else', () => {
    const actions = renderSetup(model({ step: 'toss' }));
    expect(screen.getByTestId('cricket-toss')).toBeTruthy();
    expect(screen.queryByTestId('cricket-setup')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'Hillcrest CC' })));
    expect(actions.pickTossWinner).toHaveBeenCalledWith('second');
  });

  it('the order step shows the match card and the batting side’s order; Next picks its first two', () => {
    const actions = renderSetup(model({ step: 'order' }));
    expect(screen.getByTestId('match-card')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: en['scoring.cricket.setup.order'].replace('{team}', 'Riverside CC'),
      }),
    ).toBeTruthy();
    expect(screen.getByTestId('batting-order')).toBeTruthy();
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.cricket.setup.next'] })),
    );
    expect(actions.setOpeners).toHaveBeenCalledWith({ striker: 'r1', nonStriker: 'r2' });
    act(() => fireEvent.click(screen.getByRole('button', { name: /Move up: C\. Mendes/ })));
    expect(actions.moveBatter).toHaveBeenCalledWith(2, 1);
  });

  it('the bowler step names the openers and lists the fielding side, each row lime, the pick heavier', () => {
    const actions = renderSetup(
      model({
        step: 'ready',
        ready: true,
        view: { ...OPENED, bowlers: [VIEW.bowlers[0]!, { ...VIEW.bowlers[1]!, chosen: true }] },
      }),
    );
    expect(
      screen.getByText(
        en['scoring.cricket.setup.openers']
          .replace('{striker}', 'A. Sharma')
          .replace('{nonStriker}', 'B. Okafor'),
      ),
    ).toBeTruthy();
    const list = screen.getByTestId('first-bowler');
    expect(
      within(list).getByRole('heading', {
        name: en['scoring.cricket.setup.bowler'].replace('{team}', 'Hillcrest CC'),
      }),
    ).toBeTruthy();
    const kaur = within(list).getByRole('button', { name: 'V. Kaur' });
    const murphy = within(list).getByRole('button', { name: 'W. Murphy' });
    expect(getComputedStyle(kaur).borderTopColor).toBe(edgeOf(colour.lime));
    expect([getComputedStyle(murphy).borderTopWidth, murphy.getAttribute('aria-selected')]).toEqual(
      [`${layout.iconBorderOn}px`, 'true'],
    );
    act(() => fireEvent.click(kaur));
    expect(actions.setBowler).toHaveBeenCalledWith('h10');
  });

  it('Start match waits for openers and a bowler: greyed and pressless until the step is ready', () => {
    const actions = renderSetup(model({ step: 'bowler', ready: false, view: OPENED }));
    expect(startMatch().getAttribute('aria-disabled')).toBe('true');
    act(() => fireEvent.click(startMatch()));
    expect(actions.start).not.toHaveBeenCalled();
  });

  it('ready, Start match starts, and Back goes to the order', () => {
    const actions = renderSetup(model({ step: 'ready', ready: true, view: OPENED }));
    expect(startMatch().getAttribute('aria-disabled')).not.toBe('true');
    act(() => fireEvent.click(startMatch()));
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.cricket.setup.back'] })),
    );
    expect(
      [actions.start, actions.changeOrder].map((spy) => vi.mocked(spy).mock.calls.length),
    ).toEqual([1, 1]);
  });

  it('a side with no players entered: the match card and Start match, no list and no Back (spec §4.10)', () => {
    renderSetup(
      model({
        step: 'ready',
        ready: true,
        view: { ...VIEW, bowlers: [], order: [], nextOpeners: null },
      }),
    );
    expect(screen.getByTestId('match-card')).toBeTruthy();
    expect(screen.queryByTestId('first-bowler')).toBeNull();
    expect(screen.queryByRole('button', { name: en['scoring.cricket.setup.back'] })).toBeNull();
    expect(startMatch().getAttribute('aria-disabled')).not.toBe('true');
  });
});
