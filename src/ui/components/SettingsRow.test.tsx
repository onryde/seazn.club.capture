import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/ui/components/SettingsRow';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { fillOf, edgeOf, paintOf } from '../../../test/pressState';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

const style = (element: Element) => getComputedStyle(element);

describe('SettingsRow: a label at the left, a value or a control at the right', () => {
  it('a row with no action is one line of text, not a button', () => {
    renderWithPorts(<SettingsRow label="Language" value="English" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
  });

  it('a row with an action is a button named by its label and value, whose press is its own', () => {
    const onPress = vi.fn();
    renderWithPorts(<SettingsRow label="Battery" value="Unrestricted" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Battery · Unrestricted' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a row with an action and no value is named by its label alone', () => {
    renderWithPorts(<SettingsRow label="Share record" onPress={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Share record' })).toBeTruthy();
  });

  it('draws a chevron for an action, hidden from a screen reader, and none for a static row', () => {
    renderWithPorts(
      <>
        <SettingsRow label="Share record" onPress={vi.fn()} />
        <SettingsRow label="Static" value="x" />
      </>,
    );
    const chevrons = screen.getAllByTestId('row-chevron');
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(within(screen.getByRole('button')).getByTestId('row-chevron')).toBe(chevrons[0]);
  });

  it('a disabled action is announced disabled and does nothing when pressed', () => {
    const onPress = vi.fn();
    renderWithPorts(<SettingsRow label="Battery" onPress={onPress} disabled />);
    const row = screen.getByRole('button', { name: 'Battery' });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('says it is expanded, or not, when it opens a list; and a plain action says neither', () => {
    const { rerender } = renderWithPorts(
      <SettingsRow label="Language" value="English" onPress={vi.fn()} expanded={false} />,
    );
    const row = () => screen.getByRole('button', { name: 'Language · English' });
    expect(row().getAttribute('aria-expanded')).toBe('false');
    rerender(<SettingsRow label="Language" value="English" onPress={vi.fn()} expanded />);
    expect(row().getAttribute('aria-expanded')).toBe('true');
    rerender(<SettingsRow label="Language" value="English" onPress={vi.fn()} />);
    expect(row().getAttribute('aria-expanded')).toBeNull();
  });

  // The chevron is the row's only sign that a list is open below it: it points right shut, down open.
  it('turns its chevron down while the row has its list open, and back when it shuts', () => {
    const { rerender } = renderWithPorts(
      <SettingsRow label="Language" value="English" onPress={vi.fn()} expanded={false} />,
    );
    const turn = () => style(screen.getByTestId('row-chevron')).transform;
    expect(turn()).not.toContain('rotate(90deg)');
    rerender(<SettingsRow label="Language" value="English" onPress={vi.fn()} expanded />);
    expect(turn()).toContain('rotate(90deg)');
    rerender(<SettingsRow label="Language" value="English" onPress={vi.fn()} expanded={false} />);
    expect(turn()).not.toContain('rotate(90deg)');
  });

  it('a switch row is a switch with its state said, and its pill is a picture of it', () => {
    const onPress = vi.fn();
    const { rerender } = renderWithPorts(
      <SettingsRow label="Automatic" checked={false} onPress={onPress} />,
    );
    const row = () => screen.getByRole('switch', { name: 'Automatic' });
    expect(row().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(row());
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<SettingsRow label="Automatic" checked onPress={onPress} />);
    expect(row().getAttribute('aria-checked')).toBe('true');
    expect(within(row()).getByTestId('switch-track')).toBeTruthy();
    // The pill replaces the chevron: a switch does not "open" anything.
    expect(screen.queryByTestId('row-chevron')).toBeNull();
  });

  it('a control at the right makes the row a plain container: the control is the only thing pressed', () => {
    const tap = vi.fn();
    renderWithPorts(
      <SettingsRow label="Controls on the" right={<Text variant="control">Pair</Text>} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Controls on the').parentElement?.parentElement).toBeTruthy();
    expect(screen.getByText('Pair')).toBeTruthy();
    expect(tap).not.toHaveBeenCalled();
  });

  it('shows a helper as one line under the label, in the small ink2 role, only when there is one', () => {
    const { rerender } = renderWithPorts(
      <SettingsRow label="Battery" onPress={vi.fn()} helper="Battery → Unrestricted" />,
    );
    const helper = screen.getByText('Battery → Unrestricted');
    expect(style(helper).fontSize).toBe(`${typeScale.controlSmall.fontSize}px`);
    expect(style(helper).color).toBe(edgeOf(colour.ink2));
    // The label's text and the helper are one column, the helper under.
    expect(helper.parentElement).toBe(screen.getByText('Battery').parentElement);
    rerender(<SettingsRow label="Battery" onPress={vi.fn()} helper={null} />);
    expect(screen.queryByText('Battery → Unrestricted')).toBeNull();
  });

  // jsdom has no hint (react-native-web drops `accessibilityHint`), and a screen reader that reads a name does not read the
  // words inside it, so the helper, which says why a row is off or what to do, is in the name.
  it('a helper is in the button’s name, so a screen reader hears why it is off', () => {
    renderWithPorts(
      <SettingsRow label="Send" onPress={vi.fn()} helper="Scan a stream code first" disabled />,
    );
    expect(screen.getByRole('button', { name: 'Send · Scan a stream code first' })).toBeTruthy();
  });

  it('a value and a helper are both in the name, value first', () => {
    renderWithPorts(
      <SettingsRow
        label="Battery"
        value="Optimized"
        onPress={vi.fn()}
        helper="Battery → Unrestricted"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Battery · Optimized · Battery → Unrestricted' }),
    ).toBeTruthy();
  });

  it('every row is the same height at least: 56, and grows for a helper or a wrapped label', () => {
    renderWithPorts(
      <>
        <SettingsRow label="One" value="x" />
        <SettingsRow label="Two" onPress={vi.fn()} helper="help" />
        <SettingsRow label="Three" checked onPress={vi.fn()} />
      </>,
    );
    for (const row of [
      screen.getByText('One').parentElement?.parentElement,
      screen.getByRole('button'),
      screen.getByRole('switch'),
    ]) {
      expect(style(row as Element).minHeight).toBe(`${layout.settingsRow}px`);
    }
    expect(layout.settingsRow).toBe(56);
  });

  it('a value reads in caution when the row says so, else in ink2', () => {
    renderWithPorts(
      <>
        <SettingsRow label="A" value="Fine" />
        <SettingsRow label="B" value="Worry" tone="caution" />
      </>,
    );
    expect(style(screen.getByText('Fine')).color).toBe(edgeOf(colour.ink2));
    expect(style(screen.getByText('Worry')).color).toBe(edgeOf(colour.caution));
  });

  it('a held action row takes the press fill and no more: its box does not move', () => {
    renderWithPorts(<SettingsRow label="Share record" onPress={vi.fn()} />);
    const row = screen.getByRole('button', { name: 'Share record' });
    const resting = { paint: paintOf(row), height: style(row).minHeight };
    expect(resting.paint.fill).not.toBe(fillOf(colour.pressFill));
    pressIn(row);
    expect(paintOf(row).fill).toBe(fillOf(colour.pressFill));
    expect(style(row).minHeight).toBe(resting.height);
    pressOut(row);
    expect(paintOf(row)).toEqual(resting.paint);
  });

  it('a disabled row dims its words and shows no press fill', () => {
    renderWithPorts(<SettingsRow label="Battery" onPress={vi.fn()} disabled />);
    const row = screen.getByRole('button', { name: 'Battery' });
    const resting = paintOf(row);
    pressIn(row);
    expect(paintOf(row)).toEqual(resting);
    pressOut(row);
    expect(style(screen.getByText('Battery')).color).toBe(edgeOf(colour.ink3));
  });
});

describe('SettingsGroup and SettingsSection', () => {
  it('a group is one card on the surface ground whose rows are parted by hairlines, none above the first', () => {
    renderWithPorts(
      <SettingsGroup>
        <SettingsRow label="One" value="1" />
        <SettingsRow label="Two" value="2" />
        <SettingsRow label="Three" value="3" />
      </SettingsGroup>,
    );
    const card = screen.getByTestId('settings-group');
    expect(style(card).backgroundColor).toBe(fillOf(colour.surface));
    expect(style(card).borderTopLeftRadius).toBe(`${radius.card}px`);
    expect(['hidden']).toContain(style(card).overflowX);
    // Three rows, two dividers between them: the rule's own colour is the hairline.
    const dividers = screen.getAllByTestId('settings-divider');
    expect(dividers).toHaveLength(2);
    expect(style(dividers[0] as Element).backgroundColor).toBe(fillOf(colour.rule));
    expect(card.children).toHaveLength(5);
    expect((card.firstElementChild as HTMLElement).dataset.testid).not.toBe('settings-divider');
    expect((card.lastElementChild as HTMLElement).dataset.testid).not.toBe('settings-divider');
  });

  it('a group of one row has no divider, and a group with a missing child draws none for it', () => {
    renderWithPorts(
      <>
        <SettingsGroup>
          <SettingsRow label="Only" value="1" />
        </SettingsGroup>
        <SettingsGroup>
          {null}
          <SettingsRow label="A" value="1" />
          {false}
          <SettingsRow label="B" value="2" />
        </SettingsGroup>
      </>,
    );
    expect(screen.getAllByTestId('settings-divider')).toHaveLength(1);
  });

  it('a section is a heading in the display face with its group under it, and no sentence', () => {
    renderWithPorts(
      <SettingsSection title="General">
        <SettingsRow label="One" value="1" />
      </SettingsSection>,
    );
    const heading = screen.getByRole('heading', { name: 'General' });
    expect(style(heading).fontFamily).toContain('BarlowCondensed');
    expect(style(heading).textTransform).toBe('uppercase');
    expect(heading.parentElement?.children).toHaveLength(2);
    expect(heading.nextElementSibling).toBe(screen.getByTestId('settings-group'));
  });
});
