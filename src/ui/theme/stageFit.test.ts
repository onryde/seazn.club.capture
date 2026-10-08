import { describe, expect, it } from 'vitest';
import { cameraBoxSize, STRIP_RESERVE } from '@/ui/theme/cameraBox';
import { stageFits } from '@/ui/theme/stageFit';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

// The four real geometries of viewfinderFit.test.ts (spec §1), each with the strip it leaves, written by hand.
// There is no 640 × 412 phone. The strip is what cameraBoxSize leaves under the box in the half the layout really
// gives the camera: since the owner's rule of 2026-10-08 the controls half is `layout.controlsHalf` (310) and the
// camera half is the rest, 330 at 640 wide. That half would hold a box 186 tall, but the strip leaves 180, so the
// box yields to the strip at 640 × 360 too and the strip is 180 on every one of these screens. (Before the rule the
// half was (W - 2 × the controls padding) / 2 = 304 at 640, the box 171 and the strip 189.)
const GEOMETRIES = [
  [640, 360, 180],
  [800, 360, 180],
  [844, 390, 180],
  [915, 412, 180],
] as const;

const stripAt = (width: number, height: number) =>
  height -
  cameraBoxSize({
    halfWidth: width - layout.controlsHalf,
    height,
    stripContent: STRIP_RESERVE,
    aspect: layout.previewAspect,
  }).height;

const regular = typeScale.label.lineHeight; // 22
const long = typeScale.labelLong.lineHeight; // 19

// [why, label height, fits in a 180 strip (room 54)]: the table in Task 4, restated in dp and written by hand, never
// computed from stageFits. (Its fourth column, "fits in a 189 strip", went with the 189 strip: no screen has one now.)
const LABELS: readonly (readonly [string, number, boolean])[] = [
  ['1 line regular', regular, true],
  ['2 lines regular', 2 * regular, true],
  ['2 lines long', 2 * long, true],
  ['3 lines long', 3 * long, false],
  ['3 lines regular', 3 * regular, false],
  ['4 lines long (the strip’s worst case)', 4 * long, false],
];

let checked = 0;

describe('the round line yields when the strip has no room (R-F5)', () => {
  it('the strip is 180 dp on every real screen, 640 × 360 included, from the half the layout gives', () => {
    const strips = GEOMETRIES.map(([width, height]) => stripAt(width, height));
    // To 6 places: the box is height - 180 tall, so the strip is the 180 left under it.
    expect(strips.map((strip) => Math.round(strip * 1e6) / 1e6)).toEqual(
      GEOMETRIES.map((geometry) => geometry[2]),
    );
    // The half at 640 (330) would hold a box 185.6 tall: it is the strip that limits the box, not the half.
    expect((640 - layout.controlsHalf) / layout.previewAspect).toBeCloseTo(185.625, 6);
  });

  it('the room beside the round line is 54 dp in a 180 strip and 63 dp in a 189 one (arithmetic: no screen has a 189 strip now)', () => {
    const roomIn = (strip: number) =>
      strip -
      (2 * layout.stripPadV +
        layout.stageLines * typeScale.metricUnit.lineHeight +
        layout.statusLinesMax * typeScale.body.lineHeight +
        layout.captionLinesMax * typeScale.metricUnit.lineHeight +
        3 * layout.stripGap);
    expect(roomIn(180)).toBe(54);
    expect(roomIn(189)).toBe(63);
  });

  it('the label heights are the table’s: 22, 44, 38, 57, 66, 76', () => {
    expect(LABELS.map((row) => row[1])).toEqual([22, 44, 38, 57, 66, 76]);
  });

  describe.each(GEOMETRIES)('at %i × %i (a strip of %d)', (width, height) => {
    it.each(LABELS)('%s', (_why, label, fits) => {
      expect(stageFits(stripAt(width, height), label)).toBe(fits);
      checked += 1;
    });
  });

  it('the edge is inclusive: a label of exactly the room fits, one dp more does not; the full 202 dp stack fits only a 202 dp strip', () => {
    expect(stageFits(180, 54)).toBe(true);
    expect(stageFits(180, 55)).toBe(false);
    expect(stageFits(189, 63)).toBe(true);
    expect(stageFits(189, 64)).toBe(false);
    expect(stageFits(202, 4 * long)).toBe(true);
    expect(stageFits(201, 4 * long)).toBe(false);
  });

  it('not measured yet, strip or label, is hidden: a phone never paints a line it may have to take back', () => {
    expect(stageFits(0, 2 * regular)).toBe(false);
    expect(stageFits(180, 0)).toBe(false);
  });

  it('checked 4 geometries × 6 labels, with both answers present (anti-vacuity)', () => {
    expect(LABELS).toHaveLength(6);
    expect(LABELS.filter((row) => row[2])).toHaveLength(3);
    expect(LABELS.filter((row) => !row[2])).toHaveLength(3);
    expect(checked).toBe(GEOMETRIES.length * LABELS.length);
  });
});
