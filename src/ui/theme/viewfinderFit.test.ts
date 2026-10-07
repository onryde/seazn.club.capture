import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

// Spec §1: "Must fit a landscape phone from 640 × 360 dp up". This proves the RESERVATIONS fit;
// whether real text stays inside them is Task 9's, on the phone.
const SMALLEST = { width: 640, height: 360 } as const;
const HALF = SMALLEST.width / 2; // spec §1: two equal halves
const BOX = HALF / layout.previewAspect; // spec §1: a 16:9 box across the half
const stack = (items: readonly number[], gap: number, pad: number) =>
  2 * pad + items.reduce((sum, item) => sum + item, 0) + gap * (items.length - 1);

describe('the viewfinder fits 640 × 360 (spec §1)', () => {
  it('the camera box is 16:9 across the half: 320 × 180', () => {
    expect(BOX).toBe(180);
  });

  it('the status strip, worst case before air', () => {
    // D17 (F9): the larger of the two size rules. Regular: 2 lines at 22 (a side of 26 or fewer does not wrap).
    // Long: 4 lines at 19 (a side over 26 wraps to 2, or doubles take one partner a line; Q4 A).
    const regular = layout.labelLinesRegular * typeScale.label.lineHeight;
    const long = layout.labelLinesMax * typeScale.labelLong.lineHeight;
    const label = Math.max(regular, long);
    const status = layout.statusLinesMax * typeScale.body.lineHeight; // F20: the strip's line is `body`
    const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
    const items = [label, status, caption];
    expect(items).toHaveLength(3);
    expect(stack(items, layout.stripGap, layout.stripPadV)).toBeLessThanOrEqual(
      SMALLEST.height - BOX,
    );
  });

  it('the controls half before air: plate, chips and the start line, the flexible gap, icons, hold and its reason', () => {
    const items = [
      layout.plateHeight,
      layout.chip + space.xs + typeScale.metricUnit.lineHeight, // D14 (F18): the AUTO start line under the chips
      0,
      layout.iconButton,
      layout.holdHeight + space.xs + typeScale.metricUnit.lineHeight,
    ];
    expect(items).toHaveLength(5);
    expect(stack(items, layout.controlsGap, layout.controlsPad)).toBeLessThanOrEqual(
      SMALLEST.height,
    );
  });

  it('the controls half on air: plate with timer, meter, the flexible gap, icons, hold', () => {
    const items = [layout.plateHeight, layout.meterHeight, 0, layout.iconButton, layout.holdHeight];
    expect(items).toHaveLength(5);
    expect(stack(items, layout.controlsGap, layout.controlsPad)).toBeLessThanOrEqual(
      SMALLEST.height,
    );
  });
});
