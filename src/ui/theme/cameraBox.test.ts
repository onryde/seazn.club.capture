import { describe, expect, it } from 'vitest';
import { cameraBoxSize, STRIP_RESERVE, stripReserve } from '@/ui/theme/cameraBox';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

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
    // The owner's rule (2026-10-08), 640 x 360: the camera half is 640 - 310 = 330, which holds 185.6, but 360 - 180 = 180
    // is all the strip leaves: 180 x 16/9 = 320. (Before the rule the half was 304: 304 x 9/16 = 171, a box of 304 x 171.)
    ['640 x 360 at 180, the controls half 310', 330, 360, 180, 320, 180],
    // The owner's phone, 804 x 360: the half is 494 and holds 277.9, but the strip leaves 180: the same 320 x 180.
    ['804 x 360 at 180, the controls half 310', 494, 360, 180, 320, 180],
  ] as const;

  it.each(CASES)('%s', (_name, halfWidth, height, stripContent, width, boxHeight) => {
    const box = cameraBoxSize({ halfWidth, height, stripContent, aspect: ASPECT });
    expect(box.width).toBeCloseTo(width, 5);
    expect(box.height).toBeCloseTo(boxHeight, 5);
  });

  it('ran eight hand-worked cases', () => {
    expect(CASES).toHaveLength(8);
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

  // Swept, not sampled: every shape from 640 x 360 up, in steps of 8 dp wide and 4 dp high, against the invariants, in
  // the half the owner's rule gives the camera (the window less the controls half, 2026-10-08).
  it('is 16:9, inside its half, and leaves the strip its content, at every size from 640 x 360', () => {
    let checked = 0;
    for (let width = 640; width <= 1000; width += 8) {
      for (let height = 360; height <= 460; height += 4) {
        const halfWidth = width - layout.controlsHalf;
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

// Owner, 2026-10-08, option A: the picture is sized from what THIS match's label needs, not from the strip's worst
// case. The strip is the padding, the label as measured, the status line's two lines, the caption's two lines and the
// gaps between the three. Every term but the label is a fixed reservation, so the reserve moves with the label alone.
describe('stripReserve (the strip a measured label needs)', () => {
  // The terms, written out from the token and type declarations: not read from the module under test.
  const PAD = 2 * layout.stripPadV; // 16
  const STATUS = layout.statusLinesMax * typeScale.body.lineHeight; // 44
  const CAPTION = layout.captionLinesMax * typeScale.metricUnit.lineHeight; // 32
  const GAPS = 2 * layout.stripGap; // 12: label-status and status-caption
  const FIXED = PAD + STATUS + CAPTION + GAPS;

  // [name, the label's lines, its height]: one regular line (Match 4), a short singles label (a line a side), and the
  // four lines of a long double at the long size.
  const LABELS = [
    ['1 line', 1 * typeScale.label.lineHeight, 22],
    ['2 lines', 2 * typeScale.label.lineHeight, 44],
    ['4 long lines', layout.labelLinesMax * typeScale.labelLong.lineHeight, 76],
  ] as const;

  it('the fixed terms are 104 dp: 16 + 44 + 32 + 12', () => {
    expect([PAD, STATUS, CAPTION, GAPS]).toEqual([16, 44, 32, 12]);
    expect(FIXED).toBe(104);
  });

  it.each(LABELS)(
    '%s: the reserve is the fixed 104 and the label, %d',
    (_name, height, literal) => {
      expect(height).toBe(literal);
      expect(stripReserve(height)).toBe(FIXED + height);
    },
  );

  it('is 126, 148 and 180 for one, two and four lines, written out by hand', () => {
    expect(LABELS.map(([, height]) => stripReserve(height))).toEqual([126, 148, 180]);
  });

  // Before the first measurement the strip is never short: the worst case, the 180 it always was.
  it.each([
    ['not measured yet (0)', 0],
    ['a negative height', -1],
    ['not a number', Number.NaN],
  ])('is the worst case, 180, for a label that is %s', (_name, height) => {
    expect(stripReserve(height)).toBe(180);
    expect(stripReserve(height)).toBe(STRIP_RESERVE);
  });

  it('the worst case is the four long lines: a measured label at its largest reserves the same 180', () => {
    expect(stripReserve(76)).toBe(STRIP_RESERVE);
    expect(STRIP_RESERVE).toBe(FIXED + 76);
  });

  // A label measured TALLER than the worst case is taken as measured: the strip really is that tall (large system
  // text), so the reserve is the label plus 104, 192 for 88 dp, and past the unmeasured 180. Only the label term
  // follows the system's text size: the status line's 44 and the caption's 32 are fixed reservations, so at a font
  // scale over 1 those two can still overflow the strip. That is the strip's to bound, not this reserve's.
  it.each([
    ['88 dp, a label past the four long lines', 88, 192],
    ['120 dp, a label at a large system text size', 120, 224],
  ])('takes a measured label of %s as measured: the reserve is %d', (_name, height, reserve) => {
    expect(height).toBeGreaterThan(76);
    expect(stripReserve(height)).toBe(reserve);
    expect(stripReserve(height)).toBe(FIXED + height);
    expect(stripReserve(height)).toBeGreaterThan(STRIP_RESERVE);
  });

  // Swept, not sampled: every label height from 1 to 76 dp gives a reserve that is the label plus the same 104, and
  // never more than the worst case.
  it('is the label plus 104 at every height from 1 to 76, and never over the worst case', () => {
    let checked = 0;
    for (let height = 1; height <= 76; height += 1) {
      expect(stripReserve(height)).toBe(FIXED + height);
      expect(stripReserve(height)).toBeLessThanOrEqual(STRIP_RESERVE);
      checked += 1;
    }
    expect(checked).toBe(76);
  });

  // [window, camera half, height, label, box width, box height]: worked by hand. The half is the window less the
  // controls half's 310. A box is min(half x 9/16, height - the reserve): 1, 2 and 4 lines reserve 126, 148, 180.
  const TABLE = [
    ['640 x 360, 1 line', 330, 360, 22, 330, 185.625],
    ['640 x 360, 2 lines', 330, 360, 44, 330, 185.625],
    ['640 x 360, 4 lines', 330, 360, 76, 320, 180],
    ['804 x 360, 1 line', 494, 360, 22, 416, 234],
    ['804 x 360, 2 lines', 494, 360, 44, 376.8888889, 212],
    ['804 x 360, 4 lines', 494, 360, 76, 320, 180],
    ['915 x 412, 1 line', 605, 412, 22, 508.4444444, 286],
    ['915 x 412, 2 lines', 605, 412, 44, 469.3333333, 264],
    ['915 x 412, 4 lines', 605, 412, 76, 412.4444444, 232],
  ] as const;

  it.each(TABLE)('%s', (_name, halfWidth, height, label, width, boxHeight) => {
    expect(halfWidth).toBe(Number(_name.split(' ')[0]) - layout.controlsHalf);
    const box = cameraBoxSize({
      halfWidth,
      height,
      stripContent: stripReserve(label),
      aspect: ASPECT,
    });
    expect(box.width).toBeCloseTo(width, 5);
    expect(box.height).toBeCloseTo(boxHeight, 5);
    expect(box.width / box.height).toBeCloseTo(ASPECT, 9);
  });

  it('measured nine shapes: three windows, three labels (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(9);
    // A longer label is never a larger box, on any window.
    for (let window = 0; window < 3; window += 1) {
      const [one, two, four] = TABLE.slice(window * 3, window * 3 + 3);
      expect(one?.[5]).toBeGreaterThanOrEqual(two?.[5] ?? Infinity);
      expect(two?.[5]).toBeGreaterThanOrEqual(four?.[5] ?? Infinity);
    }
    // And on the owner's phone it is strictly smaller each time.
    expect(TABLE[3]?.[5]).toBeGreaterThan(TABLE[4]?.[5] ?? Infinity);
    expect(TABLE[4]?.[5]).toBeGreaterThan(TABLE[5]?.[5] ?? Infinity);
  });
});
