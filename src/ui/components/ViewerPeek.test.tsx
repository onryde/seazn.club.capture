import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { colour, layout } from '@/ui/theme/tokens';
import { boardLimeEdge } from '../../../test/boardPaint';
import { renderWithPorts } from '../../../test/renderWithPorts';

/**
 * The props each Pressable is handed. react-native-web 0.21.2 forwards only the props in its `forwardedProps` list
 * (dist/exports/View/index.js:26-33), which has no `accessibilityHint`, so the hint never reaches the DOM; what the
 * control hands the Pressable is what TalkBack is given (ledger P13). Whether TalkBack speaks it is a device check.
 */
const handed = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Pressable: (props: ComponentProps<typeof actual.Pressable>) => {
      handed.push(props as Record<string, unknown>);
      return createElement(actual.Pressable, props);
    },
  };
});

const peek = () => screen.getByRole('button', { name: en['stream.peek.label'] });

/** Which token a border was painted with; the colour on screen is a device check. */
const TOKEN = StyleSheet.create({
  ink3: { borderColor: colour.ink3, borderWidth: 1 },
  rule: { borderColor: colour.rule, borderWidth: 1 },
});

function borderOf(style: ViewStyle): string {
  const reference = render(<View testID="border-reference" style={style} />);
  const painted = getComputedStyle(reference.getByTestId('border-reference')).borderTopColor;
  reference.unmount();
  return painted;
}

const outline = () => {
  const style = getComputedStyle(peek());
  return { width: style.borderTopWidth, colour: style.borderTopColor };
};

/** D2 §4.3, PD1: a plain tap. No hold, no delay; a disabled control says why. */
describe('ViewerPeek', () => {
  it('answers a tap with one press, and holds nothing', () => {
    const onPress = vi.fn();
    renderWithPorts(<ViewerPeek disabled={false} reason={null} open={false} onPress={onPress} />);
    fireEvent.click(peek());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reads selected while the view is open, and not while it is closed', () => {
    const { rerender } = renderWithPorts(
      <ViewerPeek disabled={false} reason={null} open={false} onPress={vi.fn()} />,
    );
    expect(peek().getAttribute('aria-selected')).toBe('false');
    rerender(<ViewerPeek disabled={false} reason={null} open onPress={vi.fn()} />);
    expect(peek().getAttribute('aria-selected')).toBe('true');
  });

  it('draws the hairline ink3 rule closed, a 2 dp lime rule open, and the quiet rule off', () => {
    const { rerender } = renderWithPorts(
      <ViewerPeek disabled={false} reason={null} open={false} onPress={vi.fn()} />,
    );
    expect(outline()).toEqual({ width: `${layout.iconBorder}px`, colour: borderOf(TOKEN.ink3) });
    rerender(<ViewerPeek disabled={false} reason={null} open onPress={vi.fn()} />);
    expect(outline()).toEqual({ width: '2px', colour: boardLimeEdge() });
    rerender(<ViewerPeek disabled reason={en['stream.peek.hot']} open={false} onPress={vi.fn()} />);
    expect(outline()).toEqual({ width: `${layout.iconBorder}px`, colour: borderOf(TOKEN.rule) });
    // Anti-vacuity: the three rules are three colours.
    expect(new Set([borderOf(TOKEN.ink3), boardLimeEdge(), borderOf(TOKEN.rule)]).size).toBe(3);
  });

  it('is disabled with its reason, and a tap then does nothing', () => {
    const onPress = vi.fn();
    renderWithPorts(
      <ViewerPeek disabled reason={en['stream.peek.hot']} open={false} onPress={onPress} />,
    );
    fireEvent.click(peek());
    expect(onPress).not.toHaveBeenCalled();
    expect(peek().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(en['stream.peek.hot'])).toBeTruthy();
  });

  it('tells a screen reader what a tap does, on the control itself', () => {
    handed.length = 0;
    renderWithPorts(<ViewerPeek disabled={false} reason={null} open={false} onPress={vi.fn()} />);
    const control = handed.filter((props) => props.accessibilityLabel === en['stream.peek.label']);
    expect(control.length).toBeGreaterThan(0);
    expect(control.at(-1)?.accessibilityHint).toBe(en['stream.peek.hint']);
    expect(en['stream.peek.hint']).toBe('Tap to see what viewers see for 20 seconds');
    expect(peek()).toBeTruthy();
  });

  it('names itself in the operator’s language', () => {
    renderWithPorts(<ViewerPeek disabled={false} reason={null} open={false} onPress={vi.fn()} />, {
      deviceLanguages: ['es'],
    });
    expect(screen.getByRole('button', { name: es['stream.peek.label'] })).toBeTruthy();
    expect(screen.getByText(es['stream.peek.label'])).toBeTruthy();
  });
});
