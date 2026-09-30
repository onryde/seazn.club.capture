import { describe, expect, it } from 'vitest';
import { turnDegrees } from '@/ui/turnPose';

/**
 * The glyph is drawn tall. 0° reads as a phone held upright, ±90° as one held
 * sideways. The card renders under the kept lock (orientationGate), so the
 * glyph starts in the pose the operator is holding and ends in the one asked for.
 */
describe('turnDegrees', () => {
  it('turns sideways from the upright pose the operator holds', () => {
    expect(turnDegrees('turnSideways', 0)).toBe(0);
    expect(Math.abs(turnDegrees('turnSideways', 1))).toBe(90);
  });

  it('turns upright from the sideways pose the operator holds', () => {
    expect(Math.abs(turnDegrees('turnUpright', 0))).toBe(90);
    expect(turnDegrees('turnUpright', 1)).toBe(0);
  });

  it('moves in proportion to progress', () => {
    expect(Math.abs(turnDegrees('turnSideways', 0.5))).toBe(45);
    expect(Math.abs(turnDegrees('turnUpright', 0.5))).toBe(45);
  });
});
