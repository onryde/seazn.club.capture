import { act } from '@testing-library/react';

/**
 * D13 (pre-flight F12): react-native-web 0.21 reads the window from documentElement's clientWidth and
 * clientHeight (jsdom has no visualViewport, and its documentElement is 0 × 0), and re-reads it on window
 * `resize`. A stub of those two getters, then `resize`, moves useWindowDimensions for real.
 *
 * It reads `clientWidth` and `clientHeight`, never `innerWidth`: stubbing `innerWidth` moves nothing.
 * Register `afterEach(restoreWindowSize)` in every file that calls this, so one test's window never
 * reaches the next. Prove the helper turns a layout with a positive control before trusting a landscape
 * assertion (SettingsScreen.test.tsx has the pattern).
 */
export function setWindowSize(width: number, height: number): void {
  const root = document.documentElement;
  Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => height });
  act(() => void window.dispatchEvent(new Event('resize')));
}

/** Back to jsdom's own getters (Element.prototype's), and tell react-native-web. Register with afterEach. */
export function restoreWindowSize(): void {
  const root = document.documentElement;
  Reflect.deleteProperty(root, 'clientWidth');
  Reflect.deleteProperty(root, 'clientHeight');
  act(() => void window.dispatchEvent(new Event('resize')));
}
