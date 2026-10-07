import { fireEvent, render, screen, within } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '@/ui/components/IconButton';
import { colour, layout } from '@/ui/theme/tokens';
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

/** The two glyphs the icon row draws (spec §3): the name is the label, the glyph is the picture. */
const BUTTONS = [
  ['settings', 'Settings'],
  ['home', 'Home'],
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

  it('ran both buttons (anti-vacuity)', () => {
    expect(BUTTONS).toHaveLength(2);
    expect(buttonsRun).toBe(2);
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
});
