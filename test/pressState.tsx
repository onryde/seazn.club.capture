import { fireEvent, render } from '@testing-library/react';
import { StyleSheet, View } from 'react-native';
import { vi } from 'vitest';
import { pressIn, pressOut } from './press';

/**
 * How jsdom paints a token as a fill and as an edge, read from a reference View, so a pressed style is compared as the
 * cascade resolves it (IconButton.test.tsx's `borderOf`). The caller passes the token (`colour.pressFill`), never a
 * literal. The colour on a phone, and whether a press reads outdoors, is a device check (AGENTS §10).
 */
function resolved(read: (style: CSSStyleDeclaration) => string, style: object): string {
  const reference = render(<View testID="paint-reference" style={style} />);
  const painted = read(getComputedStyle(reference.getByTestId('paint-reference')));
  reference.unmount();
  return painted;
}

export function fillOf(token: string): string {
  return resolved(
    (style) => style.backgroundColor,
    StyleSheet.create({ s: { backgroundColor: token } }).s,
  );
}

/** The fill of a View that paints none, as jsdom computes it: a host that lets its parent's ground show through. */
export function unpaintedFill(): string {
  return resolved((style) => style.backgroundColor, {});
}

export function edgeOf(token: string): string {
  return resolved(
    (style) => style.borderTopColor,
    StyleSheet.create({ s: { borderWidth: 1, borderColor: token } }).s,
  );
}

/** An element's fill and its four edges' colours, as painted. */
export function paintOf(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    fill: style.backgroundColor,
    edges: [
      style.borderTopColor,
      style.borderRightColor,
      style.borderBottomColor,
      style.borderLeftColor,
    ],
    opacity: style.opacity,
  };
}

/**
 * Every property of an element's box that a press must leave alone (the controller's ruling for the pressed state: a
 * fill and an edge, never a re-layout; the camera box and the controls half are sized to the dp, AGENTS §6).
 */
const BOX = [
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
] as const;

export function layoutOf(element: HTMLElement): Record<string, string> {
  const style = getComputedStyle(element);
  return Object.fromEntries(BOX.map((property) => [property, style.getPropertyValue(property)]));
}

/**
 * Holds and releases a control twice, reading it at rest and after each step: [rest, held, released, held, released].
 * Each hold is pressed twice, since a second press while held must not stick the state (react-native-web drops the
 * second keyDown, test/press.ts; on a phone the responder is already granted).
 */
export function pressTwice<T>(element: () => HTMLElement, read: () => T): T[] {
  const reads = [read()];
  for (let hold = 0; hold < 2; hold += 1) {
    pressIn(element());
    pressIn(element());
    reads.push(read());
    pressOut(element());
    reads.push(read());
  }
  return reads;
}

/**
 * Holds a control and unmounts it mid-press, then lets every timer run and the key come up after it has gone. Returns
 * the pending timers while held (react-native-web's long-press timer: proof the hold began) and after the unmount (none
 * may be left). The components keep no timer of their own.
 */
export function unmountWhileHeld(element: () => HTMLElement, unmount: () => void) {
  vi.useFakeTimers();
  try {
    pressIn(element());
    const held = vi.getTimerCount();
    unmount();
    const left = vi.getTimerCount();
    vi.runAllTimers();
    // The key comes up after the control has gone: react-native-web's release listener is still on the document (its
    // `reset` clears timers only), and the release must not press anything. The body, since that listener reads the
    // target's tag name and the document has none.
    fireEvent.keyUp(document.body, { key: 'Enter' });
    return { held, left };
  } finally {
    vi.useRealTimers();
  }
}

/**
 * A held control's fill on the ground of the host it sits in. By the controller's press-fill ruling (2026-10-13), the
 * press fill must not depend on the ground. Reads the host's own fill at rest and the control's fill while held. The
 * caller pins the host's ground to its token, so a host repainted under the control fails, and checks the held fill
 * against the press fill and the ground. jsdom composites nothing: how the two look together is a device check.
 */
export function heldOnGround(control: () => HTMLElement, host: () => HTMLElement) {
  const ground = paintOf(host()).fill;
  pressIn(control());
  const held = paintOf(control()).fill;
  pressOut(control());
  return { ground, held, released: paintOf(control()).fill };
}
