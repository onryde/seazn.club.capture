import { act, render, screen } from '@testing-library/react';
import { StyleSheet, Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { TextLink } from '@/ui/components/TextLink';
import { colour, font } from '@/ui/theme/tokens';
import { pressIn, pressOut } from '../../../test/press';
import { layoutOf, pressTwice, unmountWhileHeld } from '../../../test/pressState';

const PAINT = StyleSheet.create({ ink3: { color: colour.ink3 }, ink2: { color: colour.ink2 } });
function painted(style: { color: string }): string {
  const reference = render(<Text style={style}>x</Text>);
  const read = getComputedStyle(reference.container.firstElementChild as Element).color;
  reference.unmount();
  return read;
}
/** What the cascade gives an element that is given no background at all. */
function unpainted(): string {
  const reference = render(<Text>x</Text>);
  const read = getComputedStyle(reference.container.firstElementChild as Element).backgroundColor;
  reference.unmount();
  return read;
}

const link = () => screen.getByRole('button', { name: 'Open-source licences' });

// The owner's Settings board draws "Open-source licences" as a bare underlined line in the muted violet, 12 dp, no
// outline. It is still a thing a thumb must hit on a tripod, and TalkBack reads a node's bounds: the line is the
// label of a 48 dp tall button (never a hit slop, which is not a bound).
describe('TextLink (the board’s underlined link)', () => {
  it('is a 48 dp tall button that hugs its line and draws no outline of its own', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    const style = getComputedStyle(link());
    expect(style.minHeight).toBe('48px');
    expect(style.justifyContent).toBe('center'); // the line sits in the middle of its 48
    expect(style.alignSelf).toBe('flex-start'); // so the target is the line's width, not the whole column
    expect([style.borderTopWidth, style.borderLeftWidth]).toEqual(['0px', '0px']);
    expect(style.backgroundColor).toBe(unpainted()); // nothing filled behind it
  });

  it('sets the label in Geist 500 at 12 dp on 16, in ink3, underlined', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    const label = getComputedStyle(screen.getByText('Open-source licences'));
    expect([label.fontSize, label.lineHeight, label.fontFamily]).toEqual([
      '12px',
      '16px',
      font.bodyMedium,
    ]);
    expect(label.color).toBe(painted(PAINT.ink3));
    expect(label.color).not.toBe(painted(PAINT.ink2));
    expect(label.textDecorationLine).toBe('underline');
  });

  // One tab stop: the button itself is focusable, and the line inside it is not a second one.
  it('is one focusable, the link, and nothing inside it', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    expect(link().getAttribute('tabindex')).toBe('0');
    expect(link().querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(link().children).toHaveLength(1); // anti-vacuity: the line that must not be focusable is there
  });

  it('presses once, and says whether what it opens is open', () => {
    const onPress = vi.fn();
    const view = render(
      <TextLink label="Open-source licences" onPress={onPress} expanded={false} />,
    );
    expect(link().getAttribute('aria-expanded')).toBe('false');
    act(() => link().click());
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<TextLink label="Open-source licences" onPress={onPress} expanded />);
    expect(link().getAttribute('aria-expanded')).toBe('true');
  });

  it('says nothing about being expanded when it opens nothing', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    expect(link().getAttribute('aria-expanded')).toBeNull();
  });

  // The controller's ruling (Batch 17; the owner has not ruled): a link that is already underlined, as this one is,
  // dims to 0.6 while held (the outlined buttons fill instead). Its line stays underlined and ink3, and nothing moves.
  it('dims to 0.6 while held, still underlined in ink3, and comes back on release', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    const resting = getComputedStyle(link()).opacity;
    pressIn(link());
    const held = getComputedStyle(link()).opacity;
    expect(held).toBe('0.6');
    expect(held).not.toBe(resting); // anti-vacuity: the press changed something
    const line = getComputedStyle(screen.getByText('Open-source licences'));
    expect([line.textDecorationLine, line.color]).toEqual(['underline', painted(PAINT.ink3)]);
    pressOut(link());
    expect(getComputedStyle(link()).opacity).toBe(resting);
  });

  it('a press never moves the box', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    const resting = layoutOf(link());
    expect(resting['min-height']).toBe('48px'); // anti-vacuity: the box is read
    pressIn(link());
    expect(layoutOf(link())).toEqual(resting);
    expect(getComputedStyle(link()).opacity).toBe('0.6'); // and the press did change something
    pressOut(link());
  });

  it('a second press, and a press while held, find nothing stuck', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    const resting = getComputedStyle(link()).opacity;
    expect(pressTwice(link, () => getComputedStyle(link()).opacity)).toEqual([
      resting,
      '0.6',
      resting,
      '0.6',
      resting,
    ]);
  });

  it('held and unmounted: no timer is left and nothing fires', () => {
    const onPress = vi.fn();
    const view = render(<TextLink label="Open-source licences" onPress={onPress} />);
    expect(unmountWhileHeld(link, view.unmount)).toEqual({ held: 1, left: 0 });
    expect(onPress).not.toHaveBeenCalled();
  });
});
