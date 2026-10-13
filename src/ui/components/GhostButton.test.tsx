import { act, render, screen, within } from '@testing-library/react';
import { StyleSheet, Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { GhostButton } from '@/ui/components/GhostButton';
import { colour, font } from '@/ui/theme/tokens';
import { pressIn, pressOut } from '../../../test/press';
import {
  edgeOf,
  fillOf,
  layoutOf,
  paintOf,
  pressTwice,
  unmountWhileHeld,
} from '../../../test/pressState';

// The text colour a style gives, read the way the layout tests read colours: a colour literal is banned in a test, and
// a value read back from the component would prove the component equals itself.
const PAINT = StyleSheet.create({ ink2: { color: colour.ink2 }, ink: { color: colour.ink } });
const INERT = StyleSheet.create({ ink3: { color: colour.ink3 } });
function painted(style: { color: string }): string {
  const reference = render(<Text style={style}>x</Text>);
  const read = getComputedStyle(reference.container.firstElementChild as Element).color;
  reference.unmount();
  return read;
}

const button = () => screen.getByRole('button', { name: 'Share record' });
/** One tab stop: the button itself is focusable, and no element inside it is. */
function expectOneFocusable(target: HTMLElement) {
  expect(target.getAttribute('tabindex')).toBe('0');
  expect(target.querySelectorAll('[tabindex]')).toHaveLength(0);
}
const boxOf = () => within(button()).queryByTestId('ghost-box');

describe('GhostButton (the secondary action)', () => {
  it('is one 48 dp box that is its own outline, with no inner box', () => {
    render(<GhostButton label="Share record" onPress={vi.fn()} />);
    const style = getComputedStyle(button());
    expect(style.minHeight).toBe('48px'); // the tripod target (AGENTS §5)
    expect([style.paddingLeft, style.borderLeftWidth]).toEqual(['16px', '1px']);
    expect(boxOf()).toBeNull();
    expectOneFocusable(button());
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

    // The button is the one thing a keyboard or a switch reaches: the box inside it must not be a second stop.
    it('is one focusable, the button, and nothing inside it', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact />);
      expectOneFocusable(button());
      expect(boxOf()).not.toBeNull(); // anti-vacuity: the box that must not be focusable is there
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

    // The box is drawn by a function the target hands its press state to, memoised per label and state: a new language
    // and a change to disabled must still reach it, never a box drawn for the props of before.
    it('another language, then disabled: the box inside the target shows each', () => {
      const view = render(<GhostButton label={en['diag.share']} onPress={vi.fn()} compact />);
      view.rerender(<GhostButton label={es['diag.share']} onPress={vi.fn()} compact />);
      const inBox = () => within(screen.getByTestId('ghost-box')).getByText(es['diag.share']);
      expect(es['diag.share']).not.toBe(en['diag.share']); // anti-vacuity: the language changed the words
      expect(getComputedStyle(inBox()).color).toBe(painted(PAINT.ink2));
      view.rerender(<GhostButton label={es['diag.share']} onPress={vi.fn()} compact disabled />);
      expect(getComputedStyle(inBox()).color).toBe(painted(INERT.ink3));
    });
  });

  // The controller's rulings (Batch 17; the owner has not ruled), with the controller's press-fill ruling (2026-10-13),
  // after the owner saw no change while holding an icon: a pressed outline takes the press fill, the cream at 20%
  // (`colour.pressFill`), so it shows on any ground, and its edge goes cream; never a dim alone, and the box never
  // moves.
  // The outline is the button in the regular form and the box inside the target in the compact one; the compact
  // target itself still draws nothing. Held and released, for both forms, so each press state's style is read.
  describe.each([
    ['regular', false],
    ['compact', true],
  ] as const)('%s: pressed state', (_form, compact) => {
    const outlineOf = () => (compact ? (boxOf() as HTMLElement) : button());

    it('fills with the press fill and its edge goes cream while held, with no dim, and is as it was on release', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact={compact} />);
      const resting = paintOf(outlineOf());
      const target = paintOf(button());
      expect(resting.fill).not.toBe(fillOf(colour.pressFill)); // anti-vacuity: no fill at rest
      expect(resting.edges).toEqual(Array(4).fill(edgeOf(colour.ink3)));
      pressIn(button());
      expect(paintOf(outlineOf())).toEqual({
        fill: fillOf(colour.pressFill),
        edges: Array(4).fill(edgeOf(colour.ink)),
        opacity: resting.opacity,
      });
      if (compact) expect(paintOf(button())).toEqual(target); // the 48 dp target draws nothing, held or not
      pressOut(button());
      expect(paintOf(outlineOf())).toEqual(resting);
    });

    it('keeps its box while held (a press does not move the outline or its target)', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact={compact} />);
      const before = [layoutOf(button()), layoutOf(outlineOf())];
      expect(before[1]['min-height']).toBe(compact ? '37px' : '48px'); // anti-vacuity: the outline's box is read
      pressIn(button());
      expect([layoutOf(button()), layoutOf(outlineOf())]).toEqual(before);
      expect(paintOf(outlineOf()).fill).toBe(fillOf(colour.pressFill)); // and the press did change the paint
      pressOut(button());
    });

    it('a second press, and a press while held, find nothing stuck', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact={compact} />);
      const resting = paintOf(outlineOf()).fill;
      const held = fillOf(colour.pressFill);
      expect(pressTwice(button, () => paintOf(outlineOf()).fill)).toEqual([
        resting,
        held,
        resting,
        held,
        resting,
      ]);
    });

    it('disabled, it never shows pressed', () => {
      render(<GhostButton label="Share record" onPress={vi.fn()} compact={compact} disabled />);
      const resting = paintOf(outlineOf());
      pressIn(button());
      expect(paintOf(outlineOf())).toEqual(resting);
      expect(resting.fill).not.toBe(fillOf(colour.pressFill));
      pressOut(button());
    });

    it('held and unmounted: no timer is left and nothing fires', () => {
      const onPress = vi.fn();
      const view = render(<GhostButton label="Share record" onPress={onPress} compact={compact} />);
      expect(unmountWhileHeld(button, view.unmount)).toEqual({ held: 1, left: 0 });
      expect(onPress).not.toHaveBeenCalled();
    });
  });
});

// I3 of the Batch 5 review: the battery row's button is disabled on air. A disabled ghost is marked for a screen
// reader, never fires, and its label drops to the inert ink, as Button's and HoldAction's do.
describe('GhostButton disabled', () => {
  it.each([false, true])(
    'compact %s: marked disabled, fires nothing, and its label is inert',
    (compact) => {
      const onPress = vi.fn();
      render(<GhostButton label="Share record" onPress={onPress} compact={compact} disabled />);
      expect(button().getAttribute('aria-disabled')).toBe('true');
      act(() => button().click());
      expect(onPress).not.toHaveBeenCalled();
      expect(getComputedStyle(within(button()).getByText('Share record')).color).toBe(
        painted(INERT.ink3),
      );
    },
  );

  it('enabled by default: not marked, and a tap fires once', () => {
    const onPress = vi.fn();
    render(<GhostButton label="Share record" onPress={onPress} compact />);
    expect(button().getAttribute('aria-disabled')).toBeNull();
    act(() => button().click());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getComputedStyle(within(button()).getByText('Share record')).color).not.toBe(
      painted(INERT.ink3),
    );
  });
});
