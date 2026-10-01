import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Easing, withTiming } from 'react-native-reanimated';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reanimated cannot load in vitest (its worklets initialiser does not resolve
 * as ESM), and test/setup-ui.ts stubs HoldFill for every other test. So this
 * file draws the real HoldFill over a Reanimated stand-in that records the
 * timing it is asked for. The enum's values are copied from the vendor source,
 * and the test below checks that they still are.
 */
vi.mock('react-native-reanimated', async () => {
  const { useRef } = await import('react');
  const { View } = await import('react-native');
  return {
    default: { View },
    cancelAnimation: vi.fn(),
    Easing: { linear: (t: number) => t },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useAnimatedStyle: (style: () => object) => style(),
    useSharedValue: (initial: number) => useRef({ value: initial }).current,
    withTiming: vi.fn((toValue: number) => toValue),
  };
});

const { HoldFill } = await vi.importActual<typeof import('@/ui/components/HoldFill')>(
  '@/ui/components/HoldFill',
);

/** Reanimated 4.5.1's own value for `ReduceMotion.Never` (src/commonTypes.ts). */
function vendorNever(): string {
  const nodeRequire = createRequire(import.meta.url);
  const root = dirname(nodeRequire.resolve('react-native-reanimated/package.json'));
  const source = readFileSync(join(root, 'src/commonTypes.ts'), 'utf8');
  const never = /enum ReduceMotion \{[^}]*Never = '(\w+)'/.exec(source)?.[1];
  if (never === undefined) throw new Error('ReduceMotion.Never not found in Reanimated');
  return never;
}

describe('HoldFill’s timing (AGENTS §6; the owner’s rulings)', () => {
  beforeEach(() => vi.mocked(withTiming).mockClear());

  it('fills over the owner’s 3 s, linearly, and animates even under reduced motion', () => {
    render(<HoldFill holding tone="go" />);
    expect(withTiming).toHaveBeenCalledTimes(1);
    expect(withTiming).toHaveBeenCalledWith(1, {
      duration: 3000,
      easing: Easing.linear,
      reduceMotion: vendorNever(),
    });
  });

  it('starts no fill until the hold starts, and one per hold', () => {
    const view = render(<HoldFill holding={false} tone="stop" />);
    expect(withTiming).not.toHaveBeenCalled();
    view.rerender(<HoldFill holding tone="stop" />);
    view.rerender(<HoldFill holding={false} tone="stop" />);
    view.rerender(<HoldFill holding tone="stop" />);
    expect(withTiming).toHaveBeenCalledTimes(2);
  });

  it('still finds Reanimated’s own `Never` equal to the stand-in’s', () => {
    expect(vendorNever()).toBe('never');
  });
});
