import { describe, expect, it } from 'vitest';
import { cameraBoxSize, STRIP_RESERVE } from '@/ui/theme/cameraBox';

/** Spec §1: a 16:9 box. Written here, not read from a token. */
const ASPECT = 16 / 9;

/**
 * The camera box (spec §1, owner ruling on the fix round): the strip keeps its content height and the
 * box gives way. Height = min(half width x 9/16, screen height - the strip's content); width = height x
 * 16/9, so the box is 16:9 and never wider than its half.
 */
describe('cameraBoxSize', () => {
  // [name, half width, height, strip content, box width, box height]: each worked by hand from the rule.
  const CASES = [
    // Width-limited: the box is the whole half. 320 x 9/16 = 180; 360 - 180 = 180 holds the strip.
    ['640 x 360 at 180: the whole half', 320, 360, 180, 320, 180],
    // Height-limited: 400 x 9/16 = 225, but 360 - 180 = 180 is all the strip leaves.
    ['800 x 360 at 180: the box gives way', 400, 360, 180, 320, 180],
    // 422 x 9/16 = 237.375; 390 - 180 = 210; 210 x 16/9 = 373.33.
    ['844 x 390 at 180', 422, 390, 180, 373.3333333, 210],
    // 457.5 x 9/16 = 257.34; 412 - 180 = 232; 232 x 16/9 = 412.44.
    ['915 x 412 at 180', 457.5, 412, 180, 412.4444444, 232],
    // The owner's one-line-caption strip (164): 390 - 164 = 226; 226 x 16/9 = 401.78.
    ['844 x 390 at 164', 422, 390, 164, 401.7777778, 226],
    // A tall, narrow screen is width-limited again: 200 x 9/16 = 112.5, and 800 - 180 is far more.
    ['a tall screen', 200, 800, 180, 200, 112.5],
  ] as const;

  it.each(CASES)('%s', (_name, halfWidth, height, stripContent, width, boxHeight) => {
    const box = cameraBoxSize({ halfWidth, height, stripContent, aspect: ASPECT });
    expect(box.width).toBeCloseTo(width, 5);
    expect(box.height).toBeCloseTo(boxHeight, 5);
  });

  it('ran six hand-worked cases', () => {
    expect(CASES).toHaveLength(6);
  });

  // The empty cases: nothing to draw is a box of nothing, never a negative size.
  it.each([
    ['a strip taller than the screen', 320, 160, 180],
    ['a strip exactly the screen', 320, 180, 180],
    ['no half width', 0, 360, 180],
    ['no height', 320, 0, 180],
    ['a negative height', 320, -10, 180],
  ] as const)('is a box of nothing for %s', (_name, halfWidth, height, stripContent) => {
    expect(cameraBoxSize({ halfWidth, height, stripContent, aspect: ASPECT })).toEqual({
      width: 0,
      height: 0,
    });
  });

  // Swept, not sampled: every shape from 640 x 360 up, in steps of 8 dp wide and 4 dp high, against the invariants.
  it('is 16:9, inside its half, and leaves the strip its content, at every size from 640 x 360', () => {
    let checked = 0;
    for (let width = 640; width <= 1000; width += 8) {
      for (let height = 360; height <= 460; height += 4) {
        const halfWidth = width / 2;
        const box = cameraBoxSize({ halfWidth, height, stripContent: 180, aspect: ASPECT });
        expect(box.width).toBeLessThanOrEqual(halfWidth + 1e-9);
        expect(box.height).toBeLessThanOrEqual((halfWidth * 9) / 16 + 1e-9);
        expect(box.height + 180).toBeLessThanOrEqual(height + 1e-9);
        expect(box.width / box.height).toBeCloseTo(ASPECT, 9);
        // The box is the whole half whenever the strip fits under it, and never otherwise.
        const fits = (halfWidth * 9) / 16 + 180 <= height;
        expect(Math.abs(box.width - halfWidth) < 1e-9).toBe(fits);
        checked += 1;
      }
    }
    expect(checked).toBe(46 * 26);
  });
});

describe('STRIP_RESERVE', () => {
  // Q4 option A: the label at most 4 lines of 19 (76), the status line 2 of 22 (44), the caption 2 of 16
  // (32), 2 x 8 padding and 2 x 6 between the three.
  it('is 180: the strip at its worst, whatever the width', () => {
    expect(STRIP_RESERVE).toBe(16 + 76 + 44 + 32 + 12);
    expect(STRIP_RESERVE).toBe(180);
  });
});
