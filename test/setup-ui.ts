import { cleanup } from '@testing-library/react';
import type { ViewProps } from 'react-native';
import { afterEach, vi } from 'vitest';
import { disposeFakePorts } from './fakePorts';

// Testing Library only auto-cleans when the runner exposes globals; vitest
// does not by default, so rendered trees would leak between tests.
afterEach(() => {
  cleanup();
});

afterEach(() => {
  disposeFakePorts();
});

// Drawing only: an icon and a looping rotation. Everything testable about the
// tiles is their text and their presses. The turn card is its glyph alone
// (R28), so the glyph's stand-in is a marker tests can find, carrying its kind.
vi.mock('@/ui/components/ModeIcon', () => ({ ModeIcon: () => null }));
vi.mock('@/ui/components/TurnGlyph', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  return {
    TurnGlyph: ({ card }: { card: string }) =>
      createElement(View, { testID: 'turn-glyph', dataSet: { card } } as ViewProps),
  };
});

// The sheet's entrance is drawing only; the panel inside it is what tests read.
// react-native-web drops accessibilityViewIsModal, the prop native reads, so
// the stand-in surfaces it as data-view-is-modal for tests to assert.
vi.mock('@/ui/components/SlideUpSheet', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  function SlideUpSheet({ accessibilityViewIsModal, ...props }: ViewProps) {
    const dataSet = { viewIsModal: String(accessibilityViewIsModal === true) };
    return createElement(View, { ...props, dataSet } as ViewProps);
  }
  return { SlideUpSheet };
});

// The overlay's exit fade is drawing only; the card inside it is what tests read.
// Like SlideUpSheet, the stand-in surfaces the native-only accessibility props
// react-native-web drops, as data-accessible, data-view-is-modal and
// data-live-region. accessibilityLabel passes through: react-native-web
// renders it as aria-label.
vi.mock('@/ui/components/FadeOut', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  function FadeOut({
    accessible,
    accessibilityViewIsModal,
    accessibilityLiveRegion,
    ...props
  }: ViewProps) {
    const dataSet = {
      accessible: String(accessible === true),
      viewIsModal: String(accessibilityViewIsModal === true),
      liveRegion: String(accessibilityLiveRegion),
    };
    return createElement(View, { ...props, dataSet } as ViewProps);
  }
  return { FadeOut };
});
