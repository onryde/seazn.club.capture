import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CricketStep } from '@/domain/scoring/cricketTypes';
import en from '@/i18n/en.json';
import { CricketStepSheet } from '@/ui/screens/CricketSheets';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
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
  renderWithPorts(<CricketStepSheet step={step} onChoose={onChoose} onCancel={onCancel} />);
  return { onChoose, onCancel };
}

const sheet = () => screen.getByTestId('step-sheet');

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

  it('Cancel and the dim cancel, and choose nothing', () => {
    const { onChoose, onCancel } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('a step with a line under its title draws it', () => {
    renderSheet({ ...STEP, body: { key: 'scoring.cricket.wicket.how' } });
    expect(within(sheet()).getByText(en['scoring.cricket.wicket.how'])).toBeTruthy();
  });
});
