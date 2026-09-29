import { describe, expect, it } from 'vitest';
import {
  classify,
  HOLD_MS,
  INITIAL_TRACKER,
  orientationGate,
  track,
  type GateView,
  type Gravity,
  type OrientationTracker,
  type Physical,
  type Target,
} from '@/domain/orientation/orientation';

/** Gravity for a phone rotated `deg` from upright about the screen normal. */
const tilted = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad), z: 0 };
};
const FLAT: Gravity = { x: 0.05, y: 0.05, z: 0.99 };
/** Gravity for an upright phone whose screen is `deg` above horizontal (0 = on a table). */
const reclined = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: 0, y: Math.sin(rad), z: Math.cos(rad) };
};

describe('classify', () => {
  it.each([
    [0, 'portrait'],
    [25, 'portrait'],
    [180, 'portrait'],
    [65, 'landscape'],
    [90, 'landscape'],
    [-90, 'landscape'],
  ])('%i° from upright is %s', (deg, physical) => {
    expect(classify(tilted(deg))).toBe(physical);
  });

  it.each([40, 45, 55])('%i° is inside the band and decides nothing', (deg) => {
    expect(classify(tilted(deg))).toBeNull();
  });

  it('reads a phone on a table as flat', () => {
    expect(classify(FLAT)).toBe('flat');
  });

  it('reads a phone ~25° off the table as undecided, not flat', () => {
    expect(classify(reclined(25))).toBeNull();
  });

  it('reads an upright phone reclined to ~40° as portrait', () => {
    expect(classify(reclined(40))).toBe('portrait');
  });

  it('reads no gravity as unknown', () => {
    expect(classify({ x: 0, y: 0, z: 0 })).toBe('unknown');
  });
});

/** Feed samples every 50 ms. */
function feed(samples: readonly Gravity[], start: OrientationTracker = INITIAL_TRACKER) {
  return samples.reduce((tracker, g, i) => track(tracker, g, i * 50), start);
}
const repeat = (g: Gravity, n: number) => Array.from({ length: n }, () => g);

describe('track', () => {
  it('settles only after the reading has held for HOLD_MS', () => {
    const justShort = feed(repeat(tilted(90), HOLD_MS / 50));
    expect(justShort.settled).toBe('unknown');
    const held = feed(repeat(tilted(90), HOLD_MS / 50 + 1));
    expect(held.settled).toBe('landscape');
  });

  it('does not flicker when the phone wobbles around 45°', () => {
    const upright = feed(repeat(tilted(0), 10));
    const wobble = [40, 50, 44, 56, 48, 52, 41, 58].map(tilted);
    const after = wobble.reduce((t, g, i) => track(t, g, 1000 + i * 50), upright);
    expect(after.settled).toBe('portrait');
  });

  it('ignores a brief swing that does not hold', () => {
    const upright = feed(repeat(tilted(0), 10));
    const swing = [tilted(90), tilted(90), tilted(0), tilted(0)];
    const states = swing.map((_, n) =>
      swing.slice(0, n + 1).reduce((t, g, i) => track(t, g, 1000 + i * 50), upright),
    );
    expect(states.map((s) => s.settled)).toEqual(['portrait', 'portrait', 'portrait', 'portrait']);
  });

  it('never settles flat while a held phone drifts between 25° and 40° reclined', () => {
    const upright = feed(repeat(tilted(0), 10));
    const drift = [25, 40, 25].flatMap((deg) => repeat(reclined(deg), 8));
    const settled = drift.reduce<OrientationTracker[]>(
      (states, g, i) => [...states, track(states[states.length - 1] ?? upright, g, 1000 + i * 50)],
      [],
    );
    expect(settled.every((s) => s.settled === 'portrait')).toBe(true);
  });

  it('restarts the hold when a reading dips into the band', () => {
    const upright = feed(repeat(tilted(0), 10));
    const interrupted = [90, 90, 90, 45, 90, 90, 90].map(tilted);
    const after = interrupted.reduce((t, g, i) => track(t, g, 1000 + i * 50), upright);
    expect(after.settled).toBe('portrait');
  });
});

describe('orientationGate', () => {
  // Every (target, physical, onAir) combination (ruling R24).
  it.each<[Target, Physical, boolean, GateView]>([
    ['portrait', 'portrait', false, { lock: 'portrait', card: 'none' }],
    ['portrait', 'portrait', true, { lock: 'portrait', card: 'none' }],
    ['portrait', 'landscape', false, { lock: 'landscape', card: 'turnUpright' }],
    ['portrait', 'landscape', true, { lock: 'keep', card: 'turnUpright' }],
    ['portrait', 'flat', false, { lock: 'portrait', card: 'none' }],
    ['portrait', 'flat', true, { lock: 'portrait', card: 'none' }],
    ['portrait', 'unknown', false, { lock: 'keep', card: 'none' }],
    ['portrait', 'unknown', true, { lock: 'keep', card: 'none' }],
    ['landscape', 'landscape', false, { lock: 'landscape', card: 'none' }],
    ['landscape', 'landscape', true, { lock: 'landscape', card: 'none' }],
    ['landscape', 'portrait', false, { lock: 'portrait', card: 'turnSideways' }],
    ['landscape', 'portrait', true, { lock: 'keep', card: 'turnSideways' }],
    ['landscape', 'flat', false, { lock: 'landscape', card: 'none' }],
    ['landscape', 'flat', true, { lock: 'landscape', card: 'none' }],
    ['landscape', 'unknown', false, { lock: 'keep', card: 'none' }],
    ['landscape', 'unknown', true, { lock: 'keep', card: 'none' }],
  ])('target %s, held %s, on air %s → %j', (target, physical, onAir, view) => {
    expect(orientationGate(target, physical, onAir)).toEqual(view);
  });
});
