import { describe, expect, it } from 'vitest';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { CASES } from '../../../test/fixtures/matchLabelCases';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

/**
 * C2 (D2 §4.4), measured: a side's row is the camera half less the strip's padding, the v's margin, the bar and its
 * gap. The owner's phone as laid out (728 × 328, N35) has a 418 half (728 less the 310 controls half); 804 × 332's is
 * 494 and 640 × 360's is 330. Widths are the shipped
 * font's advances, which over-state a phone's slightly (no kerning). Real names on staging are D3's to read (PD5).
 */
const barlow600 = loadFont('barlow-condensed-600');
const width = (text: string) => barlow600.width(text, typeScale.label.fontSize);
const rowWidth = (half: number) =>
  half - 2 * layout.stripPadH - layout.labelMargin - layout.labelBar - layout.labelBarGap;
const fits = (char: string, row: number) => {
  let count = 0;
  while (width(char.repeat(count + 1)) <= row) count += 1;
  return count;
};
const lines = (side: string, half: number) => linesOf(side, rowWidth(half), width);

/** The sides measured below, each a side of one of the shared label cases (PD5: the fixtures, not staging's names). */
const SIDES = [
  ['Ana Ruiz', 1, 1, 1],
  ['Alexandra Konstantinopoulou', 1, 1, 1],
  ['Ana Ruiz / Bea Lima', 1, 1, 1],
  ['Alexandra Konstantinopoulou / Bea Lima', 1, 1, 2],
  ['Cai Wen / Maria Fernanda Albuquerque Santos', 1, 1, 2],
] as const;

describe('a C2 side’s row, measured (D2 §4.4)', () => {
  it('is 440 dp at 804 × 332 (a 494 half), 364 on the owner’s phone as laid out (a 418 half) and 276 at 640 × 360 (a 330 half): about 22 dp under the old line', () => {
    expect(rowWidth(494)).toBe(440);
    expect(rowWidth(418)).toBe(364);
    expect(rowWidth(330)).toBe(276);
    expect(layout.labelMargin + layout.labelBar + layout.labelBarGap).toBe(22);
  });

  it('holds 50 n, 40 M or 33 W on one line at 494, and 31, 25 or 20 at 640 × 360', () => {
    expect(['n', 'M', 'W'].map((char) => fits(char, rowWidth(494)))).toEqual([50, 40, 33]);
    expect(['n', 'M', 'W'].map((char) => fits(char, rowWidth(330)))).toEqual([31, 25, 20]);
  });

  it.each(SIDES)(
    '“%s” is %i line(s) at 494, %i at 418 (the owner’s phone) and %i at 640 × 360',
    (side, at494, at418, at640) => {
      expect([lines(side, 494), lines(side, 418), lines(side, 330)]).toEqual([at494, at418, at640]);
    },
  );

  it('measures sides of the shared label cases, five of them (anti-vacuity)', () => {
    const shared = CASES.flatMap(([, , shape]) =>
      shape.kind === 'sides' ? [shape.a, shape.b] : [],
    );
    expect(SIDES).toHaveLength(5);
    for (const [side] of SIDES) expect(shared, side).toContain(side);
  });

  it('so the long doubles label is 2 × 22 = 44 at 804 × 332 (394.7 × 222) and on the owner’s phone as laid out (387.6 × 218, N35), and 4 × 22 = 88 at 640', () => {
    const both = (half: number) =>
      lines('Alexandra Konstantinopoulou / Bea Lima', half) +
      lines('Cai Wen / Maria Fernanda Albuquerque Santos', half);
    expect(both(494) * typeScale.label.lineHeight).toBe(44);
    expect(both(418) * typeScale.label.lineHeight).toBe(44);
    expect(both(330) * typeScale.label.lineHeight).toBe(88);
  });
});
