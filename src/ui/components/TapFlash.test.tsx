import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { cancelAnimation, withSequence, withTiming } from 'react-native-reanimated';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colour } from '@/ui/theme/tokens';
import { fillOf } from '../../../test/pressState';

/**
 * Reanimated cannot load in vitest, and test/setup-ui.ts stubs TapFlash for every other test (it surfaces the cue). So
 * this file draws the real TapFlash over a Reanimated stand-in that records what it is asked to run. The shared value
 * is a plain object the test can read; the enum's values are copied from the vendor source, checked below.
 */
const values: { value: number }[] = [];
vi.mock('react-native-reanimated', async () => {
  const { useRef } = await import('react');
  const { View } = await import('react-native');
  return {
    default: { View },
    cancelAnimation: vi.fn(),
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useAnimatedStyle: (style: () => object) => style(),
    useSharedValue: (initial: number) => {
      const shared = useRef<{ value: number } | null>(null);
      if (shared.current === null) {
        shared.current = { value: initial };
        values.push(shared.current);
      }
      return shared.current;
    },
    withTiming: vi.fn((toValue: number, config: object) => ({ toValue, config })),
    withSequence: vi.fn((...steps: unknown[]) => ({ sequence: steps })),
  };
});

const { TapFlash } = await vi.importActual<typeof import('@/ui/components/TapFlash')>(
  '@/ui/components/TapFlash',
);

/** Reanimated 4.5.1's own value for `ReduceMotion.System` (src/commonTypes.ts). */
function vendorSystem(): string {
  const nodeRequire = createRequire(import.meta.url);
  const root = dirname(nodeRequire.resolve('react-native-reanimated/package.json'));
  const source = readFileSync(join(root, 'src/commonTypes.ts'), 'utf8');
  const system = /enum ReduceMotion \{[^}]*System = '(\w+)'/.exec(source)?.[1];
  if (system === undefined) throw new Error('ReduceMotion.System not found in Reanimated');
  return system;
}

const opacity = () => values[values.length - 1]?.value;

describe('TapFlash (owner ruling 14: the tapped half flashes lime briefly, so a tap that counted is seen)', () => {
  beforeEach(() => {
    vi.mocked(withSequence).mockClear();
    vi.mocked(withTiming).mockClear();
    vi.mocked(cancelAnimation).mockClear();
    values.length = 0;
  });

  it('never flashes as it mounts, with no cue or with one already there (a return to the pad)', () => {
    render(<TapFlash cue={0} />);
    render(<TapFlash cue={7} />);
    expect(withSequence).not.toHaveBeenCalled();
    expect(cancelAnimation).not.toHaveBeenCalled();
    expect(opacity()).toBe(0);
  });

  it('rises to a low lime and fades, about 300 ms in all, on the UI thread, under the system’s reduced motion', () => {
    const view = render(<TapFlash cue={0} />);
    view.rerender(<TapFlash cue={1} />);
    expect(withSequence).toHaveBeenCalledTimes(1);
    const [reduceMotion, ...steps] = vi.mocked(withSequence).mock.calls[0] ?? [];
    expect(reduceMotion).toBe(vendorSystem());
    expect(steps).toHaveLength(2);
    const timings = vi.mocked(withTiming).mock.calls;
    expect(timings.map(([toValue]) => toValue)).toEqual([0.3, 0]);
    const durations = timings.map(([, config]) => (config as { duration: number }).duration);
    expect(durations.reduce((sum, ms) => sum + ms, 0)).toBe(300);
    // No step carries its own reduced-motion setting, so each inherits the sequence's (src/animation/sequence.ts).
    for (const [, config] of timings) expect(config).not.toHaveProperty('reduceMotion');
  });

  it('flashes again for a second counted tap on the same half, and once per cue', () => {
    const view = render(<TapFlash cue={0} />);
    view.rerender(<TapFlash cue={1} />);
    view.rerender(<TapFlash cue={1} />);
    view.rerender(<TapFlash cue={2} />);
    expect(withSequence).toHaveBeenCalledTimes(2);
  });

  it('stops a flash still showing when its cue goes (the other half’s tap counted, the preview row picked a state)', () => {
    const view = render(<TapFlash cue={0} />);
    view.rerender(<TapFlash cue={3} />);
    vi.mocked(cancelAnimation).mockClear();
    view.rerender(<TapFlash cue={0} />);
    expect(cancelAnimation).toHaveBeenCalledTimes(1);
    expect(opacity()).toBe(0);
    expect(withSequence).toHaveBeenCalledTimes(1);
  });

  it('covers its half in lime, takes no touch and is hidden from a screen reader', () => {
    const view = render(<TapFlash cue={0} />);
    const flash = view.getByTestId('tap-flash');
    const style = getComputedStyle(flash);
    expect(style.position).toBe('absolute');
    expect([style.top, style.right, style.bottom, style.left]).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ]);
    expect(style.backgroundColor).toBe(fillOf(colour.lime));
    expect(style.pointerEvents).toBe('none');
    expect(flash.getAttribute('aria-hidden')).toBe('true');
  });

  it('still finds Reanimated’s own `System` equal to the stand-in’s', () => {
    expect(vendorSystem()).toBe('system');
  });
});
