import { act } from '@testing-library/react';

type LayoutHandler = (event: {
  nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
}) => void;

/**
 * Delivers a layout to a View's `onLayout`, as the phone would after laying it out. jsdom has no
 * layout and no ResizeObserver, so react-native-web never calls the prop; it keeps the handler on
 * the node as `__reactLayoutHandler` (react-native-web 0.21.2, modules/useElementLayout), which this
 * calls. One place to change if that stops being true; `StreamScreen.layout.test.tsx` probes it.
 */
export function layOut(element: Element, size: { width: number; height: number }): void {
  const handler = (element as Element & { __reactLayoutHandler?: LayoutHandler })
    .__reactLayoutHandler;
  if (typeof handler !== 'function') {
    throw new Error('this element has no onLayout handler: the View was given no onLayout prop');
  }
  act(() => handler({ nativeEvent: { layout: { x: 0, y: 0, ...size } } }));
}
