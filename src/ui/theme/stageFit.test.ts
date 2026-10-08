import { describe, expect, it } from 'vitest';
import { cameraBoxSize, stripReserve } from '@/ui/theme/cameraBox';
import { stageFits } from '@/ui/theme/stageFit';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

// R-F5 under the owner's rulings of 2026-10-08. The picture is sized from this match's label (`stripReserve`), so the
// strip under it is the label's reserve wherever the box is height-limited, and what the window leaves wherever the
// half limits it (640 × 360). The strip always holds room for a caption (two lines of `metricUnit`), up or not. The
// round line shows when it fits beside what is really there: with a caption up that is the whole reserve, and the
// round line has no room; with none, the caption's room is room, and it fits.
//
// The four real geometries of viewfinderFit.test.ts (spec §1). There is no 640 × 412 phone. The camera half is the
// window less the controls half (`layout.controlsHalf`, 310).
const GEOMETRIES = [
  [640, 360], // the half limits the box (330 wide holds 185.625), unless the label is four long lines
  [800, 360],
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
// label, the status line's two lines, the caption's two when one is up, and a gap between the items.
const PAD = 2 * layout.stripPadV;
const STAGE = layout.stageLines * typeScale.metricUnit.lineHeight;
const STATUS = layout.statusLinesMax * typeScale.body.lineHeight;
const CAPTION = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
const needs = (label: number, captionUp: boolean) =>
  PAD + STAGE + label + STATUS + (captionUp ? CAPTION : 0) + (captionUp ? 3 : 2) * layout.stripGap;

// The answers by hand. Height-limited, the strip is the reserve, 104 + the label: with no caption the round line needs
// 88 + the label, so it fits with 16 spare; with a caption it needs 126 + the label, 22 over the reserve, so it does
// not. At 640 × 360 the half limits the box up to a label of 70 dp, leaving a strip of 360 - 185.625 = 174.375, which
// holds the round line and a caption for labels up to 48 dp (the first three) and no more.
//   [label rows ...] in LABELS order, per geometry: [no caption, a caption]
const ANSWERS: readonly (readonly [readonly boolean[], readonly boolean[]])[] = [
  [
    [true, true, true, true, true, true],
    [true, true, true, false, false, false],
  ],
  [
    [true, true, true, true, true, true],
    [false, false, false, false, false, false],
  ],
  [
    [true, true, true, true, true, true],
    [false, false, false, false, false, false],
  ],
  [
    [true, true, true, true, true, true],
    [false, false, false, false, false, false],
  ],
];

let checked = 0;

describe('the round line yields when the strip has no room (R-F5)', () => {
  it('the strip is the label’s reserve where the box is height-limited, 104 dp and the label; at 640 × 360 the half limits it', () => {
    // [width, height, label, strip]
    const STRIPS = [
      [800, 360, 44, 148],
      [844, 390, 44, 148],
      [915, 412, 22, 126],
      [915, 412, 76, 180],
      [640, 360, 44, 174.375],
      [640, 360, 76, 180],
    ] as const;
    for (const [width, height, label, strip] of STRIPS) {
      expect(stripAt(width, height, label), `${width} × ${height}, label ${label}`).toBeCloseTo(
        strip,
        6,
      );
    }
    // The half at 640 (330) would hold a box 185.625 tall: until the label is 4 lines it is the half that limits the box.
    expect((640 - layout.controlsHalf) / layout.previewAspect).toBeCloseTo(185.625, 6);
  });

  it('the room beside the round line is 38 dp more with no caption up: the caption’s 32 and one gap', () => {
    expect(needs(44, false)).toBe(132);
    expect(needs(44, true)).toBe(170);
    expect(needs(44, true) - needs(44, false)).toBe(CAPTION + layout.stripGap);
    expect(CAPTION + layout.stripGap).toBe(38);
  });

  it('the label heights are the table’s: 22, 44, 38, 57, 66, 76', () => {
    expect(LABELS.map((row) => row[1])).toEqual([22, 44, 38, 57, 66, 76]);
  });

  describe.each(GEOMETRIES.map((geometry, at) => [...geometry, at] as const))(
    'at %i × %i',
    (width, height, at) => {
      it.each(LABELS.map((row, label) => [...row, label] as const))('%s', (_why, label, row) => {
        const strip = stripAt(width, height, label);
        const [noCaption, caption] = ANSWERS[at] ?? [[], []];
        expect(stageFits(strip, label, false), 'no caption up').toBe(noCaption[row]);
        expect(stageFits(strip, label, true), 'a caption up').toBe(caption[row]);
        // The hand answers agree with the needs written out above, so a typo in the table cannot hide.
        expect(stageFits(strip, label, false)).toBe(needs(label, false) <= strip + 1e-9);
        expect(stageFits(strip, label, true)).toBe(needs(label, true) <= strip + 1e-9);
        checked += 2;
      });
    },
  );

  it('the edge is inclusive: a strip of exactly what is needed fits, one dp less does not, with and without a caption', () => {
    expect(stageFits(132, 44, false)).toBe(true);
    expect(stageFits(131, 44, false)).toBe(false);
    expect(stageFits(170, 44, true)).toBe(true);
    expect(stageFits(169, 44, true)).toBe(false);
    // The full stack, the round line above a four-line label with a caption: 202 dp.
    expect(stageFits(202, 4 * long, true)).toBe(true);
    expect(stageFits(201, 4 * long, true)).toBe(false);
  });

  it('not measured yet, strip or label, is hidden with or without a caption: a phone never paints a line it may have to take back', () => {
    for (const captionUp of [false, true]) {
      expect(stageFits(0, 2 * regular, captionUp)).toBe(false);
      expect(stageFits(180, 0, captionUp)).toBe(false);
      expect(stageFits(300, 0, captionUp)).toBe(false);
    }
  });

  it('checked 4 geometries × 6 labels × both caption states, with both answers present (anti-vacuity)', () => {
    expect(LABELS).toHaveLength(6);
    expect(ANSWERS).toHaveLength(GEOMETRIES.length);
    const all = ANSWERS.flatMap(([noCaption, caption]) => [...noCaption, ...caption]);
    expect(all).toHaveLength(GEOMETRIES.length * LABELS.length * 2);
    expect(all.filter(Boolean).length).toBeGreaterThan(0);
    expect(all.filter((answer) => !answer).length).toBeGreaterThan(0);
    expect(checked).toBe(GEOMETRIES.length * LABELS.length * 2);
  });
});
