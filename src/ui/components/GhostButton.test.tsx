import { act, render, screen, within } from '@testing-library/react';
import { StyleSheet, Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { GhostButton } from '@/ui/components/GhostButton';
import { colour, font } from '@/ui/theme/tokens';
import { pressIn, pressOut } from '../../../test/press';

// The text colour a style gives, read the way the layout tests read colours: a colour literal is banned in a test, and
// a value read back from the component would prove the component equals itself.
const PAINT = StyleSheet.create({ ink2: { color: colour.ink2 }, ink: { color: colour.ink } });
function painted(style: { color: string }): string {
  const reference = render(<Text style={style}>x</Text>);
  const read = getComputedStyle(reference.container.firstElementChild as Element).color;
  reference.unmount();
  return read;
}

const button = () => screen.getByRole('button', { name: 'Share record' });
const boxOf = () => within(button()).queryByTestId('ghost-box');

describe('GhostButton (the secondary action)', () => {
  it('is one 48 dp box that is its own outline, with no inner box', () => {
    render(<GhostButton label="Share record" onPress={vi.fn()} />);
    const style = getComputedStyle(button());
    expect(style.minHeight).toBe('48px'); // the tripod target (AGENTS §5)
    expect([style.paddingLeft, style.borderLeftWidth]).toEqual(['16px', '1px']);
    expect(boxOf()).toBeNull();
  });

  // The owner's Settings board draws Share record a 37 dp box (measured: its outline's two rules are 35.9 dp apart, plus
  // the 1 dp stroke), with 12 dp text and about 11 dp of padding at the sides. A tripod thumb still needs 48, and TalkBack
  // reads a node's bounds (a hit slop is not one), so the button itself is the 48 dp target and the outline is a box
  // drawn inside it.
  describe('compact: the board’s smaller box inside a 48 dp target', () => {
    it('is a 48 dp button holding a 37 dp outlined box, the label centred in it', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact />);
      const target = getComputedStyle(button());
      expect(target.minHeight).toBe('48px');
      expect([target.alignItems, target.justifyContent]).toEqual(['center', 'center']);
      expect([target.borderTopWidth, target.paddingLeft]).toEqual(['0px', '0px']); // the target draws nothing itself
      const box = getComputedStyle(boxOf() as HTMLElement);
      expect(box.minHeight).toBe('37px');
      expect([box.paddingLeft, box.paddingRight]).toEqual(['11px', '11px']);
      expect([box.borderTopWidth, box.borderLeftWidth]).toEqual(['1px', '1px']);
      expect(box.flexShrink).toBe('1'); // the box is what gives when the cell is narrow, its label wrapping
      expect(box.borderTopLeftRadius).toBe('12px');
      expect([box.alignItems, box.justifyContent]).toEqual(['center', 'center']);
    });

    it('sets its label in Geist 500 at 12 dp on 16, in ink2, as the board does', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact />);
      const label = getComputedStyle(within(boxOf() as HTMLElement).getByText('Share record'));
      expect([label.fontSize, label.lineHeight, label.fontFamily]).toEqual([
        '12px',
        '16px',
        font.bodyMedium,
      ]);
      expect(label.color).toBe(painted(PAINT.ink2));
      expect(label.color).not.toBe(painted(PAINT.ink));
    });

    it('is still one button: pressed anywhere in the 48 dp it presses once', () => {
      const onPress = vi.fn();
      render(<GhostButton label="Share record" onPress={onPress} compact />);
      act(() => button().click());
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('says when it shows and hides something, as the regular one does', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact expanded />);
      expect(button().getAttribute('aria-expanded')).toBe('true');
    });
  });

  // Pressed dims the outline (as Button and the icon buttons do). Held and released, for both forms, so that the
  // style of each press state is read and not only the resting one.
  describe.each([
    ['regular', false],
    ['compact', true],
  ] as const)('%s: pressed state', (_form, compact) => {
    it('dims while held and comes back on release', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact={compact} />);
      const resting = getComputedStyle(button()).opacity;
      pressIn(button());
      const held = getComputedStyle(button()).opacity;
      expect(held).toBe('0.85');
      expect(held).not.toBe(resting); // anti-vacuity: the press changed something
      pressOut(button());
      expect(getComputedStyle(button()).opacity).toBe(resting);
    });

    it('keeps its box while held (a press does not move the outline)', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact={compact} />);
      const read = () => {
        const style = getComputedStyle(compact ? (boxOf() as HTMLElement) : button());
        return [style.minHeight, style.paddingLeft, style.borderLeftWidth];
      };
      const before = read();
      pressIn(button());
      expect(read()).toEqual(before);
      pressOut(button());
    });
  });
});
