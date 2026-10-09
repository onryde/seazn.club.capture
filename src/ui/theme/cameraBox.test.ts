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
  // Owner, 2026-10-08 ("one single line all the time", then the round line always shown, option B): the strip is the
  // padding, the round line's slot (one line of metricUnit, 16), a gap, the label at most 4 lines of 22 (88: C2, two
  // lines a side, D2 §4.4), a gap and ONE line of the body role (22): 2 x 8 + 16 + 6 + 88 + 6 + 22. There is no room for
  // a second message line: the caption and the status line share the one.
  it('is 154: the strip at its worst, C2’s four lines at 22, with the round line’s room in it', () => {
    expect(STRIP_RESERVE).toBe(16 + 16 + 6 + 88 + 6 + 22);
    expect(STRIP_RESERVE).toBe(154);
  });

  // Spec §4.4's table, the owner's phone as it really is (804 x 332, a 494 dp camera half) before the label is
  // measured: 332 - 154 = 178 tall, 178 x 16/9 = 316.44 wide, narrower than the half's 494 x 9/16 = 277.875 would allow.
  // Review Focus 4: the 2-line cap a side is what makes this 178, so lifting the cap fails here.
  it('leaves the owner’s phone a 316.4 x 178 picture at its worst, 804 x 332 (D2 §4.4)', () => {
    const box = cameraBoxSize({
      halfWidth: 494,
      height: 332,
      stripContent: STRIP_RESERVE,
      aspect: ASPECT,
    });
    expect(box.width).toBeCloseTo(316.4444444, 5);
    expect(box.height).toBeCloseTo(178, 9);
  });
});

