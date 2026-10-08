import { describe, expect, it } from 'vitest';
import { createFakeCaptureEngine, type FakeScene } from '@/engine/FakeCaptureEngine';
import { diagnosticsSections } from '@/hooks/diagnostics';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import type { Lang } from '@/i18n/language';
import nl from '@/i18n/nl.json';
import { createTranslator } from '@/i18n/translate';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

// Spec §6: "Both fit without the Diagnostics card scrolling at 640 × 360" (spec §1's smallest landscape
// phone). This proves the RESERVATIONS fit, on the shapes real phones have, the way viewfinderFit does;
// whether real text stays inside them on a phone is Task 9's, on the device.
//
// The expected numbers are written out from the spec, the canvas ("Settings, landscape") and the token
// declarations. None is read from SettingsScreen or DiagnosticsCard.

/** Landscape heights from viewfinderFit's geometries: 640 × 360 (the smallest), 844 × 390 (the canvas), 915 × 412. */
const HEIGHTS = [360, 390, 412] as const;

/** Q1 (owner, 2026-10-07): nine rows. A literal, so a card that grows or loses a row is noticed. */
const ROWS = 9;
/** Back is a GhostButton, and Share record is one: `minHeight: 48`. SettingsScreen.test.tsx pins the rendered 48. */
const BACK = 48;
const SHARE = 48;

let fitsChecked = 0;

/** The halves under the way back: window - 2 × the screen's vertical padding - Back - the gap under it (space.sm). */
const halvesBudget = (height: number) => height - 2 * layout.settingsPadV - BACK - space.sm;
/** The card: 2 × its vertical padding + the header row + the gap under it + the rows. */
const cardHeight = 2 * layout.diagPadV + SHARE + layout.diagGap + ROWS * layout.diagRow;

describe('the Diagnostics card fits its half in landscape (spec §6)', () => {
  it('the halves have 280 at 640 × 360: 360 - 2 × 12 - 48 - 8 (canvas padding 12, Back 48)', () => {
    expect(halvesBudget(360)).toBe(280);
  });

  it('the card is 272: 2 × 10 + 48 + 6 + 9 × 22 (canvas padding 10, gap 6)', () => {
    expect(cardHeight).toBe(272);
  });

  it.each(HEIGHTS)('the card fits the halves at a window %i dp tall', (height) => {
    expect(cardHeight).toBeLessThanOrEqual(halvesBudget(height));
    fitsChecked += 1;
  });

  // The rows hold a single line (the value is numberOfLines 1): a row is no shorter than its tallest line.
  it('a row is as tall as its tallest line: the value’s 20, then the section and the item at 16', () => {
    const lines = [
      typeScale.metricValue.lineHeight,
      typeScale.metricUnit.lineHeight,
      typeScale.diagSection.lineHeight,
    ];
    expect(lines).toEqual([20, 16, 16]);
    expect(layout.diagRow).toBeGreaterThanOrEqual(Math.max(...lines));
  });

  it('checked every height, and there were three (anti-vacuity)', () => {
    expect(HEIGHTS).toHaveLength(3);
    expect(fitsChecked).toBe(HEIGHTS.length);
  });
});

// I-2: the Transport value is the only row whose copy can be long ("RTMPS" beside why SRT is missing).
// Geist Mono is monospaced, so a value's width is its code points × the font's advance × the font size.
// The advance is read from the font file the app ships (test/fontMetrics.ts), and the item's label is
// measured in Geist Medium from the same place: neither comes from the strings being judged.
const DICTIONARIES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { en, es, fr, nl };
const LANGS = ['en', 'es', 'fr', 'nl'] as const;

/** 640 wide: two screen pads of 16, a 16 gap between the halves (canvas), the card's 12 pad each side. */
const HALF = (640 - 2 * space.md - space.md) / 2;
const ITEM_AND_VALUE = HALF - 2 * layout.diagPad - layout.diagSection;

const mono = loadFont('geist-mono-400');
const medium = loadFont('geist-500');
const ADVANCE = mono.advance('0'.codePointAt(0) ?? 0);

/** What is left for the value once the item has its label and its gutter. */
const valueTrack = (lang: Lang) =>
  ITEM_AND_VALUE -
  layout.diagPad -
  medium.width(DICTIONARIES[lang]['diag.transport'] ?? '', typeScale.metricUnit.fontSize);
