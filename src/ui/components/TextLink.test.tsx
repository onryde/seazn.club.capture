import { act, render, screen } from '@testing-library/react';
import { StyleSheet, Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { TextLink } from '@/ui/components/TextLink';
import { colour, font } from '@/ui/theme/tokens';
import { pressIn, pressOut } from '../../../test/press';

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

  it('dims while held and comes back on release', () => {
    render(<TextLink label="Open-source licences" onPress={vi.fn()} />);
    const resting = getComputedStyle(link()).opacity;
    pressIn(link());
    const held = getComputedStyle(link()).opacity;
    expect(held).toBe('0.85');
    expect(held).not.toBe(resting); // anti-vacuity: the press changed something
    pressOut(link());
    expect(getComputedStyle(link()).opacity).toBe(resting);
  });
});
