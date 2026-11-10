import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CricketStep } from '@/domain/scoring/cricketTypes';
import en from '@/i18n/en.json';
import { CricketStandingSheet, CricketStepSheet } from '@/ui/screens/CricketSheets';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A cricket sheet's step as the screen draws it (S2-4 plan Task 11): a step written out here, never built by the domain
// code it is drawn from. Which step comes when, and what a choice records, is the hook's and the routed keys' tests'
// (`useCricketSheets.test.tsx`, `CricketKeys.test.tsx`). The lime borders are measured here; how they look is the phone's.

const STEP: CricketStep = {
  name: 'test',
  title: { key: 'scoring.cricket.key.noBall' },
  body: null,
  options: [
    { id: 'bat.0', label: '0', tone: 'standard', group: 'scoring.cricket.extras.bat' },
    { id: 'bat.4', label: '4', tone: 'standard', group: 'scoring.cricket.extras.bat' },
    { id: 'ran.1', label: '1', tone: 'standard', group: 'scoring.cricket.extras.ran' },
    { id: 'kaur', label: 'V. Kaur', tone: 'standard', chosen: true },
    {
      id: 'murphy',
      label: 'W. Murphy',
      tone: 'standard',
      disabled: true,
      note: { key: 'scoring.cricket.board.freeHit' },
    },
    { id: 'out', label: { key: 'scoring.cricket.extras.out' }, tone: 'standard' },
  ],
};

function renderSheet(step: CricketStep = STEP) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  const onDim = vi.fn();
  renderWithPorts(
    <CricketStepSheet step={step} onChoose={onChoose} onDim={onDim} onCancel={onCancel} />,
  );
  return { onChoose, onCancel, onDim };
}

const sheet = () => screen.getByTestId('step-sheet');
const button = (name: string) => screen.getByRole('button', { name });
/** The last `count` buttons of the sheet, by their names. */
const lastButtons = (count: number) =>
  within(sheet())
    .getAllByRole('button')
    .map((one) => one.getAttribute('aria-label') ?? one.textContent)
    .slice(-count);

