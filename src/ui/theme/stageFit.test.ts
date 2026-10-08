import { describe, expect, it } from 'vitest';
import { cameraBoxSize, stripReserve } from '@/ui/theme/cameraBox';
import { stageFits } from '@/ui/theme/stageFit';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

// R-F5 under the owner's rulings of 2026-10-08. The picture is sized from this match's label (`stripReserve`: the
// padding, the label, one gap and ONE message line), so the strip under it is the label's reserve wherever the box is
// height-limited, and what the window leaves wherever the half limits it (640 × 360, and 804 × 360 for a short label).
// The round line is the strip's guest: it shows when the strip has room for it beside what is really there (the
// padding, the label, the message line and a gap each side of it), and it never makes the picture smaller. The caption
// takes the message line and not more room, so it is not a term of the fit.
//
// The geometries are the real windows of viewfinderFit.test.ts (spec §1) and the owner's phone as it really is, 804 ×
// 332 (the Android status bar stays). There is no 640 × 412 phone. The camera half is the window less the controls
// half (`layout.controlsHalf`, 310).
const GEOMETRIES = [
  [640, 360], // the half limits the box (330 wide holds 185.625) for every label
  [804, 332], // the owner's phone, status bar showing: the window limits the box
  [804, 360], // the half limits the box (494 holds 277.875) up to a label of 38 dp
  [844, 390],
  [915, 412],
] as const;

const stripAt = (width: number, height: number, label: number) =>
  height -
  cameraBoxSize({
    halfWidth: width - layout.controlsHalf,
    height,
    stripContent: stripReserve(label),
    aspect: layout.previewAspect,
  }).height;

const regular = typeScale.label.lineHeight; // 22
const long = typeScale.labelLong.lineHeight; // 19

// [why, label height]: the table in Task 4, restated in dp and written by hand, never computed from stageFits.
const LABELS: readonly (readonly [string, number])[] = [
  ['1 line regular', regular],
  ['2 lines regular', 2 * regular],
  ['2 lines long', 2 * long],
  ['3 lines long', 3 * long],
  ['3 lines regular', 3 * regular],
  ['4 lines long (the strip’s worst case)', 4 * long],
];

// What the round line needs, written out from the declarations, never from stageFit.ts: the padding, the line, the
// label, the one message line, and a gap between each pair of the three items.
const PAD = 2 * layout.stripPadV;
const STAGE = layout.stageLines * typeScale.metricUnit.lineHeight;
const MESSAGE = layout.messageLines * typeScale.body.lineHeight;
const needs = (label: number) => PAD + STAGE + label + MESSAGE + 2 * layout.stripGap;

// The answers by hand. Height-limited, the strip is the reserve, 44 + the label, and the round line needs 66 + the
// label: 22 over the reserve, so it does not fit and never shrinks the picture. It fits where the half limits the box
// and the window leaves more: 640 × 360 (a strip of 360 - 185.625 = 174.375, enough for every label here), and 844 × 390
// for the one-line label (a strip of 390 - 300.375 = 89.625 against the 88 it needs). At 804 × 360 the strip is
// 82.125 for a label up to 38 dp and the reserve beyond, so none fits; at 804 × 332 and 915 × 412 none fits either.
//   [one answer per label row], in LABELS order, per geometry
const ANSWERS: readonly (readonly boolean[])[] = [
  [true, true, true, true, true, true],
  [false, false, false, false, false, false],
  [false, false, false, false, false, false],
  [true, false, false, false, false, false],
  [false, false, false, false, false, false],
];

let checked = 0;

describe('the round line yields when the strip has no room (R-F5)', () => {
  it('the strip is the label’s reserve where the box is height-limited, 44 dp and the label; the half limits it at 640 × 360', () => {
    // [width, height, label, strip]
    const STRIPS = [
      [804, 332, 44, 88],
      [804, 332, 22, 66],
      [804, 360, 44, 88],
      [804, 360, 22, 82.125],
      [844, 390, 22, 89.625],
      [915, 412, 44, 88],
      [915, 412, 76, 120],
      [640, 360, 44, 174.375],
      [640, 360, 76, 174.375],
    ] as const;
    for (const [width, height, label, strip] of STRIPS) {
      expect(stripAt(width, height, label), `${width} × ${height}, label ${label}`).toBeCloseTo(
        strip,
        6,
      );
    }
    // The half at 640 (330) holds a box 185.625 tall for every label here: it is the half that limits the box.
    expect((640 - layout.controlsHalf) / layout.previewAspect).toBeCloseTo(185.625, 6);
  });

  it('the round line needs 22 dp more than the strip’s reserve: 66 and the label against 44 and the label', () => {
    expect(needs(44)).toBe(110);
    expect(stripReserve(44)).toBe(88);
    expect(needs(44) - stripReserve(44)).toBe(STAGE + layout.stripGap);
    expect(STAGE + layout.stripGap).toBe(22);
  });

  it('the label heights are the table’s: 22, 44, 38, 57, 66, 76', () => {
    expect(LABELS.map((row) => row[1])).toEqual([22, 44, 38, 57, 66, 76]);
  });

  describe.each(GEOMETRIES.map((geometry, at) => [...geometry, at] as const))(
    'at %i × %i',
    (width, height, at) => {
      it.each(LABELS.map((row, label) => [...row, label] as const))('%s', (_why, label, row) => {
        const strip = stripAt(width, height, label);
        expect(stageFits(strip, label)).toBe(ANSWERS[at]?.[row]);
        // The hand answers agree with the needs written out above, so a typo in the table cannot hide.
        expect(stageFits(strip, label)).toBe(needs(label) <= strip + 1e-9);
        checked += 1;
      });
    },
  );

  it('the edge is inclusive: a strip of exactly what is needed fits, one dp less does not', () => {
    expect(stageFits(110, 44)).toBe(true);
    expect(stageFits(109, 44)).toBe(false);
    // The full stack, the round line above a four-line label: 142 dp.
    expect(stageFits(142, 4 * long)).toBe(true);
    expect(stageFits(141, 4 * long)).toBe(false);
  });

  it('not measured yet, strip or label, is hidden: a phone never paints a line it may have to take back', () => {
    expect(stageFits(0, 2 * regular)).toBe(false);
    expect(stageFits(180, 0)).toBe(false);
    expect(stageFits(300, 0)).toBe(false);
    expect(stageFits(-1, 2 * regular)).toBe(false);
  });

  it('checked 5 geometries × 6 labels, with both answers present (anti-vacuity)', () => {
    expect(LABELS).toHaveLength(6);
    expect(ANSWERS).toHaveLength(GEOMETRIES.length);
    const all = ANSWERS.flat();
    expect(all).toHaveLength(GEOMETRIES.length * LABELS.length);
    expect(all.filter(Boolean).length).toBeGreaterThan(0);
    expect(all.filter((answer) => !answer).length).toBeGreaterThan(0);
    expect(checked).toBe(GEOMETRIES.length * LABELS.length);
  });
});
