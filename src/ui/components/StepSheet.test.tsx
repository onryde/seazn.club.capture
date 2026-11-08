import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { StepSheet } from '@/ui/components/StepSheet';
import { colour, layout } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const options = [
  { id: 'warning', label: en['scoring.sanction.warning'], tone: 'standard' },
  { id: 'disqualification', label: en['scoring.sanction.disqualification'], tone: 'destructive' },
] as const;

function renderSheet(body: string | null = 'A. Sharma') {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  renderWithPorts(
    <StepSheet
      title={en['scoring.sanction.title']}
      body={body}
      options={options}
      cancelLabel={en['scoring.sheet.cancel']}
      onChoose={onChoose}
      onCancel={onCancel}
    />,
  );
  return { onChoose, onCancel };
}

describe('StepSheet', () => {
  it('shows the step’s title, what is chosen so far, and each choice', () => {
    renderSheet();
    expect(screen.getByText(en['scoring.sanction.title'])).toBeTruthy();
    expect(screen.getByText('A. Sharma')).toBeTruthy();
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual([
      en['scoring.sanction.warning'],
      en['scoring.sanction.disqualification'],
      en['scoring.sheet.cancel'],
    ]);
  });

  it('hands the chosen id back', () => {
    const { onChoose, onCancel } = renderSheet();
    act(() =>
      fireEvent.click(
        screen.getByRole('button', { name: en['scoring.sanction.disqualification'] }),
      ),
    );
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('disqualification');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('closes on Cancel and on a tap on the dim, with nothing chosen', () => {
    const { onChoose, onCancel } = renderSheet();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })));
    const dim = screen.getByTestId('step-sheet').previousElementSibling;
    if (!(dim instanceof HTMLElement)) throw new Error('no dim');
    act(() => fireEvent.click(dim));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
    expect(dim.getAttribute('aria-hidden')).toBe('true');
  });

  it('is modal to a screen reader (the web’s half: native reads accessibilityViewIsModal, a device check)', () => {
    renderSheet();
    expect(screen.getByTestId('step-sheet').getAttribute('aria-modal')).toBe('true');
  });

  it('draws a destructive choice in caution', () => {
    renderSheet(null);
    const edge = getComputedStyle(
      screen.getByRole('button', { name: en['scoring.sanction.disqualification'] }),
    ).borderTopColor;
    expect(edge).toBe(edgeOf(colour.caution));
    expect(screen.queryByText('A. Sharma')).toBeNull();
  });
});

