import { fireEvent, render, screen, within } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '@/ui/components/IconButton';
import { colour, layout } from '@/ui/theme/tokens';
import { BOARD, boardLimeEdge } from '../../../test/boardPaint';
import { pressIn, pressOut } from '../../../test/press';
import {
  edgeOf,
  fillOf,
  layoutOf,
  paintOf,
  pressTwice,
  unmountWhileHeld,
} from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** Which token a border was painted with (jsdom's cascade); the colour on a phone is a device check. */
const TOKEN = StyleSheet.create({
  ink3: { borderWidth: 1, borderColor: colour.ink3 },
});

function borderOf(style: ViewStyle): string {
  const reference = render(<View testID="border-reference" style={style} />);
  const painted = getComputedStyle(reference.getByTestId('border-reference')).borderTopColor;
  reference.unmount();
  return painted;
}

/** The four glyphs the icon row draws (spec §3, §8, §10): the name is the label, the glyph is the picture. */
const BUTTONS = [
  ['settings', 'Settings'],
  ['home', 'Home'],
  ['shutter', 'Take photo'],
  ['qr', 'Remote scoring'],
] as const;
let buttonsRun = 0;

describe('IconButton (spec §3)', () => {
  it.each(BUTTONS)('%s: a button named %s, drawn as its glyph in ink2', (glyph, label) => {
    renderWithPorts(<IconButton glyph={glyph} label={label} onPress={vi.fn()} />);
    const button = screen.getByRole('button', { name: label });
    const drawn = within(button).getByTestId('glyph');
    expect(drawn.dataset.name).toBe(glyph);
    expect(drawn.dataset.slashed).toBe('false');
    // The canvas draws the icon row in cream at 80%, not the chips' full ink.
    expect(drawn.dataset.tone).toBe('ink2');
    expect(colour[drawn.dataset.tone as 'ink2']).toBe(colour.ink2);
    expect(colour.ink2).not.toBe(colour.ink);
    buttonsRun += 1;
  });

  it('ran all four buttons (anti-vacuity)', () => {
    expect(BUTTONS).toHaveLength(4);
    expect(buttonsRun).toBe(4);
  });

  it('is 48 dp square with a quiet ink3 outline', () => {
    renderWithPorts(<IconButton glyph="settings" label="Settings" onPress={vi.fn()} />);
    const style = getComputedStyle(screen.getByRole('button', { name: 'Settings' }));
    // Spec §3's number, written out beside the token it is read from.
    expect(layout.iconButton).toBe(48);
    // The canvas's 1 px hairline, likewise.
    expect(layout.iconBorder).toBe(1);
    expect([style.width, style.height]).toEqual([
      `${layout.iconButton}px`,
      `${layout.iconButton}px`,
    ]);
    expect(style.borderTopWidth).toBe(`${layout.iconBorder}px`);
    expect(style.borderTopColor).toBe(borderOf(TOKEN.ink3));
  });

  it('calls onPress once for a press, and once more for a second', () => {
    const onPress = vi.fn();
    renderWithPorts(<IconButton glyph="home" label="Home" onPress={onPress} />);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('is named by its label alone, and has no visible word', () => {
    renderWithPorts(<IconButton glyph="settings" label="Ajustes" onPress={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ajustes' }).textContent).toBe('');
  });

  // B5 (owner-approved board ruling): while its panel shows, the button is pressed in: a 2 dp lime outline and the
  // selected state a screen reader announces. The lime is the board's own (#9ae600), typed in test/boardPaint.ts.
  describe('selected (B5)', () => {
    const outline = (name: string) => {
      const style = getComputedStyle(screen.getByRole('button', { name }));
      return { width: style.borderTopWidth, colour: style.borderTopColor };
    };

    it('unselected, it is the hairline ink3 outline and says nothing about being selected', () => {
      renderWithPorts(
        <IconButton glyph="qr" label="Remote scoring" selected={false} onPress={vi.fn()} />,
      );
      expect(
        screen.getByRole('button', { name: 'Remote scoring' }).getAttribute('aria-selected'),
      ).toBe('false');
      expect(outline('Remote scoring')).toEqual({
        width: `${layout.iconBorder}px`,
        colour: borderOf(TOKEN.ink3),
      });
    });

    it('selected, it is a 2 dp lime outline and is announced as selected, and is still 48 dp square', () => {
      renderWithPorts(<IconButton glyph="qr" label="Remote scoring" selected onPress={vi.fn()} />);
      const button = screen.getByRole('button', { name: 'Remote scoring' });
      expect(button.getAttribute('aria-selected')).toBe('true');
      expect(layout.iconBorderOn).toBe(2); // the board's 2 dp, written out
      expect(outline('Remote scoring')).toEqual({ width: '2px', colour: boardLimeEdge() });
      expect(boardLimeEdge()).not.toBe(borderOf(TOKEN.ink3)); // anti-vacuity: lime is not the hairline's colour
      expect(BOARD.lime).toBe(colour.lime); // and it is the app's LED, not a second green
      const style = getComputedStyle(button);
      expect([style.width, style.height]).toEqual([
        `${layout.iconButton}px`,
        `${layout.iconButton}px`,
      ]);
    });

    it('without the prop it is the plain button of before: no selected state at all', () => {
      renderWithPorts(<IconButton glyph="settings" label="Settings" onPress={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-selected'),
      ).toBeNull();
      expect(outline('Settings').width).toBe(`${layout.iconBorder}px`);
    });

    it('goes from selected back to unselected when its panel closes (both states, one button)', () => {
      const view = renderWithPorts(
        <IconButton glyph="qr" label="Remote scoring" selected onPress={vi.fn()} />,
      );
      expect(outline('Remote scoring').width).toBe('2px');
      view.rerender(
        <IconButton glyph="qr" label="Remote scoring" selected={false} onPress={vi.fn()} />,
      );
      expect(outline('Remote scoring').width).toBe(`${layout.iconBorder}px`);
      expect(
        screen.getByRole('button', { name: 'Remote scoring' }).getAttribute('aria-selected'),
      ).toBe('false');
    });
  });

  // The owner held a sliders glyph on phone A (2026-10-13) and saw nothing change until it opened on lift: a 15% dim
  // of a hairline. The controller's rulings (Batch 17 and its P8; the owner has not ruled): a pressed button takes the
  // press fill, the cream at 20% (`colour.pressFill`), so it shows on any ground, and its edge goes cream; never opacity
  // alone, and its box never moves. A selected button keeps its 2 dp lime edge and takes the fill only. Whether it reads
  // outdoors is the owner's device check: jsdom sees no colour and composites nothing.
  describe('pressed (the controller’s ruling, Batch 17)', () => {
    const remote = () => screen.getByRole('button', { name: 'Remote scoring' });

    it('fills with the press fill and its edge goes cream while held, with no dim, and is as it was on release', () => {
      renderWithPorts(<IconButton glyph="qr" label="Remote scoring" onPress={vi.fn()} />);
      const resting = paintOf(remote());
      expect(resting.edges).toEqual(Array(4).fill(borderOf(TOKEN.ink3)));
      expect(resting.fill).not.toBe(fillOf(colour.pressFill)); // anti-vacuity: no fill at rest
      pressIn(remote());
      expect(paintOf(remote())).toEqual({
        fill: fillOf(colour.pressFill),
        edges: Array(4).fill(edgeOf(colour.ink)),
        opacity: resting.opacity,
      });
      expect(edgeOf(colour.ink)).not.toBe(borderOf(TOKEN.ink3)); // anti-vacuity: cream is not the hairline's ink
      pressOut(remote());
      expect(paintOf(remote())).toEqual(resting);
    });

    it('selected and held, it keeps its 2 dp lime edge and takes the press fill', () => {
      renderWithPorts(<IconButton glyph="qr" label="Remote scoring" selected onPress={vi.fn()} />);
      const resting = paintOf(remote());
      pressIn(remote());
      const held = getComputedStyle(remote());
      expect(held.borderTopWidth).toBe(`${layout.iconBorderOn}px`);
      expect(paintOf(remote())).toEqual({
        fill: fillOf(colour.pressFill),
        edges: Array(4).fill(boardLimeEdge()),
        opacity: resting.opacity,
      });
      pressOut(remote());
      expect(paintOf(remote())).toEqual(resting);
    });

    it.each([false, true])('selected %s: a press never moves the box', (selected) => {
      renderWithPorts(
        <IconButton glyph="qr" label="Remote scoring" selected={selected} onPress={vi.fn()} />,
      );
      const resting = layoutOf(remote());
      expect(resting.width).toBe(`${layout.iconButton}px`); // anti-vacuity: the box is read
      pressIn(remote());
      expect(layoutOf(remote())).toEqual(resting);
      expect(paintOf(remote()).fill).toBe(fillOf(colour.pressFill)); // and the press did change the paint
      pressOut(remote());
    });

    it('a second press, and a press while held, find nothing stuck', () => {
      renderWithPorts(<IconButton glyph="qr" label="Remote scoring" onPress={vi.fn()} />);
      const resting = paintOf(remote()).fill;
      const held = fillOf(colour.pressFill);
      expect(pressTwice(remote, () => paintOf(remote()).fill)).toEqual([
        resting,
        held,
        resting,
        held,
        resting,
      ]);
    });

    it('held and unmounted: no timer is left and nothing fires', () => {
      const onPress = vi.fn();
      const view = renderWithPorts(
        <IconButton glyph="qr" label="Remote scoring" onPress={onPress} />,
      );
      expect(unmountWhileHeld(remote, view.unmount)).toEqual({ held: 1, left: 0 });
      expect(onPress).not.toHaveBeenCalled();
    });
  });
});
