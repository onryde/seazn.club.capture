import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { cameraBoxSize, STRIP_RESERVE } from '@/ui/theme/cameraBox';
import { font, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

// Spec §1: "Must fit a landscape phone from 640 × 360 dp up". This proves the RESERVATIONS fit, on
// the screens real phones have; whether real text stays inside them is Task 9's, on the phone.
//
// Owner, 2026-10-08: the controls half is `layout.controlsHalf` wide (310: its widest row, controlsFit.test.ts) and
// the camera half is the window less that, so the camera half is 330 at 640 wide and 605 at 915.
//
// "From 640 × 360 up" is not monotone: a wider screen at the same height has a taller box, and so
// less room for the strip (strip room = height - half width x 9/16). So the strip is proved at each
// of these shapes, not at the smallest alone. W, H in dp.
const GEOMETRIES = [
  [640, 360], // spec §1's smallest
  [800, 360], // 20:9, the least strip room of the four
  [844, 390], // the canvas boards
  [915, 412], // a large phone
] as const;

const stack = (items: readonly number[], gap: number, pad: number) =>
  2 * pad + items.reduce((sum, item) => sum + item, 0) + gap * (items.length - 1);

// The strip's worst content, whatever the width (D17, F9, F20, Q4 option A). From the token and type
// declarations, written out here: it is not read from the module under test.
// Regular: 2 lines at 22 (a side of 26 or fewer does not wrap). Long: 4 lines at 19 (a doubles label).
const LABEL = Math.max(
  layout.labelLinesRegular * typeScale.label.lineHeight,
  layout.labelLinesMax * typeScale.labelLong.lineHeight,
);
const STATUS = layout.statusLinesMax * typeScale.body.lineHeight; // F20: the strip's line is `body`
const CAPTION = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
const STRIP_ITEMS = [LABEL, STATUS, CAPTION] as const;
const STRIP_WORST = stack(STRIP_ITEMS, layout.stripGap, layout.stripPadV);

/** On air the strip is no lighter: a shed, a failed preview, not charging and keep-the-app-open all show on air. */
const STRIPS = [
  ['before air', STRIP_ITEMS],
  ['on air', STRIP_ITEMS],
] as const;

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
  it('the strip is 180 at its worst: 2 × 8 + 76 + 44 + 32 + 2 × 6 (Q4 option A)', () => {
    expect(STRIP_ITEMS).toHaveLength(3);
    expect([LABEL, STATUS, CAPTION]).toEqual([76, 44, 32]);
    expect(STRIP_WORST).toBe(180);
  });

  it('the strip reserves what its worst content is, no less', () => {
    expect(STRIP_RESERVE).toBeGreaterThanOrEqual(STRIP_WORST);
  });

  // R-F5 (controller): the round line is NOT in the reserve. The strip is 180 wherever the box yields to it, which
  // is from 630 wide up on a 360 dp screen (the owner's rule, 2026-10-08, leaves the camera half 330 at 640, so
  // 640 × 360 is one of them), so a long double plus the round line does not fit, and the line yields (stageFit.ts).
  // This states the over-run so nobody "fixes" it by deleting the yield or by adding a reserve the owner did not choose.
  it('the round line plus PR A’s worst-case strip is 202 dp, 22 over the 180 the strip has, which is why it yields (R-F5)', () => {
    const worst = layout.labelLinesMax * typeScale.labelLong.lineHeight;
    const status = layout.statusLinesMax * typeScale.body.lineHeight;
    const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
    const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
    const items = [stage, worst, status, caption];
    expect(items).toHaveLength(4);
    expect(stack(items, layout.stripGap, layout.stripPadV)).toBe(202);
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
    expect(items).toHaveLength(3);
    expect(box.height + stack(items, layout.stripGap, layout.stripPadV)).toBeLessThanOrEqual(
      height + 1e-9,
    );
  });

  it.each(CONTROLS)('the controls half %s', (_when, items) => {
    expect(items).toHaveLength(5);
    expect(stack(items, layout.controlsGap, layout.controlsPad)).toBeLessThanOrEqual(height);
  });

  it('counts itself', () => {
    geometriesChecked += 1;
  });
});

