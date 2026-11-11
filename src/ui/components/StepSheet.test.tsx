import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { StepSheet, type StepOption } from '@/ui/components/StepSheet';
import { colour, layout, plateInk, pressedOpacity } from '@/ui/theme/tokens';
import { declaredStyle } from '../../../test/declaredStyle';
import { pressIn, pressOut } from '../../../test/press';
import { edgeOf, fillOf, paintOf } from '../../../test/pressState';
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

// T19 M2: a held row is a fill that steps to `pressFill` (cream at 20%) with its label where it was, which on the
// picked row's lime plate would put night ink on a dark translucent fill. The picked row dims its plate as `Button`
// does, and stays lime. Every other row keeps the press fill. jsdom reads the style a held row carries; how a press
// reads on a phone, outdoors, is the device check's (plan Task 19, exit item 13).
describe('StepSheet rows held (T19 M2)', () => {
  const ROWS = [
    { id: 'chen', label: 'M. Chen', tone: 'standard' },
    { id: 'patel', label: 'N. Patel', tone: 'standard', selected: true },
    { id: 'okafor', label: 'B. Okafor', tone: 'standard', chosen: true },
    { id: 'end', label: en['scoring.sanction.disqualification'], tone: 'destructive' },
  ] as const;
  const row = (name: string) => screen.getByRole('button', { name });
  const label = (element: HTMLElement) => element.firstElementChild as HTMLElement;

  function renderRows() {
    renderWithPorts(
      <StepSheet
        title={en['scoring.sanction.title']}
        body={null}
        options={ROWS}
        cancelLabel={en['scoring.sheet.cancel']}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  }

  it('a held picked row dims its lime plate and keeps its night ink, and comes back on release', () => {
    renderRows();
    const resting = paintOf(row('N. Patel'));
    expect(resting.fill).toBe(fillOf(colour.lime));
    pressIn(row('N. Patel'));
    expect(paintOf(row('N. Patel'))).toEqual({ ...resting, opacity: String(pressedOpacity.plate) });
    expect(resting.opacity).not.toBe(String(pressedOpacity.plate)); // anti-vacuity: the press changed something
    expect(getComputedStyle(label(row('N. Patel'))).color).toBe(edgeOf(plateInk));
    pressOut(row('N. Patel'));
    expect(paintOf(row('N. Patel'))).toEqual(resting);
  });

  it.each(['M. Chen', 'B. Okafor', en['scoring.sanction.disqualification']])(
    'a held %s still takes the press fill, with no dim',
    (name) => {
      renderRows();
      const resting = paintOf(row(name));
      pressIn(row(name));
      const held = paintOf(row(name));
      expect(held.fill).toBe(fillOf(colour.pressFill));
      expect(held.opacity).toBe(resting.opacity);
      pressOut(row(name));
    },
  );
});

// The rows a sport's sheets need beyond a plain choice (S2-5 Task 10; owner ruling 85, every sport): a heading between
// groups that takes no press, a toggle that says whether it is on, and a list longer than the sheet that scrolls while
// the title and Cancel stay put. Every row that takes a tap has the lime border (ruling 85).
describe('StepSheet: headings, toggles, a long list (S2-5; ruling 85)', () => {
  function renderRows(rows: readonly StepOption[]) {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    renderWithPorts(
      <StepSheet
        title={en['scoring.sanction.title']}
        body={null}
        options={rows}
        cancelLabel={en['scoring.sheet.cancel']}
        onChoose={onChoose}
        onCancel={onCancel}
      />,
    );
    return { onChoose, onCancel };
  }

  const player = (n: number): StepOption => ({
    id: `p${n}`,
    label: `#${n} Player ${n}`,
    tone: 'standard',
  });
  const BENCH: StepOption = { id: 'bench', label: 'Bench', tone: 'standard', kind: 'heading' };

  it('a heading row takes no press', () => {
    const { onChoose } = renderRows([player(9), BENCH, player(12)]);
    expect(screen.queryByRole('button', { name: 'Bench' })).toBeNull();
    const heading = screen.getByRole('heading', { name: 'Bench' });
    act(() => fireEvent.click(heading));
    act(() => fireEvent.click(screen.getByText('Bench')));
    expect(onChoose).not.toHaveBeenCalled();
    expect(declaredStyle(heading, 'border-top-width')).not.toBe(`${layout.iconBorder}px`);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '#9 Player 9',
      '#12 Player 12',
      en['scoring.sheet.cancel'],
    ]);
  });

  it('a toggle reads checked to a screen reader, and hands its id back like any row', () => {
    const toggle = (checked: boolean): StepOption => ({
      id: 'penalty',
      label: 'Penalty',
      tone: 'standard',
      kind: 'toggle',
      checked,
    });
    const { onChoose } = renderRows([player(9), toggle(true)]);
    const on = screen.getByRole('switch', { name: 'Penalty' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(getComputedStyle(on).borderTopColor).toBe(edgeOf(colour.lime));
    act(() => fireEvent.click(on));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('penalty');
    renderRows([toggle(false)]);
    expect(
      screen.getAllByRole('switch', { name: 'Penalty' })[1]?.getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('sixteen rows scroll and Cancel stays on screen', () => {
    const rows = Array.from({ length: 16 }, (_, at) => player(at + 1));
    renderRows(rows);
    const list = screen.getByTestId('step-options');
    expect(declaredStyle(list, 'max-height')).toBe(`${layout.sheetListMax}px`);
    expect(within(list).getAllByRole('button')).toHaveLength(16);
    const cancel = screen.getByRole('button', { name: en['scoring.sheet.cancel'] });
    expect(list.contains(cancel)).toBe(false);
    expect(list.contains(screen.getByText(en['scoring.sanction.title']))).toBe(false);
    expect(
      within(screen.getByTestId('step-sheet')).getByRole('button', {
        name: en['scoring.sheet.cancel'],
      }),
    ).toBe(cancel);
  });
});
