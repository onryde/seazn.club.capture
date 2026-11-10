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

function renderSetup(setup: CricketSetupModel, more = false) {
  const actions = spies();
  renderWithPorts(<CricketSetup setup={setup} details={DETAILS} more={more} actions={actions} />);
  return actions;
}

const model = (over: Partial<CricketSetupModel>): CricketSetupModel => ({
  step: 'order',
  view: VIEW,
  tossWinner: null,
  ready: false,
  begins: 'match',
  card: null,
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

// The innings break (spec §4.5, §4.6; plan Task 16): the same steps under the break's card, Start innings for Start
// match, and More in the foot while it offers something. Which step and card come when is the hook's and the domain's.
describe('CricketSetup at an innings break', () => {
  const HILLCREST_BATS: CricketSetupView = {
    ...VIEW,
    batting: HILLCREST,
    fielding: RIVERSIDE,
    order: [
      { id: 'h1', name: 'M. Chen', opener: true },
      { id: 'h2', name: 'N. Patel', opener: true },
      { id: 'h3', name: 'O. Kowalski', opener: false },
    ],
    nextOpeners: { striker: 'h1', nonStriker: 'h2' },
    bowlers: [
      { id: 'r10', name: 'J. Mwangi', chosen: false },
      { id: 'r11', name: 'K. Doyle', chosen: true },
    ],
  };
  const PICKED: CricketSetupView = {
    ...HILLCREST_BATS,
    openers: {
      striker: { id: 'h1', name: 'M. Chen' },
      nonStriker: { id: 'h2', name: 'N. Patel' },
    },
  };
  // The card as the domain hands it: a title, and a line over two parts (written out, not computed).
  const CARD = {
    title: { key: 'scoring.cricket.break.title' },
    line: {
      key: 'scoring.cricket.break.line',
      vars: {
        closed: {
          key: 'scoring.cricket.break.closed',
          vars: { team: 'Riverside CC', score: '8/0', overs: '2' },
        },
        next: {
          key: 'scoring.cricket.break.chase.other',
          count: 12,
          vars: { team: 'Hillcrest CC', target: 9 },
        },
      },
    },
  } as const;
  const atBreak = (over: Partial<CricketSetupModel>) =>
    model({ begins: 'innings', card: CARD, view: HILLCREST_BATS, ...over });
  const startInnings = () =>
    screen.getByRole('button', { name: en['scoring.cricket.setup.startInnings'] });
  const moreButton = () => screen.queryByRole('button', { name: en['scoring.cricket.key.more'] });

  it('the openers step is the order step under the break’s card, not the match card', () => {
    const actions = renderSetup(atBreak({ step: 'openers' }));
    const card = screen.getByTestId('break-card');
    expect(within(card).getByRole('heading', { name: 'Innings break' })).toBeTruthy();
    expect(screen.getByTestId('break-line').textContent).toBe(
      'Riverside CC 8/0 (2 ov) · Hillcrest CC need 9 off 12 balls',
    );
    expect(screen.queryByTestId('match-card')).toBeNull();
    expect(
      screen.getByRole('heading', {
        name: en['scoring.cricket.setup.order'].replace('{team}', 'Hillcrest CC'),
      }),
    ).toBeTruthy();
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.cricket.setup.next'] })),
    );
    expect(actions.setOpeners).toHaveBeenCalledWith({ striker: 'h1', nonStriker: 'h2' });
  });

  it('a break card with no line (the super over’s first) draws the title alone', () => {
    renderSetup(
      atBreak({
        step: 'openers',
        card: { title: { key: 'scoring.cricket.break.tied' }, line: null },
      }),
    );
    expect(screen.getByRole('heading', { name: 'Tied — super over' })).toBeTruthy();
    expect(screen.queryByTestId('break-line')).toBeNull();
  });

  it('ready, Start innings starts the innings, never the match; the card stays above the openers', () => {
    const actions = renderSetup(atBreak({ step: 'ready', ready: true, view: PICKED }));
    expect(screen.getByTestId('break-card')).toBeTruthy();
    expect(
      screen.getByText(
        en['scoring.cricket.setup.openers']
          .replace('{striker}', 'M. Chen')
          .replace('{nonStriker}', 'N. Patel'),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['scoring.start.confirm'] })).toBeNull();
    act(() => fireEvent.click(startInnings()));
    expect(
      [actions.startInnings, actions.start].map((spy) => vi.mocked(spy).mock.calls.length),
    ).toEqual([1, 0]);
  });

  it('Start innings waits for the bowler: greyed and pressless', () => {
    const actions = renderSetup(atBreak({ step: 'bowler', ready: false, view: PICKED }));
    expect(startInnings().getAttribute('aria-disabled')).toBe('true');
    act(() => fireEvent.click(startInnings()));
    expect(actions.startInnings).not.toHaveBeenCalled();
  });

  it('More stands in the foot while it offers something, and opens More', () => {
    const actions = renderSetup(atBreak({ step: 'openers' }), true);
    const more = moreButton();
    if (more === null) throw new Error('expected More');
    act(() => fireEvent.click(more));
    expect(actions.openMore).toHaveBeenCalledTimes(1);
  });

  it('More is in the bowler step’s foot too, beside Back', () => {
    renderSetup(atBreak({ step: 'ready', ready: true, view: PICKED }), true);
    expect(moreButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: en['scoring.cricket.setup.back'] })).toBeTruthy();
  });

  // The controller's carried item (Task 16 concern 3): Back, More and Start innings in one wrapping row broke at 320 dp
  // (Start innings is 200 dp at least). With two ghost buttons they share a row above it, so the break is not left to the
  // phone's width; with one (Back before the match) it still sits beside Start. `cricketFit.test.ts` measures both rows.
  it('Back and More share a row above Start innings, which has its own', () => {
    renderSetup(atBreak({ step: 'ready', ready: true, view: PICKED }), true);
    const back = screen.getByRole('button', { name: en['scoring.cricket.setup.back'] });
    const more = moreButton();
    if (more === null) throw new Error('expected More');
    // Each ghost button is half of a row (a cell of its own); the row holds both and not Start innings.
    const row = back.parentElement?.parentElement;
    expect(row?.contains(more)).toBe(true);
    expect(row?.contains(startInnings())).toBe(false);
  });

  it('Back alone stays beside Start, in one row', () => {
    renderSetup(atBreak({ step: 'ready', ready: true, view: PICKED }), false);
    const back = screen.getByRole('button', { name: en['scoring.cricket.setup.back'] });
    expect(back.parentElement?.contains(startInnings())).toBe(true);
  });

  it('no More when it offers nothing (a super over), and none before the match’s first ball', () => {
    renderSetup(atBreak({ step: 'openers' }), false);
    expect(moreButton()).toBeNull();
  });

  it('no More before the match’s first ball, even with something offered', () => {
    renderSetup(model({ step: 'order' }), true);
    expect(moreButton()).toBeNull();
  });
});