describe('the on-air controls half with Remote scoring in the icon row (spec §10, RP7)', () => {
  // 56 + 12 + 16 + 84 + 72 = 240 for the five items, 4 × 12 = 48 of gaps, 2 × 16 = 32 of padding. The icon item is
  // 48 + 4 + 2 × 16 = 84, not 68: the peek's reason takes two lines in es and nl. Pinned as a literal on purpose: it
  // fails if the photo-line item is dropped, which is how 304 was once written (scoringFit.test.ts pins the same 320).
  it('is 320 of 360 at 640 × 360, with 40 dp to spare', () => {
    const onAir = CONTROLS[1][1];
    // The literal first, so a dropped item fails here by its number (304), not only by the item count below.
    expect(stack(onAir, layout.controlsGap, layout.controlsPad)).toBe(320);
    expect(360 - stack(onAir, layout.controlsGap, layout.controlsPad)).toBe(40);
    expect(onAir).toHaveLength(5);
    expect(onAir[3]).toBe(84);
  });
});

describe('the camera box at the smallest screen (spec §1)', () => {
  // Spec §1's 640 × 360: the camera half is 330 (640 - 310), which would hold a box 186 tall, but the strip leaves
  // 180, so the box is 320 × 180 and the strip gets the 180 that is left. (Before the owner's rule of 2026-10-08 the
  // half was 304 and the box 304 × 171, the strip 189.) This is the arithmetic that made Q4 an owner question: a
  // padding of 10 would make the strip 184 and take 4 dp off the box.
  it('is 320 × 180: the strip’s 180 limits it, not the half', () => {
    expect(640 - layout.controlsHalf).toBe(330);
    const box = cameraBoxSize({
      halfWidth: 640 - layout.controlsHalf,
      height: 360,
      stripContent: STRIP_RESERVE,
      aspect: layout.previewAspect,
    });
    expect(box.width).toBeCloseTo(320, 9);
    expect(box.height).toBeCloseTo(180, 9);
    expect(336 / layout.previewAspect).toBeGreaterThan(box.height);
  });

  it('checked every geometry, and there were four (anti-vacuity)', () => {
    expect(GEOMETRIES).toHaveLength(4);
    expect(geometriesChecked).toBe(GEOMETRIES.length);
  });
});

// Owner, 2026-10-08: the phone the ruling was made on is 804 × 360 dp. Written out from the declarations.
describe('the owner’s phone, 804 × 360 (the ruling of 2026-10-08)', () => {
  const half = 804 - layout.controlsHalf;
  const box = cameraBoxSize({
    halfWidth: half,
    height: 360,
    stripContent: STRIP_RESERVE,
    aspect: layout.previewAspect,
  });

  it('gives the camera half 494 of the 804 dp, 92 more than half the screen (402), and the controls half 310', () => {
    expect(layout.controlsHalf).toBe(310);
    expect(half).toBe(494);
    expect(half - 804 / 2).toBe(92);
    expect(half).toBeGreaterThan(804 / 2);
  });

  // The box is 16:9 and the strip is below it, so it is limited by what the strip's 180 leaves: 360 - 180 = 180 tall,
  // 320 wide. A box of 480 × 270 would leave the strip 90 dp, half what it reserves at its worst case (Q4 option A).
  it('holds a 320 × 180 box, limited by the strip’s 180 and not by the half: 494 would hold 277', () => {
    expect(box.width).toBeCloseTo(320, 9);
    expect(box.height).toBeCloseTo(180, 9);
    expect(box.width / box.height).toBeCloseTo(16 / 9, 9);
    expect(half / layout.previewAspect).toBeGreaterThan(box.height);
    expect(box.height + STRIP_WORST).toBe(360);
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