const codePointBudget = (lang: Lang) =>
  Math.floor(valueTrack(lang) / (typeScale.metricValue.fontSize * ADVANCE));

/** The Transport value in each state it has: SRT, a fall-back to RTMPS, RTMPS-only (A18), and nothing yet. */
function transportValues(lang: Lang): readonly string[] {
  const translator = createTranslator(lang);
  const now = Date.parse('2026-10-03T13:00:00Z');
  const valueOf = (scene: FakeScene, srtOffered: boolean | null) => {
    const engine = createFakeCaptureEngine(() => now);
    engine.scene(scene);
    const snapshot = engine.getSnapshot();
    engine.dispose();
    if (srtOffered !== null && snapshot.broadcast === null)
      throw new Error(`${scene} holds no broadcast`);
    const shown =
      srtOffered === null || snapshot.broadcast === null
        ? snapshot
        : { ...snapshot, broadcast: { ...snapshot.broadcast, srtOffered } };
    const link = diagnosticsSections(shown, now, translator)[0];
    const row = link?.rows.find((candidate) => candidate.key === 'diag.transport');
    if (row === undefined) throw new Error('no Transport row');
    return row.value;
  };
  return [
    valueOf('live', null),
    valueOf('fell-back', true),
    valueOf('fell-back', false),
    valueOf('paired-ready', null),
  ];
}

let valuesChecked = 0;

describe('every Transport value fits the value track, in every language (I-2)', () => {
  it('reads the fonts: Geist Mono is monospaced at 0.6 em, Geist Medium is not', () => {
    expect(ADVANCE).toBeCloseTo(0.6, 9);
    for (const char of 'RTMPS (·)—SRTonly') {
      expect({ char, mapped: mono.has(char.codePointAt(0) ?? 0) }).toEqual({ char, mapped: true });
      expect(mono.advance(char.codePointAt(0) ?? 0)).toBeCloseTo(ADVANCE, 9);
    }
  });

  // The reader is checked against a second, independent one: Pillow's ImageFont.getlength at size 1000 on
  // Geist_500Medium.ttf, whose per-glyph advances in 1/1000 em are these (the reader's own output is not
  // the oracle for the reader).
  it.each([
    ['W', 0.968],
    ['i', 0.256],
    ['T', 0.568],
    ['r', 0.394],
    ['a', 0.565],
    ['n', 0.591],
    ['s', 0.537],
    ['p', 0.608],
    ['o', 0.588],
    ['t', 0.41],
  ] as const)('reads Geist Medium %s as %f em', (char, em) => {
    expect(medium.advance(char.codePointAt(0) ?? 0)).toBeCloseTo(em, 9);
  });

  it('the track is 188 dp at 640 × 360: (640 - 32 - 16) / 2 - 24 - 84', () => {
    expect(ITEM_AND_VALUE).toBe(188);
  });

  it.each(LANGS)('%s: the value track and its budget are what the fonts say', (lang) => {
    // 188 - 12 - the label at 12 dp: en/fr/nl "Transport" 55.9 dp -> 120.1 dp -> 12 characters of 9.6 dp;
    // es "Transporte" 62.8 dp -> 113.2 dp -> 11.
    expect(codePointBudget(lang)).toBe({ en: 12, es: 11, fr: 12, nl: 12 }[lang]);
  });

  it.each(LANGS)('%s: SRT, RTMPS, RTMPS-only and the dash each fit', (lang) => {
    const values = transportValues(lang);
    expect(values).toHaveLength(4);
    for (const value of values) {
      expect(Array.from(value).length, `${lang} "${value}"`).toBeLessThanOrEqual(
        codePointBudget(lang),
      );
      // The measure itself, not only the count: the glyphs are in the font and the width fits.
      for (const char of value) expect(mono.has(char.codePointAt(0) ?? 0)).toBe(true);
      expect(
        mono.width(value, typeScale.metricValue.fontSize),
        `${lang} "${value}"`,
      ).toBeLessThanOrEqual(valueTrack(lang));
      valuesChecked += 1;
    }
  });

  it('checked sixteen values, four in each of four languages (anti-vacuity)', () => {
    expect(LANGS).toHaveLength(4);
    expect(valuesChecked).toBe(16);
  });
});