describe('CricketStepSheet', () => {
  it('draws the title, each group as a row of keys under its name, then the full rows and Cancel', () => {
    renderSheet();
    expect(
      within(sheet()).getByRole('heading', { name: en['scoring.cricket.key.noBall'] }),
    ).toBeTruthy();
    const bat = screen.getByTestId('group-scoring.cricket.extras.bat');
    expect(within(bat).getByText(en['scoring.cricket.extras.bat'])).toBeTruthy();
    expect(
      within(bat)
        .getAllByRole('button')
        .map((key) => key.getAttribute('aria-label')),
    ).toEqual(['Off the bat: 0', 'Off the bat: 4']);
    expect(
      within(sheet())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual([
      'Off the bat: 0',
      'Off the bat: 4',
      'Runs run: 1',
      'V. Kaur',
      'W. MurphyFree hit',
      '+ Out',
      en['scoring.sheet.cancel'],
    ]);
  });

  it('a choice sends its id; a greyed row takes no tap and says why', () => {
    const { onChoose } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Off the bat: 4' })));
    act(() => fireEvent.click(screen.getByRole('button', { name: '+ Out' })));
    const murphy = screen.getByRole('button', { name: /W\. Murphy/ });
    expect(murphy.getAttribute('aria-disabled')).toBe('true');
    expect(within(murphy).getByText(en['scoring.cricket.board.freeHit'])).toBeTruthy();
    act(() => fireEvent.click(murphy));
    expect(onChoose.mock.calls).toEqual([['bat.4'], ['out']]);
  });

  it('keys and rows that take a tap are lime; the chosen row the heavier border, said selected (ruling 82)', () => {
    renderSheet();
    const key = screen.getByRole('button', { name: 'Runs run: 1' });
    const kaur = screen.getByRole('button', { name: 'V. Kaur' });
    expect(getComputedStyle(key).borderTopColor).toBe(edgeOf(colour.lime));
    expect([getComputedStyle(kaur).borderTopWidth, kaur.getAttribute('aria-selected')]).toEqual([
      `${layout.iconBorderOn}px`,
      'true',
    ]);
  });

  // T19 D11 (the controller's ruling): the lime plate is for a list whose tap only picks and a button confirms. A
  // sheet's tap acts, so its suggested row keeps the heavier lime border on surface, its name in cream.
  it('a tap-to-act sheet’s suggested row is never the lime plate', () => {
    renderSheet();
    const kaur = screen.getByRole('button', { name: 'V. Kaur' });
    expect([
      getComputedStyle(kaur).backgroundColor,
      getComputedStyle(within(kaur).getByText('V. Kaur')).color,
    ]).toEqual([fillOf(colour.surface), edgeOf(colour.ink)]);
  });

  // Batch 4 review I4: the dim is clicked here (it was only promised), and what it does is the caller's (`onDim`).
  it('Cancel and the dim each ask to close, and choose nothing', () => {
    const { onChoose, onCancel, onDim } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDim).not.toHaveBeenCalled();
    act(() => fireEvent.click(screen.getByTestId('step-dim')));
    expect(onDim).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  // Batch 4 review C1 and I4: the standing over-end sheet's dim covers the board, the top bar and the keys, and a touch on
  // it must take nothing back. Its way back is the button, named by the caller.
  it('a sheet that stands by itself: its dim takes no tap, its own button is the way back', () => {
    const onChoose = vi.fn();
    const onUndo = vi.fn();
    renderWithPorts(
      <CricketStepSheet
        step={STEP}
        onChoose={onChoose}
        onDim={null}
        onCancel={onUndo}
        cancelKey="scoring.pad.undo"
      />,
    );
    expect(screen.queryByRole('button', { name: en['scoring.sheet.cancel'] })).toBeNull();
    act(() => fireEvent.click(screen.getByTestId('step-dim')));
    expect(onUndo).not.toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.pad.undo'] })));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('a sheet that stands by itself with no way back has no button for one, and its dim takes no tap', () => {
    const onChoose = vi.fn();
    renderWithPorts(
      <CricketStepSheet step={STEP} onChoose={onChoose} onDim={null} onCancel={null} />,
    );
    const buttons = within(sheet())
      .getAllByRole('button')
      .map((one) => one.textContent);
    expect(buttons).not.toContain(en['scoring.sheet.cancel']);
    expect(buttons).not.toContain(en['scoring.pad.undo']);
    act(() => fireEvent.click(screen.getByTestId('step-dim')));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('buttons beside the way back are drawn in order above it, and each asks for its own', () => {
    const [onPlayers, onMore, onUndo] = [vi.fn(), vi.fn(), vi.fn()];
    renderWithPorts(
      <CricketStepSheet
        step={STEP}
        onChoose={vi.fn()}
        onDim={null}
        onCancel={onUndo}
        cancelKey="scoring.pad.undo"
        also={[
          { label: 'scoring.cricket.players.title', onPress: onPlayers },
          { label: 'scoring.cricket.key.more', onPress: onMore },
        ]}
      />,
    );
    expect(lastButtons(3)).toEqual([
      en['scoring.cricket.players.title'],
      en['scoring.cricket.key.more'],
      en['scoring.pad.undo'],
    ]);
    act(() => fireEvent.click(button(en['scoring.cricket.key.more'])));
    expect([onPlayers, onMore, onUndo].map((one) => one.mock.calls.length)).toEqual([0, 1, 0]);
    act(() => fireEvent.click(button(en['scoring.cricket.players.title'])));
    expect([onPlayers, onMore, onUndo].map((one) => one.mock.calls.length)).toEqual([1, 1, 0]);
  });

  it('a step with a line under its title draws it', () => {
    renderSheet({ ...STEP, body: { key: 'scoring.cricket.wicket.how' } });
    expect(within(sheet()).getByText(en['scoring.cricket.wicket.how'])).toBeTruthy();
  });
});

// Batch 4 review C1, I3, M1 (the controller's rulings): the over-end sheet, which no key opened. Its dim takes no tap; its
// way back is Undo, the kit's word; Players and More are on it, since an over's end is where a scorer declares, stops for
// rain, closes for time or retires a batter, and "Nobody can bowl this over" would dead-end the pad without them.
describe('CricketStandingSheet', () => {
  function renderStanding(over: { readonly undo?: boolean; readonly more?: boolean } = {}) {
    const calls = { onChoose: vi.fn(), onUndo: vi.fn(), onPlayers: vi.fn(), onMore: vi.fn() };
    renderWithPorts(<CricketStandingSheet step={STEP} undo more {...over} {...calls} />);
    return calls;
  }

  it('draws Players, More and Undo, in that order, under its choices, and no Cancel', () => {
    renderStanding();
    expect(lastButtons(3)).toEqual([
      en['scoring.cricket.players.title'],
      en['scoring.cricket.key.more'],
      en['scoring.pad.undo'],
    ]);
    expect(screen.queryByRole('button', { name: en['scoring.sheet.cancel'] })).toBeNull();
  });

  it('each button asks for its own, and a choice sends its id', () => {
    const { onChoose, onUndo, onPlayers, onMore } = renderStanding();
    act(() => fireEvent.click(button(en['scoring.cricket.players.title'])));
    act(() => fireEvent.click(button(en['scoring.cricket.key.more'])));
    act(() => fireEvent.click(button(en['scoring.pad.undo'])));
    act(() => fireEvent.click(button('Off the bat: 4')));
    expect([onPlayers, onMore, onUndo].map((one) => one.mock.calls.length)).toEqual([1, 1, 1]);
    expect(onChoose.mock.calls).toEqual([['bat.4']]);
  });

  it('its dim takes no tap: a touch on it asks for nothing', () => {
    const { onChoose, onUndo, onPlayers, onMore } = renderStanding();
    act(() => fireEvent.click(screen.getByTestId('step-dim')));
    expect([onChoose, onUndo, onPlayers, onMore].map((one) => one.mock.calls.length)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('More is not drawn when the engine takes nothing more now; Undo not when this phone has nothing to take back', () => {
    renderStanding({ more: false, undo: false });
    expect(lastButtons(1)).toEqual([en['scoring.cricket.players.title']]);
    expect(screen.queryByRole('button', { name: en['scoring.cricket.key.more'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['scoring.pad.undo'] })).toBeNull();
  });

  it('with More but no Undo, More is last; with Undo but no More, Players then Undo', () => {
    const { unmount } = renderWithPorts(
      <CricketStandingSheet
        step={STEP}
        undo={false}
        more
        onChoose={vi.fn()}
        onUndo={vi.fn()}
        onPlayers={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    expect(lastButtons(2)).toEqual([
      en['scoring.cricket.players.title'],
      en['scoring.cricket.key.more'],
    ]);
    unmount();
    renderStanding({ more: false });
    expect(lastButtons(2)).toEqual([en['scoring.cricket.players.title'], en['scoring.pad.undo']]);
  });
});
