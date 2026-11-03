import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { isOneWord } from '@/ui/components/nameFit';

// Device finding, 2026-11-02: a long single-word name broke inside its word on the serving pick ("TEest002ashokash" over
// "ok"). A name with no space is shrunk to one line (NameText), down to `layout.nameFloor` where the phone keeps to it.
// The rooms are written out from the token and style declarations and the widths measured from the shipped fonts
// (test/fontMetrics.ts), as padFit.test.ts does: nothing is read from the components. Whether a phone then shrinks the
// name rather than breaking it is a device check; this pins that the shrink it asks of the phone is a small one.

const barlow600 = loadFont('barlow-condensed-600');
const labelWidth = (text: string) => barlow600.width(text, typeScale.label.fontSize);
const matchNameWidth = (text: string) => barlow600.width(text, typeScale.matchName.fontSize);

/** The pad's column at 320 dp: the screen less its padding (`space.md` a side). */
const COLUMN = 320 - 2 * space.md;
/** A Start-screen side button's text: half the row less its gap, the button's padding (`space.sm` a side) and border. */
const TOSS_ROOM = (COLUMN - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
/** A Match details side's text: the column less the versus block's padding (`space.md` a side), the bar and its gap. */
const SIDE_ROOM = COLUMN - 2 * space.md - layout.labelBar - layout.labelBarGap;

/** What a 24-character single word needs: the part of its size that fits the room, 1 when it already fits. */
const scaleFor = (room: number, width: number) => Math.min(1, room / width);

const DEVICE = 'TEest002ashokash';
const TWENTY_FOUR = 'TEest002ashokashTEest002';
const LOWERCASE = 'abcdefghijklmnopqrstuvwx';
const WIDEST = 'W'.repeat(24);

describe('a long single-word name at 320 dp', () => {
  it('is one word to the rule, each of them', () => {
    for (const name of [DEVICE, TWENTY_FOUR, LOWERCASE, WIDEST]) expect(isOneWord(name)).toBe(true);
  });

  it('is wider than a Start-screen button at full size: wrapping alone would break it inside its word', () => {
    expect(TOSS_ROOM).toBe(122);
    for (const name of [DEVICE, TWENTY_FOUR, LOWERCASE])
      expect(labelWidth(name)).toBeGreaterThan(TOSS_ROOM);
  });

  it('fits a Start-screen button at a size the floor allows, for the device’s name and for any 24 letters and digits', () => {
    for (const name of [DEVICE, TWENTY_FOUR, LOWERCASE])
      expect(scaleFor(TOSS_ROOM, labelWidth(name))).toBeGreaterThanOrEqual(layout.nameFloor);
    // The device's own name needs a small shrink: 122 of 134.5.
    expect(scaleFor(TOSS_ROOM, labelWidth(DEVICE))).toBeCloseTo(0.907, 3);
  });

  it('bites only for 24 of the widest letter, which ends in an ellipsis on iOS and shrinks on above 4 dp on Android', () => {
    // Anti-vacuity: the floor does bite, for a name no one has; Android shrinks it on to what fits, 8.6 dp here.
    expect(scaleFor(TOSS_ROOM, labelWidth(WIDEST))).toBeLessThan(layout.nameFloor);
    expect(typeScale.label.fontSize * scaleFor(TOSS_ROOM, labelWidth(WIDEST))).toBeGreaterThan(4);
  });

  it('fits a Match details side at full size or within a hair of it, at the larger matchName size', () => {
    expect(SIDE_ROOM).toBe(248);
    for (const name of [DEVICE, TWENTY_FOUR, LOWERCASE])
      expect(scaleFor(SIDE_ROOM, matchNameWidth(name))).toBeGreaterThanOrEqual(layout.nameFloor);
  });

  it('keeps the floor above a size that reads on a tripod: 12 dp of the label’s 20', () => {
    expect(layout.nameFloor * typeScale.label.fontSize).toBe(12);
  });
});