// Owner rulings 82 and 85 (2026-11-07): in every sport's sheets a row that takes a tap has a lime border, the chosen one a
// heavier lime border on surface, and one that cannot be chosen now is greyed with its reason; a destructive row keeps
// the caution border (the controller's ruling F29, 2026-11-08). jsdom reads the tokens a row's style carries; how the
// colours read on a phone is the device check's (plan Task 19, exit item 13).
describe('StepSheet rows (rulings 82, 85)', () => {
  // A made-up step: the reason is the caller's words, not this component's.
  const ROWS = [
    { id: 'chen', label: 'M. Chen', tone: 'standard' },
    { id: 'patel', label: 'N. Patel', tone: 'standard', chosen: true },
    {
      id: 'murphy',
      label: 'W. Murphy',
      tone: 'standard',
      disabled: true,
      note: 'Bowled the last over',
    },
    { id: 'end', label: en['scoring.sanction.disqualification'], tone: 'destructive' },
  ] as const;

  function renderRows() {
    const onChoose = vi.fn();
    renderWithPorts(
      <StepSheet
        title={en['scoring.sanction.title']}
        body={null}
        options={ROWS}
        cancelLabel={en['scoring.sheet.cancel']}
        onChoose={onChoose}
        onCancel={vi.fn()}
      />,
    );
    return { onChoose };
  }
  const row = (name: string | RegExp) => screen.getByRole('button', { name });
  const label = (element: HTMLElement) => element.firstElementChild as HTMLElement;

  it('a row that takes a tap has a lime border', () => {
    renderRows();
    const style = getComputedStyle(row('M. Chen'));
    expect([style.borderTopColor, style.borderTopWidth]).toEqual([
      edgeOf(colour.lime),
      `${layout.iconBorder}px`,
    ]);
    expect(getComputedStyle(label(row('M. Chen'))).color).toBe(edgeOf(colour.ink));
    expect(row('M. Chen').getAttribute('aria-selected')).not.toBe('true');
  });

  it('a chosen row has the heavier lime border on surface, said selected, its label where it was', () => {
    renderRows();
    const chosen = getComputedStyle(row('N. Patel'));
    expect([chosen.borderTopColor, chosen.borderTopWidth, chosen.backgroundColor]).toEqual([
      edgeOf(colour.lime),
      `${layout.iconBorderOn}px`,
      fillOf(colour.surface),
    ]);
    expect(row('N. Patel').getAttribute('aria-selected')).toBe('true');
    // The border grows inward by one; the padding gives that back, so the label does not move.
    const plain = getComputedStyle(row('M. Chen'));
    const inset = (style: CSSStyleDeclaration) =>
      Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
    expect(inset(chosen)).toBe(inset(plain));
  });

  it('a disabled row ignores a press and says its reason', () => {
    const { onChoose } = renderRows();
    const off = row(/W\. Murphy/);
    act(() => fireEvent.click(off));
    expect(onChoose).not.toHaveBeenCalled();
    expect(off.getAttribute('aria-disabled')).toBe('true');
    // The label, then the reason on a second line: a screen reader hears both, the eye reads both greyed.
    const [name, reason] = [...off.children] as HTMLElement[];
    expect([name?.textContent, reason?.textContent]).toEqual(['W. Murphy', 'Bowled the last over']);
    expect(off.textContent).toBe('W. MurphyBowled the last over');
    expect(getComputedStyle(off).borderTopColor).toBe(edgeOf(colour.ink3));
    expect(getComputedStyle(name as HTMLElement).color).toBe(edgeOf(colour.ink3));
    expect(getComputedStyle(reason as HTMLElement).color).toBe(edgeOf(colour.ink3));
  });

  it('a destructive row stays caution', () => {
    renderRows();
    const end = row(en['scoring.sanction.disqualification']);
    expect(getComputedStyle(end).borderTopColor).toBe(edgeOf(colour.caution));
    expect(getComputedStyle(label(end)).color).toBe(edgeOf(colour.caution));
  });

  // Batch 3 fix round 1, M1: a note is drawn whenever a row has one, not only on a disabled row (a batter retired not
  // out can still come back in: the row takes the tap and says why it reads as it does).
  it('a row that takes a tap and has a note shows it on a second line, and hands its id back', () => {
    const onChoose = vi.fn();
    renderWithPorts(
      <StepSheet
        title={en['scoring.sanction.title']}
        body={null}
        options={[{ id: 'okafor', label: 'B. Okafor', tone: 'standard', note: 'Retired' }]}
        cancelLabel={en['scoring.sheet.cancel']}
        onChoose={onChoose}
        onCancel={vi.fn()}
      />,
    );
    const okafor = row(/B\. Okafor/);
    expect([...okafor.children].map((line) => line.textContent)).toEqual(['B. Okafor', 'Retired']);
    expect(okafor.getAttribute('aria-disabled')).not.toBe('true');
    expect(getComputedStyle(okafor).borderTopColor).toBe(edgeOf(colour.lime));
    act(() => fireEvent.click(okafor));
    expect(onChoose.mock.calls).toEqual([['okafor']]);
  });

  it('a row with no reason has one line, and every row that takes a tap hands its id back', () => {
    const { onChoose } = renderRows();
    expect(row('M. Chen').children).toHaveLength(1);
    act(() => fireEvent.click(row('M. Chen')));
    act(() => fireEvent.click(row('N. Patel')));
    act(() => fireEvent.click(row(en['scoring.sanction.disqualification'])));
    expect(onChoose.mock.calls).toEqual([['chen'], ['patel'], ['end']]);
  });
});
