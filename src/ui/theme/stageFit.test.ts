import { describe, expect, it } from 'vitest';
import { cameraBoxSize, STRIP_RESERVE } from '@/ui/theme/cameraBox';
import { stageFits } from '@/ui/theme/stageFit';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

// The four real geometries of viewfinderFit.test.ts (spec §1). There is no 640 × 412 phone: the strip
// here is what cameraBoxSize leaves under the box, never a number typed to suit the test.
const GEOMETRIES = [
  [640, 360],
  [800, 360],
  [844, 390],
  [915, 412],
] as const;

const stripAt = (width: number, height: number) =>
  height -
  cameraBoxSize({
    halfWidth: width / 2,
    height,
    stripContent: STRIP_RESERVE,
    aspect: layout.previewAspect,
  }).height;

const regular = typeScale.label.lineHeight; // 22
const long = typeScale.labelLong.lineHeight; // 19

// [why, label height, fits]: the table in Task 4, restated in dp (room 54). Written by hand from the
// task's table, never computed from stageFits.
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
  it('the strip is 180 dp at each of the four real geometries (P8)', () => {
    const strips = GEOMETRIES.map(([width, height]) => stripAt(width, height));
    expect(strips).toEqual([180, 180, 180, 180]);
  });

  it('the room beside the round line is 54 dp', () => {
    const room =
      180 -
      (2 * layout.stripPadV +
        layout.stageLines * typeScale.metricUnit.lineHeight +
        layout.statusLinesMax * typeScale.body.lineHeight +
        layout.captionLinesMax * typeScale.metricUnit.lineHeight +
        3 * layout.stripGap);
    expect(room).toBe(54);
  });

  it('the label heights are the table’s: 22, 44, 38, 57, 66, 76', () => {
    expect(LABELS.map((row) => row[1])).toEqual([22, 44, 38, 57, 66, 76]);
  });

  describe.each(GEOMETRIES)('at %i × %i', (width, height) => {
    it.each(LABELS)('%s', (_why, label, fits) => {
      expect(stageFits(stripAt(width, height), label)).toBe(fits);
      checked += 1;
    });
  });

  it('the edge is inclusive: a label of exactly the 54 dp room fits, one dp more does not; the full 202 dp stack fits only a 202 dp strip', () => {
    expect(stageFits(180, 54)).toBe(true);
    expect(stageFits(180, 55)).toBe(false);
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
