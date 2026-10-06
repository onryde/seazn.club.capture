import { describe, expect, it } from 'vitest';
import { classify, HOLD_MS, INITIAL_TRACKER, track } from '@/domain/orientation/orientation';
import shared from './wire/pose-vectors.json';

const gravity = (g: readonly number[]) => {
  const [x, y, z] = g as [number, number, number];
  return { x, y, z };
};

describe('A11: JS and native share one held-pose rule', () => {
  // The file's counts, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 24 shared rows and all 8 shared tracks', () => {
    expect(shared.rows).toHaveLength(24);
    expect(shared.tracks).toHaveLength(8);
  });

  it.each(shared.rows)('$why', ({ g, physical }) => {
    expect(classify(gravity(g))).toBe(physical);
  });

  it('the hold before a reading settles', () => {
    expect(HOLD_MS).toBe(shared.holdMs);
  });

  it.each(shared.tracks)('track: $why', ({ steps }) => {
    let tracker = INITIAL_TRACKER;
    const settled = steps.map((step) => {
      tracker = track(tracker, gravity(step.g), step.atMs);
      return tracker.settled;
    });
    expect(settled).toEqual(steps.map((step) => step.settled));
  });
});
