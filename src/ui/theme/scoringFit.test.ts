import { describe, expect, it } from 'vitest';
import { seaznQrPlan } from '@/domain/qr/seaznQr';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { ScoringWord } from '@/services/scoringLinkPort';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';
import { FAKE_SCORING_URL } from '../../../test/fakeScoringLinkPort';

// Spec §10, Q-C2 and the owner's board: Remote scoring adds a fourth cell to the on-air icon row and a panel over
// the camera half. Both are proved to fit here, on the screens real phones have, from the token and type
// declarations, the fonts the app ships (test/fontMetrics.ts) and the dictionaries: none of it is read from the
// components. Whether real text stays inside is the device checklist's (Task 11).
//
// W, H in dp: viewfinderFit's four shapes. Spec §1's smallest, the least strip room, the board's own, a large phone.
const GEOMETRIES = [
  [640, 360],
  [800, 360],
  [844, 390],
  [915, 412],
] as const;

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
type Dictionary = Readonly<Record<string, string>>;

const stack = (items: readonly number[], gap: number, pad: number) =>
  2 * pad + items.reduce((sum, item) => sum + item, 0) + gap * (items.length - 1);

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');

/** `actionSecondary`: Barlow Condensed 600, uppercase, letter-spaced. The peek button's label. */
const labelWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The peek's reason, the hint, the countdown. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `control`: Geist 500 at 14. The Hide button's word. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `panelTitle` (R8b): Barlow Condensed 700 at 22, uppercase, letter-spaced. The panel's title. */
const titleWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.panelTitle.fontSize) +
  typeScale.panelTitle.letterSpacing * [...text].length;
/** `body`: Geist 400 at 15. The asking and refusal sentences. */
const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);

// ---------------------------------------------------------------------------------------------------------------
// (A) The on-air icon row, measured (F6, RP7, RP10)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Four cells in the row (Settings, Take photo, Remote scoring, the peek: pinned on the rendered tree by
 * StreamScreen.layout.test.tsx's on-air test), three of them 48 dp icon buttons with three `space.sm` gaps between.
 *
 * Owner, 2026-10-08: the controls half is `layout.controlsHalf` (310) on every screen, so the peek cell is the same
 * at every width: 310 - 2 × the padding - 3 × 48 - 3 × 8 = 110. (It was W / 2 - 2 × pad - ... = 120 at 640 here, a
 * conservative reading of a half that was really 16 dp wider, and grew with the screen to 257.5 at 915.) The
 * `width` argument is kept so the rows below still read per geometry, and the answer is asserted not to depend on it.
 */
const peekCell = (_width: number) =>
  layout.controlsHalf - 2 * layout.controlsPad - 3 * layout.iconButton - 3 * space.sm;
/** The peek button has a `layout.iconBorder` border and `space.sm` of padding each side. */
const peekText = (width: number) => peekCell(width) - 2 * layout.iconBorder - 2 * space.sm;

/** On air: the plate, the meter, the photo line's place, the icon row, the hold. viewfinderFit.test.ts stacks the same. */
function onAirStack(labelLines: number, reasonLines: number): number {
  const rowHeight =
    Math.max(
      layout.iconButton,
      labelLines * typeScale.actionSecondary.lineHeight + 2 * layout.iconBorder,
    ) +
    space.xs +
    reasonLines * typeScale.metricUnit.lineHeight;
  return stack(
    [
      layout.plateHeight,
      layout.meterHeight,
      typeScale.metricUnit.lineHeight, // R3 (PR B): the photo line's place in the gap
      rowHeight,
      layout.holdHeight,
    ],
    layout.controlsColumnGap,
    layout.controlsPadV,
  );
}

let peekRows = 0;
let worstReasonLines = 0;
const MEASURED_AT_640 = new Map<string, { label: number; reason: number }>();