// Owner, 2026-10-08, option A: the picture is sized from what THIS match's label needs, not from the strip's worst
// case. The strip is the padding, the round line's slot, a gap, the label as measured, a gap and the one message line
// (the caption when one is up, else the status line; always one line, an ellipsis if it is longer). The round line is
// ALWAYS shown (owner, option B) and its 22 dp (16 and a gap) are reserved whether or not this match has a stage, so the
// picture does not move when a stage arrives or goes (controller ruling R1). Every term but the label is a fixed
// reservation, so the reserve moves with the label alone.
describe('stripReserve (the strip a measured label needs)', () => {
  // The terms, written out from the token and type declarations: not read from the module under test.
  const PAD = 2 * layout.stripPadV; // 16
  const STAGE = layout.stageLines * typeScale.metricUnit.lineHeight; // 16: one line of metricUnit
  const MESSAGE = layout.messageLines * typeScale.body.lineHeight; // 22: one line of body
  const GAP = layout.stripGap; // 6: stage-label, and label-message
  const FIXED = PAD + STAGE + MESSAGE + 2 * GAP;

  // [name, the label's lines, its height]: one line (Match 4), a short singles label (a line a side), and C2's worst,
  // two sides of at most 2 lines each at the one `label` size (D2 §4.4).
  const LABELS = [
    ['1 line', 1 * typeScale.label.lineHeight, 22],
    ['2 lines', 2 * typeScale.label.lineHeight, 44],
    ['4 lines', 2 * layout.labelSideLines * typeScale.label.lineHeight, 88],
  ] as const;

  it('the fixed terms are 66 dp: 16 + 16 + 22 + 6 + 6, one round line and one message line', () => {
    expect(layout.messageLines).toBe(1);
    expect(layout.stageLines).toBe(1);
    expect([PAD, STAGE, MESSAGE, GAP]).toEqual([16, 16, 22, 6]);
    expect(FIXED).toBe(66);
  });

  it.each(LABELS)('%s: the reserve is the fixed 66 and the label, %d', (_name, height, literal) => {
    expect(height).toBe(literal);
    expect(stripReserve(height)).toBe(FIXED + height);
  });

  it('is 88, 110 and 154 for one, two and four lines, written out by hand', () => {
    expect(LABELS.map(([, height]) => stripReserve(height))).toEqual([88, 110, 154]);
  });

  // Before the first measurement the strip is never short: the worst case, 154.
  it.each([
    ['not measured yet (0)', 0],
    ['a negative height', -1],
    ['not a number', Number.NaN],
  ])('is the worst case, 154, for a label that is %s', (_name, height) => {
    expect(stripReserve(height)).toBe(154);
    expect(stripReserve(height)).toBe(STRIP_RESERVE);
  });

  it('the worst case is the four lines: a measured label at its largest reserves the same 154', () => {
    expect(stripReserve(88)).toBe(STRIP_RESERVE);
    expect(STRIP_RESERVE).toBe(FIXED + 88);
  });

  // A label measured TALLER than the worst case is taken as measured: the strip really is that tall (large system
  // text), so the reserve is the label plus 66, 166 for 100 dp, and past the unmeasured 154. Only the label term
  // follows the system's text size: the message line's 22 is a fixed reservation, so at a font scale over 1 that line
  // can still outgrow its room and overflow the strip. That is the strip's to bound, not this reserve's.
  it.each([
    ['100 dp, a label past the four lines', 100, 166],
    ['120 dp, a label at a large system text size', 120, 186],
  ])(
    'takes a measured label of %s as measured: %d dp of label, a reserve of %d',
    (_name, height, reserve) => {
      expect(height).toBeGreaterThan(88);
      expect(stripReserve(height)).toBe(reserve);
      expect(stripReserve(height)).toBe(FIXED + height);
      expect(stripReserve(height)).toBeGreaterThan(STRIP_RESERVE);
    },
  );

  // Swept, not sampled: every label height from 1 to 88 dp gives a reserve that is the label plus the same 66, and
  // never more than the worst case.
  it('is the label plus 66 at every height from 1 to 88, and never over the worst case', () => {
    let checked = 0;
    for (let height = 1; height <= 88; height += 1) {
      expect(stripReserve(height)).toBe(FIXED + height);
      expect(stripReserve(height)).toBeLessThanOrEqual(STRIP_RESERVE);
      checked += 1;
    }
    expect(checked).toBe(88);
  });

  // [window, camera half, height, label, box width, box height]: worked by hand. The half is the window less the
  // controls half's 310. A box is min(half x 9/16, height - the reserve): 1, 2 and 4 lines of label reserve 88, 110 and
  // 154. 804 x 332 is the owner's phone as it really is (the app area is 332 tall with the Android status bar showing).
  // Where the half limits (the half's 9/16 is the smaller) the box is the whole half: full width. With the round line's
  // room in the reserve (option B) that is 640 x 360 alone: 804 x 360 would need 278 + 88 = 366, and 915 x 412 340 + 88.
  const TABLE = [
    ['640 x 360, 1 line', 330, 360, 22, 330, 185.625],
    ['640 x 360, 2 lines', 330, 360, 44, 330, 185.625],
    ['640 x 360, 4 lines', 330, 360, 88, 330, 185.625],
    ['804 x 332, 1 line', 494, 332, 22, 433.7777778, 244],
    ['804 x 332, 2 lines', 494, 332, 44, 394.6666667, 222],
    ['804 x 332, 4 lines', 494, 332, 88, 316.4444444, 178],
    ['804 x 360, 1 line', 494, 360, 22, 483.5555556, 272],
    ['804 x 360, 2 lines', 494, 360, 44, 444.4444444, 250],
    ['804 x 360, 4 lines', 494, 360, 88, 366.2222222, 206],
    ['915 x 412, 1 line', 605, 412, 22, 576, 324],
    ['915 x 412, 2 lines', 605, 412, 44, 536.8888889, 302],
    ['915 x 412, 4 lines', 605, 412, 88, 458.6666667, 258],
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

  it('measured twelve shapes: four windows, three labels (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(12);
    // A longer label is never a larger box, on any window.
    for (let window = 0; window < 4; window += 1) {
      const [one, two, four] = TABLE.slice(window * 3, window * 3 + 3);
      expect(one?.[5]).toBeGreaterThanOrEqual(two?.[5] ?? Infinity);
      expect(two?.[5]).toBeGreaterThanOrEqual(four?.[5] ?? Infinity);
    }
    // On the owner's phone at 332 it is strictly smaller each time.
    expect(TABLE[3]?.[5]).toBeGreaterThan(TABLE[4]?.[5] ?? Infinity);
    expect(TABLE[4]?.[5]).toBeGreaterThan(TABLE[5]?.[5] ?? Infinity);
  });

  // Full width is the picture's target (owner, 2026-10-08): the box is the whole half whenever the half's 9/16 leaves
  // the strip its reserve, and the rows above that are full width are exactly those: with the round line's 22 dp
  // reserved (option B) only the smallest window, 640 x 360, where the half holds a 185.6 box and the window leaves at
  // least 206 (360 - 154, the worst label).
  it('is the whole half wherever the strip fits under it (full width), and narrower only where the window is short', () => {
    const full = TABLE.filter(([, half, , , width]) => Math.abs(width - half) < 1e-6);
    expect(full.map(([name]) => name)).toEqual([
      '640 x 360, 1 line',
      '640 x 360, 2 lines',
      '640 x 360, 4 lines',
    ]);
  });
});
