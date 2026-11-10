import { describe, expect, it } from 'vitest';
import {
  BOARD_RUNGS,
  boardNeeds,
  chipRows,
  chipsPerRow,
  fitBoard,
  stripHeight,
} from '@/ui/screens/cricketBoardFit';

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

// The rungs, with the numbers from the owner's NE2211 (uiautomator, build 979, 2026-11-10: "no ball by ball scoring?").
describe('the board gives way in the order of T19 fix 6', () => {
  it('the owner’s phone, 269 dp at 328 wide with two chips: the chase joins and the strip stays', () => {
    const fit = fitBoard(269, 2, 328);
    expect([fit.strip, fit.chaseJoined, fit.compact]).toEqual([true, true, false]);
  });

  it('285 dp is the board as designed', () => {
    expect(fitBoard(285, 2, 328)).toBe(BOARD_RUNGS[0]);
  });

  it('180 dp (320 wide, density 540) takes the compact rung, which asks no more than 180', () => {
    const fit = fitBoard(180, 2, 288);
    expect(fit).toBe(BOARD_RUNGS[4]);
    expect(boardNeeds(fit, 1)).toBeLessThanOrEqual(180);
  });

  it('with a free hit due the last rung still counts the caption, and is not given up for it', () => {
    const fit = fitBoard(180, 2, 288, false, true);
    expect(fit).toBe(BOARD_RUNGS[4]);
    expect(boardNeeds(fit, 1, undefined, true)).toBe(191);
  });
});