describe('the on-air icon row with four cells (F6, RP10)', () => {
  it('the peek cell is 110 dp at 640, 800, 844 and 915 alike: the controls half does not grow with the screen', () => {
    expect(GEOMETRIES.map(([width]) => peekCell(width))).toEqual([110, 110, 110, 110]);
    expect(peekText(640)).toBe(92);
    expect(layout.controlsHalf).toBe(310);
  });

  it('the token for the label’s lines is the lines the component’s own height holds (ViewerPeek’s minHeight is 48)', () => {
    expect(Math.floor((48 - 2 * layout.iconBorder) / typeScale.actionSecondary.lineHeight)).toBe(
      layout.peekLabelLines,
    );
    // The reason has no height of its own to derive from: the least that fits is pinned by the rows below.
    expect(layout.peekReasonLines).toBe(2);
  });

  describe.each(GEOMETRIES)('at %i × %i', (width, height) => {
    it.each(LANGUAGES)(
      '%s: every word fits, the label and the reason wrap within the tokens, and the half fits',
      (lang, dictionary: Dictionary) => {
        const label = dictionary['stream.peek.label'] ?? '';
        const reason = dictionary['stream.peek.unavailable'] ?? '';
        for (const piece of label.split(' ')) {
          expect({ lang, piece, fits: labelWidth(piece) <= peekText(width) }).toEqual({
            lang,
            piece,
            fits: true,
          });
        }
        const labelLines = linesOf(label, peekText(width), labelWidth);
        const reasonLines = linesOf(reason, peekCell(width), unitWidth);
        expect(labelLines).toBeLessThanOrEqual(layout.peekLabelLines);
        expect(reasonLines).toBeLessThanOrEqual(layout.peekReasonLines);
        expect(onAirStack(labelLines, reasonLines)).toBeLessThanOrEqual(height);
        if (width === 640) MEASURED_AT_640.set(lang, { label: labelLines, reason: reasonLines });
        worstReasonLines = Math.max(worstReasonLines, reasonLines);
        peekRows += 1;
      },
    );
  });

  it('counted 4 geometries × 4 languages = 16 rows (anti-vacuity)', () => {
    expect(GEOMETRIES).toHaveLength(4);
    expect(peekRows).toBe(16);
  });

  it('the heat reason (D2 §4.2) is one line in the 110 dp cell in every language: 58.0, 79.7, 97.3 and 78.9 dp', () => {
    const widths = LANGUAGES.map(([, dictionary]) =>
      unitWidth(dictionary['stream.peek.hot'] ?? ''),
    );
    expect(widths.map((each) => Math.round(each * 10) / 10)).toEqual([58.0, 79.7, 97.3, 78.9]);
    for (const [, dictionary] of LANGUAGES)
      expect(linesOf(dictionary['stream.peek.hot'] ?? '', peekCell(640), unitWidth)).toBe(1);
  });

  // At 640 the numbers are asserted as they were measured, not as hoped (RP10): the label is wider than the 92 dp of
  // text in every language, so it takes two lines; the reason takes two in es and nl and one in en and fr, as it did
  // in the 120 dp cell it had before the owner's rule of 2026-10-08 (fr's 107.0 is 3.0 under the 110 cell).
  it('at 640 the label takes 2 lines in all four languages, and the reason 1, 2, 1, 2 (en, es, fr, nl)', () => {
    const lines = LANGUAGES.map(([lang]) => MEASURED_AT_640.get(lang));
    expect(lines.map((each) => each?.label)).toEqual([2, 2, 2, 2]);
    expect(lines.map((each) => each?.reason)).toEqual([1, 2, 1, 2]);
    // If no language wrapped, the 2-line reserve in viewfinderFit.test.ts would be a number nothing needs.
    expect(worstReasonLines).toBe(2);
  });

  it('the widths behind that are the shipped fonts’: each label is wider than the 92 dp, the fr reason 3.0 dp under its cell and the es one 10.9 over', () => {
    const widths = LANGUAGES.map(([, dictionary]) =>
      labelWidth(dictionary['stream.peek.label'] ?? ''),
    );
    for (const each of widths) expect(each).toBeGreaterThan(peekText(640));
    expect(widths.map((each) => Math.round(each * 10) / 10)).toEqual([119.7, 136.3, 140.9, 113.5]);
    expect(peekCell(640) - unitWidth(fr['stream.peek.unavailable'])).toBeCloseTo(3.0, 1);
    expect(unitWidth(es['stream.peek.unavailable']) - peekCell(640)).toBeCloseTo(10.9, 1);
  });

  it('the on-air controls half at 640 × 360 is 288 dp of 360 with two label lines and two reason lines (RP7)', () => {
    // 56 + 12 + 16 + 84 + 72 = 240 for the five items, 4 × 8 = 32 of gaps, 2 × 8 = 16 of padding (the column's own
    // vertical rhythm, owner 2026-10-08; it was 320 with the board's 12 and 16). The same number viewfinderFit.test.ts
    // pins: the two fit files stack the same half, and must agree. (The height does not depend on the half's width
    // once the label lines are taken, which the rows above measure in the 104 dp cell.)
    expect(onAirStack(2, 2)).toBe(288);
    expect(onAirStack(2, 2)).toBeLessThanOrEqual(360);
    // The photo line is in it: with a 0 there instead (RP7's earlier draft) the stack would read 272.
    expect(onAirStack(2, 2) - typeScale.metricUnit.lineHeight).toBe(272);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (B) The code panel and the QR's size (F7, D13, B3, B4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The panel is `absoluteFill` of the camera half, padded `layout.controlsPad` with `layout.controlsGap` between its
 * children. The camera half is what the controls half leaves (owner, 2026-10-08): the window less
 * `layout.controlsHalf`, 330 at 640 (it was (W - 2 × the controls padding) / 2 = 304 before the ruling, which
 * Chromium measured). So the panel's content is that less its own padding: 298 at 640.
 */
const cameraHalf = (width: number) => width - layout.controlsHalf;
const panelWidth = (width: number) => cameraHalf(width) - 2 * layout.controlsPad;

/** Whole dp the QR is least allowed to leave over. */
const SLACK = 4;
/** The panel is the camera half's whole height, and the smallest screen is 360 tall. */
const SMALLEST = 360;

const URL_STG = FAKE_SCORING_URL;
const URL_PRD = FAKE_SCORING_URL.replace('stg.seazn.club', 'seazn.club');

let geometriesChecked = 0;

describe('the code panel (F7, D13)', () => {
  it('the panel is 298 dp wide at 640 (the half the layout gives the camera, less the padding)', () => {
    expect(cameraHalf(640)).toBe(330);
    expect(panelWidth(640)).toBe(298);
    expect(GEOMETRIES.map(([width]) => panelWidth(width))).toEqual([298, 458, 502, 573]);
  });

  it('the title is one line in all four languages, measured at `panelTitle` (Barlow Condensed 700, 22/24, caps)', () => {
    let checked = 0;
    for (const [lang, dictionary] of LANGUAGES) {
      const title = dictionary['stream.scoring.title'] ?? '';
      expect(linesOf(title, panelWidth(640), titleWidth), lang).toBe(1);
      expect(titleWidth(title), lang).toBeLessThanOrEqual(panelWidth(640));
      checked += 1;
    }
    expect(checked).toBe(4);
    // As measured with the shipped font: the widest is French at 227.8 of the 298 dp, so a larger title has room to grow.
    expect(
      LANGUAGES.map(
        ([, dictionary]) =>
          Math.round(titleWidth(dictionary['stream.scoring.title'] ?? '') * 10) / 10,
      ),
    ).toEqual([159.8, 181.4, 227.8, 203.9]);
    // The board's size and line height, written out beside the token they are read from.
    expect([typeScale.panelTitle.fontSize, typeScale.panelTitle.lineHeight]).toEqual([22, 24]);
  });

  const hintLines = () => {
    const lines = LANGUAGES.map(([, dictionary]) =>
      linesOf(dictionary['stream.scoring.hint'] ?? '', panelWidth(640), unitWidth),
    );
    return lines;
  };

  it('the hint is one line in all four languages at the narrowest panel, the widest being French at 242.2 (en 163.7, es 237.1, nl 218.6)', () => {
    const lines = hintLines();
    expect(lines).toHaveLength(4);
    expect(Math.max(...lines)).toBe(1);
    const widths = LANGUAGES.map(([, dictionary]) =>
      unitWidth(dictionary['stream.scoring.hint'] ?? ''),
    );
    expect(widths.map((each) => Math.round(each * 10) / 10)).toEqual([163.7, 237.1, 242.2, 218.6]);
    for (const each of widths) expect(each).toBeLessThanOrEqual(panelWidth(640));
  });

  it('the symbol is 57 units on both hosts: 49 modules and a quiet zone of 4 a side', () => {
    const units = [seaznQrPlan(URL_STG).total, seaznQrPlan(URL_PRD).total];
    expect(units).toEqual([57, 57]);
    expect(URL_PRD).not.toBe(URL_STG); // anti-vacuity: two different links
  });

  it('qrSize is the largest whole multiple of the symbol that fits, derived from the tokens and pinned', () => {
    const UNITS = seaznQrPlan(URL_STG).total;
    const lines = Math.max(...hintLines());
    const room =
      SMALLEST -
      2 * layout.controlsPad -
      3 * layout.controlsGap -
      typeScale.panelTitle.lineHeight -
      lines * typeScale.metricUnit.lineHeight -
      layout.iconButton -
      SLACK;
    const perModule = Math.floor(room / UNITS);
    expect(layout.qrSize).toBe(perModule * UNITS);
    // The literals, as measured: 200 dp of room, 3 dp a module, 171.
    expect(room).toBe(200);
    expect(perModule).toBe(3);
    expect(layout.qrSize).toBe(171);
  });

  it('is largest and fits: 327 of 360, and one more dp a module does not', () => {
    const UNITS = seaznQrPlan(URL_STG).total;
    const title = typeScale.panelTitle.lineHeight;
    const hint = typeScale.metricUnit.lineHeight;
    const shown = stack(
      [title, layout.qrSize, hint, layout.iconButton],
      layout.controlsGap,
      layout.controlsPad,
    );
    // 24 + 171 + 16 + 48 = 259 for the four items, 3 × 12 = 36 of gaps, 2 × 16 = 32 of padding.
    expect(shown).toBe(327);
    const tooBig = stack(
      [title, 4 * UNITS, hint, layout.iconButton],
      layout.controlsGap,
      layout.controlsPad,
    );
    expect(tooBig).toBe(384);
    expect(tooBig).toBeGreaterThan(SMALLEST);
    for (const [, height] of GEOMETRIES) {
      expect(shown + SLACK).toBeLessThanOrEqual(height);
      geometriesChecked += 1;
    }
  });

  it('the code fits the panel’s width at every geometry', () => {
    for (const [width] of GEOMETRIES) expect(layout.qrSize).toBeLessThanOrEqual(panelWidth(width));
    expect(layout.qrSize).toBeLessThanOrEqual(panelWidth(640));
  });

  it('counted four geometries (anti-vacuity)', () => {
    expect(geometriesChecked).toBe(GEOMETRIES.length);
    expect(GEOMETRIES).toHaveLength(4);
  });
});

describe('the panel without a code fits too', () => {
  // The asking sentence and the six refusals are `body` text, with {seconds} filled with 300 (the widest, as
  // budgets.test.ts does), measured in the narrowest panel.
  const SENTENCE_KEYS: Readonly<Record<ScoringWord, string>> = {
    code_ended: 'stream.scoring.refused.codeEnded',
    replaced: 'stream.scoring.refused.replaced',
    match_finished: 'stream.scoring.refused.matchFinished',
    not_entitled: 'stream.scoring.refused.notEntitled',
    rate_limited: 'stream.scoring.refused.rateLimited',
    unavailable: 'stream.scoring.refused.unavailable',
  };

  it('every sentence, in every language, leaves the title and Hide room in 360: (6 + 1) × 4 = 28 strings', () => {
    // Typed over every word, so a seventh word is a compile error here; a UI file may not import the port's value list.
    const keys = ['stream.scoring.asking', ...Object.values(SENTENCE_KEYS)];
    expect(keys).toHaveLength(7);
    let checked = 0;
    let worst = 0;
    for (const [lang, dictionary] of LANGUAGES) {
      for (const key of keys) {
        const text = ((dictionary as Dictionary)[key] ?? '').replace('{seconds}', '300');
        const lines = linesOf(text, panelWidth(640), bodyWidth);
        const total = stack(
          [typeScale.panelTitle.lineHeight, lines * typeScale.body.lineHeight, layout.iconButton],
          layout.controlsGap,
          layout.controlsPad,
        );
        expect({ lang, key, fits: total <= SMALLEST }).toEqual({ lang, key, fits: true });
        worst = Math.max(worst, lines);
        checked += 1;
      }
    }
    expect(checked).toBe(28);
    expect(worst).toBeGreaterThanOrEqual(1);
    expect(worst).toBeLessThanOrEqual(3);
  });
});

// B3: the bottom row is one row: the countdown bar, "Hides in {n} s" and Hide, in the panel's width. The bar takes
// what the other two leave and must still read as a bar.
describe('the bottom row’s countdown fits beside Hide (B3)', () => {
  /** The least the bar may be and still read as a bar. */
  const BAR_LEAST = 32;
  let rows = 0;

  it.each(GEOMETRIES)('at %i × %i every language leaves the bar at least 32 dp', (width) => {
    for (const [lang, dictionary] of LANGUAGES) {
      // The text at 10 s, its widest figure count: the hook never goes above 10 (SCORING_SHOW_SECONDS).
      const text = (dictionary['stream.scoring.hidesIn'] ?? '').replace('{seconds}', '10');
      expect(linesOf(text, panelWidth(width), unitWidth), lang).toBe(1);
      const hide = Math.max(
        layout.iconButton,
        controlWidth(dictionary['stream.scoring.hide'] ?? '') +
          2 * space.md +
          2 * layout.iconBorder,
      );
      const bar = panelWidth(width) - unitWidth(text) - hide - 2 * layout.controlsGap;
      expect({ lang, bar: bar >= BAR_LEAST }).toEqual({ lang, bar: true });
      rows += 1;
    }
  });

  it('counted 4 geometries × 4 languages = 16 rows (anti-vacuity)', () => {
    expect(rows).toBe(16);
  });
});
