import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

/**
 * D2 §4.3: the cover's lines fit the camera box. The narrowest box any window gets is 309.3 dp wide: the owner's phone
 * as laid out, 728 × 328 (N35), before the label is measured, C2's worst case: 174 × 16/9. 804 × 332's is 316.4
 * (178 × 16/9, Task 10) and 640 × 360's is 330. The honest line and the countdown are one line of `metricUnit` each,
 * inside `space.sm` either side; the loading and not-ready lines are `body`, at most three lines, inside `space.md`
 * either side. Widths are the shipped fonts' (no kerning).
 */
const BOX = 309.3;
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
const unit = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
const body = (text: string) => geist400.width(text, typeScale.body.fontSize);
const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
const fill = (text: string) => text.replace('{seconds}', '20');
const control = (text: string) => geist500.width(text, typeScale.control.fontSize);

describe('the viewer cover’s lines fit the narrowest camera box (D2 §4.3)', () => {
  it.each(LANGUAGES)('%s: the honest line and the countdown are one line each', (_lang, d) => {
    const room = BOX - 2 * space.sm;
    expect(unit(d['stream.peek.honest'])).toBeLessThanOrEqual(room);
    expect(unit(fill(d['stream.peek.closesIn']))).toBeLessThanOrEqual(room);
  });

  it.each(LANGUAGES)(
    '%s: the loading and not-ready lines are at most 3 lines of body',
    (_lang, d) => {
      const room = BOX - 2 * space.md;
      expect(linesOf(fill(d['stream.peek.loading']), room, body)).toBeLessThanOrEqual(3);
      expect(linesOf(d['stream.peek.notReady'], room, body)).toBeLessThanOrEqual(3);
    },
  );

  it('the widest honest line is the French, 238.5 dp, inside 293.3 (anti-vacuity)', () => {
    expect(BOX - 2 * space.sm).toBeCloseTo(293.3, 9);
    const widths = LANGUAGES.map(([, d]) => Math.round(unit(d['stream.peek.honest']) * 10) / 10);
    expect(widths).toEqual([213.1, 219.3, 238.5, 214.2]);
  });
});

/**
 * B3 review m4: Hide is drawn in the cover's bottom-right corner, after the closing countdown, `space.sm` in from the
 * box's edges and apart, as the Remote scoring panel ends its row with its own Hide. It is checked at three
 * geometries: 640 × 360 (a 330 dp box), the owner's phone as laid out, 728 × 328 (N35: before the label is measured, a
 * 174 dp high box), and 804 × 332 (a 178 dp high box). The loading and not-ready lines are centred in the box, so they
 * must clear that row and, as far above it, the honest plate: their height is at most the box's, less twice the row's
 * (Hide's 48 dp and its inset).
 */
const GEOMETRIES = [
  ['640 × 360', 330, (330 * 9) / 16],
  ['728 × 328', (174 * 16) / 9, 174],
  ['804 × 332', (178 * 16) / 9, 178],
] as const;
const ROWS = GEOMETRIES.flatMap(([geometry, width, height]) =>
  LANGUAGES.map(([lang, d]) => [geometry, lang, d, width, height] as const),
);
type Copy = (typeof LANGUAGES)[number][1];
const closesPlate = (d: Copy) => unit(fill(d['stream.peek.closesIn'])) + 2 * space.sm;
const hidePlate = (d: Copy) =>
  Math.max(
    layout.iconButton,
    control(d['stream.scoring.hide']) + 2 * space.md + 2 * layout.iconBorder,
  );
const bottomRow = (d: Copy) => closesPlate(d) + space.sm + hidePlate(d);

describe('the cover’s Hide and closing countdown fit its corner (D2 §4.3, B3 review m4)', () => {
  it.each(ROWS)('%s, %s: Hide and the countdown are one row inside the box', (_g, _l, d, width) => {
    expect(bottomRow(d)).toBeLessThanOrEqual(width - 2 * space.sm);
  });

  it.each(ROWS)(
    '%s, %s: the loading and not-ready lines clear the bottom row and the honest plate',
    (_g, _l, d, width, height) => {
      const room = width - 2 * space.md;
      const clear = height - 2 * (space.sm + layout.iconButton);
      const tall = (text: string) => linesOf(text, room, body) * typeScale.body.lineHeight;
      expect(tall(fill(d['stream.peek.loading']))).toBeLessThanOrEqual(clear);
      expect(tall(d['stream.peek.notReady'])).toBeLessThanOrEqual(clear);
    },
  );

  it('the widest row is the French, 226.4 dp, inside 293.3 at 728 × 328 and 300.4 at 804 × 332 (anti-vacuity)', () => {
    expect(ROWS).toHaveLength(3 * LANGUAGES.length);
    expect((174 * 16) / 9 - 2 * space.sm).toBeCloseTo(293.3, 1);
    const rows = LANGUAGES.map(([, d]) => Math.round(bottomRow(d) * 10) / 10);
    expect(rows).toEqual([168, 203.2, 226.4, 210.6]);
  });
});
