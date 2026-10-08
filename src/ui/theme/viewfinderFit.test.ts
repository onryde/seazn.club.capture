import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { cameraBoxSize, STRIP_RESERVE, stripReserve } from '@/ui/theme/cameraBox';
import { font, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

// Spec §1: "Must fit a landscape phone from 640 × 360 dp up". This proves the RESERVATIONS fit, on
// the screens real phones have; whether real text stays inside them is Task 9's, on the phone.
//
// Owner, 2026-10-08: the controls half is `layout.controlsHalf` wide (310: its widest row, controlsFit.test.ts) and
// the camera half is the window less that, so the camera half is 330 at 640 wide and 605 at 915. The strip under the
// picture is the padding, the label and ONE message line ("one single line all the time"), and the controls half's
// column has its own vertical padding and gap (8 and 8) so every control is on screen at 804 × 332, the owner's phone
// with the Android status bar showing.
//
// "From 640 × 360 up" is not monotone: a wider screen at the same height has a taller box, and so
// less room for the strip (strip room = height - half width x 9/16). So the strip is proved at each
// of these shapes, not at the smallest alone. W, H in dp.
const GEOMETRIES = [
  [640, 360], // spec §1's smallest
  [804, 332], // the owner's phone as it really is: 360 less the Android status bar
  [800, 360], // 20:9
  [844, 390], // the canvas boards
  [915, 412], // a large phone
] as const;

const stack = (items: readonly number[], gap: number, pad: number) =>
  2 * pad + items.reduce((sum, item) => sum + item, 0) + gap * (items.length - 1);

// The strip's worst content, whatever the width (D17, F9, F20, Q4 option A; one message line, owner 2026-10-08). From
// the token and type declarations, written out here: it is not read from the module under test.
// Regular: 2 lines at 22 (a side of 26 or fewer does not wrap). Long: 4 lines at 19 (a doubles label).
const LABEL = Math.max(
  layout.labelLinesRegular * typeScale.label.lineHeight,
  layout.labelLinesMax * typeScale.labelLong.lineHeight,
);
const MESSAGE = layout.messageLines * typeScale.body.lineHeight; // F20: the strip's line is `body`; ONE line
const STRIP_ITEMS = [LABEL, MESSAGE] as const;
const STRIP_WORST = stack(STRIP_ITEMS, layout.stripGap, layout.stripPadV);

/** On air the strip is no taller: it is the same one message line, a caption or the status line, before air and on. */
const STRIPS = [
  ['before air', STRIP_ITEMS],
  ['on air', STRIP_ITEMS],
] as const;

/** The controls half's column: its own vertical padding and gap, the board's horizontal padding (the half's width). */
const COLUMN = [layout.controlsColumnGap, layout.controlsPadV] as const;

const CONTROLS = [
  [
    'before air: plate, chips and the start line, the flexible gap, icons, hold and its reason',
    [
      layout.plateHeight,
      layout.chip + space.xs + typeScale.metricUnit.lineHeight, // D14 (F18): the AUTO start line under the chips
      typeScale.metricUnit.lineHeight, // R3 (PR B): the photo line's place in the gap.
      layout.iconButton,
      layout.holdHeight + space.xs + typeScale.metricUnit.lineHeight,
    ],
  ],
  [
    'on air: plate with timer, meter, the flexible gap, icons with the peek’s reason line, hold',
    [
      layout.plateHeight,
      layout.meterHeight,
      typeScale.metricUnit.lineHeight, // R3 (PR B): the photo line's place in the gap.
      // m-3: What viewers see, with its "No viewer picture" line under it while there is no picture (ViewerPeek).
      // the peek cell is 110 dp at every width now the controls half is fixed (310 - 32 - 3 × 48 - 3 × 8): es and nl wrap the reason to two lines (scoringFit.test.ts measures it)
      layout.iconButton + space.xs + layout.peekReasonLines * typeScale.metricUnit.lineHeight,
      layout.holdHeight,
    ],
  ],
] as const;

let geometriesChecked = 0;

describe('the strip and the controls fit, at their worst', () => {
  it('the strip is 120 at its worst: 2 × 8 + 76 + 22 + 6, one message line (Q4 option A, one line 2026-10-08)', () => {
    expect(STRIP_ITEMS).toHaveLength(2);
    expect([LABEL, MESSAGE]).toEqual([76, 22]);
    expect(STRIP_WORST).toBe(120);
  });

  it('the strip reserves what its worst content is, no less', () => {
    expect(STRIP_RESERVE).toBeGreaterThanOrEqual(STRIP_WORST);
  });

  // R-F5 (controller): the round line is NOT in the reserve. The strip is the reserve wherever the box is
  // height-limited, the worst case's 120 before the label has been measured and for a label of four long lines (owner,
  // 2026-10-08, option A: the reserve is 44 dp and the label as measured, stripReserve), so the round line plus a long
  // double does not fit, and the line yields (stageFit.ts). This states the over-run so nobody "fixes" it by deleting
  // the yield or by adding a reserve the owner did not choose.
  it('the round line plus the worst-case strip is 142 dp, 22 over the 120 the strip has, which is why it yields (R-F5)', () => {
    const worst = layout.labelLinesMax * typeScale.labelLong.lineHeight;
    const message = layout.messageLines * typeScale.body.lineHeight;
    const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
    const items = [stage, worst, message];
    expect(items).toHaveLength(3);
    expect(stack(items, layout.stripGap, layout.stripPadV)).toBe(142);
    expect(stack(items, layout.stripGap, layout.stripPadV) - STRIP_WORST).toBe(22);
    // No reserve was added: the strip's reserve is still the worst case WITHOUT the round line.
    expect(STRIP_RESERVE).toBe(STRIP_WORST);
  });
});

describe.each(GEOMETRIES)('the viewfinder fits %i × %i (spec §1)', (width, height) => {
  // Owner, 2026-10-08: the controls half has the width its widest row needs, the camera half the rest.
  const halfWidth = width - layout.controlsHalf;
  // Spec §1: a 16:9 box across the half.
  const fullBox = halfWidth / layout.previewAspect;
  const box = cameraBoxSize({
    halfWidth,
    height,
    stripContent: STRIP_RESERVE,
    aspect: layout.previewAspect,
  });

  it('the camera box is 16:9, inside its half, and no taller than the screen leaves the strip', () => {
    // The ruling: height = min(half width × 9/16, screen height - the strip's content).
    expect(box.height).toBeCloseTo(Math.min(fullBox, height - STRIP_WORST), 9);
    expect(box.width).toBeLessThanOrEqual(halfWidth + 1e-9);
    expect(box.height).toBeLessThanOrEqual(fullBox + 1e-9);
    expect(box.width / box.height).toBeCloseTo(16 / 9, 9);
    expect(box.height).toBeGreaterThan(0);
  });

  it.each(STRIPS)('the status strip, %s, keeps its content under the box', (_when, items) => {
    expect(items).toHaveLength(2);
    expect(box.height + stack(items, layout.stripGap, layout.stripPadV)).toBeLessThanOrEqual(
      height + 1e-9,
    );
  });

  it.each(CONTROLS)('the controls half %s', (_when, items) => {
    expect(items).toHaveLength(5);
    expect(stack(items, ...COLUMN)).toBeLessThanOrEqual(height);
  });

  it('counts itself', () => {
    geometriesChecked += 1;
  });
});

describe('the on-air controls half with Remote scoring in the icon row (spec §10, RP7)', () => {
  // 56 + 12 + 16 + 84 + 72 = 240 for the five items, 4 × 8 = 32 of gaps, 2 × 8 = 16 of padding (the column's own,
  // owner 2026-10-08; it was 4 × 12 and 2 × 16 = 320). The icon item is 48 + 4 + 2 × 16 = 84, not 68: the peek's reason
  // takes two lines in es and nl. Pinned as a literal on purpose: it fails if the photo-line item is dropped, which is
  // how 304 was once written (scoringFit.test.ts pins the same 288).
  it('is 288 of 360 at 640 × 360, with 72 dp to spare, and 288 of 332 at 804 × 332', () => {
    const onAir = CONTROLS[1][1];
    // The literal first, so a dropped item fails here by its number (272), not only by the item count below.
    expect(stack(onAir, ...COLUMN)).toBe(288);
    expect(360 - stack(onAir, ...COLUMN)).toBe(72);
    expect(332 - stack(onAir, ...COLUMN)).toBe(44);
    expect(onAir).toHaveLength(5);
    expect(onAir[3]).toBe(84);
  });
});

// Owner, 2026-10-08 (a pre-existing defect found by the camera-wide gate): before air at 804 × 332 the controls half
// overflowed by 24 dp in the worst state. The state is the AUTO start line under the chips AND a hold reason under the
// button: plate 56, chips 44 + 4 + 16 = 64, the photo line's place 16, the icons 48, the hold 72 + 4 + 16 = 92 = 276 of
// content. The board's 16 padding and 12 gaps (32 + 4 × 12 = 80) made 356 of 332; the column's own 8 and 8 (16 + 32 =
// 48) make 324, with 8 dp to spare. Every control keeps its size (a touch target of 48 or more, the hold 72).
describe('the controls half fits 332 dp in its worst before-air state (owner, 2026-10-08)', () => {
  const WORST = CONTROLS[0][1];

  it('the items are the ones the Chromium gate measured: 56, 64, 16, 48, 92', () => {
    expect(WORST).toEqual([56, 64, 16, 48, 92]);
  });

  it('stacks to 324 of 332 with the column’s own padding and gap, 8 dp to spare, and 356 with the board’s (24 over)', () => {
    expect(stack(WORST, ...COLUMN)).toBe(324);
    expect(332 - stack(WORST, ...COLUMN)).toBe(8);
    // The defect, written out: the board's gap and padding on the same five items.
    expect(stack(WORST, 12, 16)).toBe(356);
    expect(stack(WORST, 12, 16) - 332).toBe(24);
  });

  it('keeps every control its size: the icon buttons 48, the hold button 72, the plate 56', () => {
    expect([layout.iconButton, layout.holdHeight, layout.plateHeight]).toEqual([48, 72, 56]);
    expect(layout.iconButton).toBeGreaterThanOrEqual(layout.touch);
    expect(layout.holdHeight).toBeGreaterThanOrEqual(layout.touch);
  });

  it('leaves the half’s WIDTH alone: the horizontal padding is the board’s 16, and the half is still 310', () => {
    expect(layout.controlsPad).toBe(16);
    expect(layout.controlsHalf).toBe(310);
    expect(layout.controlsColumnGap).toBe(layout.controlsPadV);
  });
});

describe('the camera box at the smallest screen (spec §1)', () => {
  // Spec §1's 640 × 360 before the label has been measured: the camera half is 330 (640 - 310), which holds a box 185.6
  // tall; the worst-case strip is 120, so the window leaves a box 240 tall, more than the half holds: the box is the
  // WHOLE half, 330 × 185.625. Full width (owner, 2026-10-08).
  it('is 330 × 185.625: the whole half, the strip’s 120 does not limit it', () => {
    expect(640 - layout.controlsHalf).toBe(330);
    const box = cameraBoxSize({
      halfWidth: 640 - layout.controlsHalf,
      height: 360,
      stripContent: STRIP_RESERVE,
      aspect: layout.previewAspect,
    });
    expect(box.width).toBeCloseTo(330, 9);
    expect(box.height).toBeCloseTo(185.625, 9);
    expect(360 - STRIP_RESERVE).toBeGreaterThan(box.height);
  });

  it('checked every geometry, and there were five (anti-vacuity)', () => {
    expect(GEOMETRIES).toHaveLength(5);
    expect(geometriesChecked).toBe(GEOMETRIES.length);
  });
});

// Owner, 2026-10-08: the phone the ruling was made on is 804 dp wide, 360 tall by the board and 332 as it really is (the
// Android status bar stays). Written out from the declarations.
describe('the owner’s phone, 804 × 332 and 804 × 360 (the ruling of 2026-10-08)', () => {
  const half = 804 - layout.controlsHalf;
  const at = (height: number, stripContent: number) =>
    cameraBoxSize({ halfWidth: half, height, stripContent, aspect: layout.previewAspect });

  it('gives the camera half 494 of the 804 dp, 92 more than half the screen (402), and the controls half 310', () => {
    expect(layout.controlsHalf).toBe(310);
    expect(half).toBe(494);
    expect(half - 804 / 2).toBe(92);
    expect(half).toBeGreaterThan(804 / 2);
  });

  // Before the label has been measured the box is 16:9 with the strip below it, limited by what the worst-case strip's
  // 120 leaves: 332 - 120 = 212 tall, 376.9 wide at the real app area; at the board's 360 the half limits it (277.9).
  it('holds a 376.9 × 212 box at 804 × 332 before the label is measured, limited by the strip’s 120 and not by the half', () => {
    const box = at(332, STRIP_RESERVE);
    expect(box.width).toBeCloseTo(376.888889, 5);
    expect(box.height).toBeCloseTo(212, 9);
    expect(box.width / box.height).toBeCloseTo(16 / 9, 9);
    expect(half / layout.previewAspect).toBeGreaterThan(box.height);
    expect(box.height + STRIP_WORST).toBe(332);
  });

  // Option A (owner, 2026-10-08): the strip is what this match's label needs. A two-line label (44) reserves 44 + 44 =
  // 88, so the 804 × 332 box is 244 tall and 433.8 wide, and the strip under it is the 88 its content needs: the 16 of
  // padding, the label, one gap and the one message line.
  it('holds a 433.8 × 244 box at 804 × 332 for a two-line label, and the strip under it holds that label’s content', () => {
    const label = 2 * typeScale.label.lineHeight;
    const measured = at(332, stripReserve(label));
    expect(label).toBe(44);
    expect(measured.height).toBeCloseTo(244, 9);
    expect(measured.width).toBeCloseTo(433.777778, 5);
    expect(measured.width).toBeGreaterThan(at(332, STRIP_RESERVE).width);
    expect(measured.width / measured.height).toBeCloseTo(16 / 9, 9);
    // The strip left under it is what its content needs: 16 + 44 + 22 + 6.
    expect(stack([label, MESSAGE], layout.stripGap, layout.stripPadV)).toBe(88);
    expect(measured.height + stack([label, MESSAGE], layout.stripGap, layout.stripPadV)).toBe(332);
  });

  // The picture is the whole half (full width) wherever the half's 9/16 leaves the strip its reserve: 804 × 360 with a
  // one-line label (360 - 66 = 294 against the half's 277.875).
  it('is the whole 494 dp half at 804 × 360 for a one-line label: 494 × 277.875, full width', () => {
    const full = at(360, stripReserve(22));
    expect(full.width).toBeCloseTo(494, 9);
    expect(full.height).toBeCloseTo(277.875, 9);
    // And a two-line label no longer fits it: 360 - 88 = 272 < 277.875.
    expect(at(360, stripReserve(44)).width).toBeLessThan(half);
  });
});

// R3 (PR B): the photo line is one line (`numberOfLines` 1), and a line that is too wide is cut with an
// ellipsis and no error. So its words are measured, in every language, in the controls half: since the owner's
// rule of 2026-10-08 it is `layout.controlsHalf` wide on every screen, not wider on a wider one. The widths come
// from the font file the app ships (test/fontMetrics.ts) at the size its type role declares, never from the strings
// being judged.
describe('the photo line fits one line in the controls half (spec §8)', () => {
  const CONTENT = layout.controlsHalf - 2 * layout.controlsPad;
  const LANGUAGES = [
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const;
  const KEYS = ['stream.photo.saved', 'stream.photo.failed'] as const;

  it('is set in Geist 500 at 12, the role’s own font, in a 278 dp content width', () => {
    expect(font.bodyMedium).toBe('Geist_500Medium');
    expect(typeScale.metricUnit.fontFamily).toBe(font.bodyMedium);
    expect(typeScale.metricUnit.fontSize).toBe(12);
    expect(CONTENT).toBe(278);
  });

  it('every photo line, in all four languages, is narrower than the content', () => {
    const geist = loadFont('geist-500');
    let checked = 0;
    for (const [lang, dictionary] of LANGUAGES) {
      for (const key of KEYS) {
        const width = geist.width(dictionary[key], typeScale.metricUnit.fontSize);
        expect({ lang, key, fits: width <= CONTENT }).toEqual({ lang, key, fits: true });
        checked += 1;
      }
    }
    expect(checked).toBe(8);
  });
});
