import { describe, expect, it } from 'vitest';
import { chipRows, chipsPerRow, stripHeight } from '@/ui/screens/cricketBoardFit';

// The over strip's rows (T19 fix 5, Part 5), from the constants: a chip is 40 dp, `space.xs` (4) apart.
describe('the over strip’s rows', () => {
  it('a row holds as many 40 dp chips 4 dp apart as the width allows, and at least one', () => {
    expect([chipsPerRow(288), chipsPerRow(328), chipsPerRow(40), chipsPerRow(10)]).toEqual([
      6, 7, 1, 1,
    ]);
  });

  it('an over with no chips, or before the width is measured, is one row', () => {
    expect([chipRows(0, 288), chipRows(12, null)]).toEqual([1, 1]);
  });

  it('a seventh chip takes a second row at 288 dp, and the strip grows by a chip and a gap', () => {
    expect([chipRows(6, 288), chipRows(7, 288), chipRows(13, 288)]).toEqual([1, 2, 3]);
    expect([stripHeight(1), stripHeight(2)]).toEqual([60, 104]);
  });
});
