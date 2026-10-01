import { fireEvent } from '@testing-library/react';

/**
 * How a test holds a react-native-web Pressable. Keyboard Enter reaches
 * onPressIn at once and onPressOut on release: react-native-web 0.21.2
 * PressResponder.js `onKeyDown` calls `start(event, false)`, skipping the
 * 50 ms pointer press delay. It also drops a second keyDown while a press is
 * active (`_touchState === NOT_RESPONDER`), so a double press has to be tested
 * at the hook. One place to change if any of that stops being true; the probe
 * at the top of HoldAction.test.tsx proves it.
 *
 * On a phone there is no delay either: RN's Pressable passes
 * `unstable_pressDelay` (unset) as Pressability's `delayPressIn`, which
 * `normalizeDelay` defaults to 0.
 */
export function pressIn(element: HTMLElement): void {
  fireEvent.keyDown(element, { key: 'Enter' });
}

export function pressOut(element: HTMLElement): void {
  fireEvent.keyUp(element, { key: 'Enter' });
}
