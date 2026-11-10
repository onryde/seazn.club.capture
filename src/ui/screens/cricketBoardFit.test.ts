import { describe, expect, it } from 'vitest';
import {
  BOARD_RUNGS,
  boardSpare,
  boardNeeds,
  chipsShown,
  spareBelow,
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

  it('the strip’s height is one row of chips, then a chip and a gap for each wrap', () => {
    expect([stripHeight(1), stripHeight(2)]).toEqual([60, 104]);
  });
});

// T19 fix 8 (owner, 2026-11-10, build 982: ten deliveries on a 360 dp phone; "if doesn't fit, show only last 6 balls?").
describe('the chips a strip shows', () => {
  it('an over that fits one row shows every chip: 6 at 288 dp, 7 at 328', () => {
    expect([chipsShown(6, 288, false), chipsShown(7, 328, false)]).toEqual([6, 7]);
  });

  it('an over that does not shows its last six: 7 at 288, 10 at 328 (7 a row)', () => {
    expect([chipsShown(7, 288, false), chipsShown(10, 328, false)]).toEqual([6, 6]);
  });

  it('nothing is cut before the width is measured, with no chips, or on a result board', () => {
    expect([
      chipsShown(10, null, false),
      chipsShown(0, 288, false),
      chipsShown(10, 328, true),
    ]).toEqual([10, 0, 10]);
  });
});

// The rungs, with the numbers from the owner's NE2211 (uiautomator, build 979, 2026-11-10: "no ball by ball scoring?").
describe('the board gives way in the order of T19 fix 6', () => {
  it('the owner’s phone, 269 dp at 328 wide with two chips: the chase joins and the strip stays', () => {
    const fit = fitBoard(269);
    expect([fit.strip, fit.chaseJoined, fit.compact]).toEqual([true, true, false]);
  });

  it('285 dp is the board as designed', () => {
    expect(fitBoard(285)).toBe(BOARD_RUNGS[0]);
  });

  it('180 dp (320 wide, density 540) takes the compact rung, which asks 171, no more than 180', () => {
    const fit = fitBoard(180);
    expect(fit).toBe(BOARD_RUNGS[4]);
    expect(boardNeeds(fit, 1)).toBeLessThanOrEqual(180);
  });

  it('with a free hit due the last rung still counts the caption (the board is then 11 dp short and clips at its bottom)', () => {
    const fit = fitBoard(180, false, true);
    expect(fit).toBe(BOARD_RUNGS[4]);
    expect(boardNeeds(fit, 1, undefined, true)).toBe(191);
  });
});

// The spare height (drawn under the strip): room less what the chosen rung needs (191 at the strip-less joined rung, 275 with a free
// hit at the joined rung with its strip), never negative.
describe('the spare height', () => {
  const spare = (room: number | null, result = false, freeHit = false) => {
    const rung = fitBoard(room, result, freeHit);
    return boardSpare(room, rung, result, freeHit);
  };

  it('200 dp at the strip-less rung has 9 spare, 191 none', () => {
    expect([spare(200), spare(191)]).toEqual([9, 0]);
  });

  it('269 dp has 14 spare over rung 2’s 255', () => {
    expect(spare(269)).toBe(14);
  });

  // The NE2211 at 360 x 804 measured 269.3 on build 981, plus the strip's 16 dp line and the pad's 8 dp gap (T20 fix 12)
  // = 293.3, which is rung 1 (285) with 8.3 over.
  it('the owner’s phone after fix 12, 293.3 dp (269.3 + 16 + 8), is rung 1 with 8.3 spare', () => {
    expect(fitBoard(293.3)).toBe(BOARD_RUNGS[0]);
    expect(spare(293.3)).toBeCloseTo(8.3, 9);
  });

  it('a free hit due takes 20 of it: 295 dp has 20 spare, 275 none', () => {
    expect([spare(295, false, true), spare(275, false, true)]).toEqual([20, 0]);
  });

  it('none when unmeasured, for a result, or when the board is too short', () => {
    expect([spare(null), spare(400, true), spare(100)]).toEqual([0, 0, 0]);
  });
});

// T20 fix 12: all the spare goes under the over strip, against the keys, and none above the score.
describe('where the spare goes', () => {
  it('78 dp spare is drawn below, and 4 dp (the gap itself) is too', () => {
    expect([spareBelow(78, 4), spareBelow(4, 4)]).toEqual([true, true]);
  });

  it('a spare under the board’s gap draws no spacer', () => {
    expect(spareBelow(3, 4)).toBe(false);
  });
});
