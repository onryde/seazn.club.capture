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

// The chips' and the icon buttons' drawing is paths and a stroke colour. The stand-in is a marker
// tests can find, carrying what the caller chose: the glyph's name, whether it is slashed and its
// tone (F11: the tone is the chip's colour, so a test must be able to see it).
vi.mock('@/ui/components/Glyph', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  return {
    Glyph: ({ name, slashed, tone }: { name: string; slashed?: boolean; tone: string }) =>
      createElement(View, {
        testID: 'glyph',
        dataSet: { name, slashed: String(slashed === true), tone },
      } as ViewProps),
  };
});

// The QR's drawing is paths and an image; its own suite (SeaznQr.test.tsx) takes the real component. The
// stand-in is a marker other suites can find, carrying the plan's version and modules, the dp it was given and a
// digest of the painted path (qrDigest.ts): the version and the modules are the same for any two links of one length,
// the digest is not, so it is what ties a drawn code to the link it was made from.
vi.mock('@/ui/components/SeaznQr', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  const { pathDigest } = await import('./qrDigest');
  return {
    SeaznQr: ({
      plan,
      size,
      label,
    }: {
      plan: { version: number; modules: number; path: string };
      size: number;
      label: string;
    }) =>
      createElement(View, {
        testID: 'seazn-qr',
        accessibilityLabel: label,
        style: { width: size, height: size },
        dataSet: {
          version: String(plan.version),
          modules: String(plan.modules),
          size: String(size),
          digest: pathDigest(plan.path),
        },
      } as ViewProps),
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

// The hold's fill is a Reanimated worklet; tests read whether it is running and its tone.
vi.mock('@/ui/components/HoldFill', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  return {
    HoldFill: ({ holding, tone }: { holding: boolean; tone: string }) =>
      createElement(View, {
        testID: 'hold-fill',
        dataSet: { holding: String(holding), tone },
      } as ViewProps),
  };
});
