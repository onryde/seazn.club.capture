import { describe, expect, it } from 'vitest';
import type { EngineSnapshot, Telemetry, ThermalStatus } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine, type FakeScene } from '@/engine/FakeCaptureEngine';
import { diagnosticsSections } from '@/hooks/diagnostics';
import { settingsDiagRows } from '@/hooks/settingsDiagnostics';
import { LANGS, type Lang } from '@/i18n/language';
import type { MessageKey } from '@/i18n/messages';
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
  it('a row holds its tallest line: value, item and section are 16 dp lines in a 22 dp row', () => {
    const lines = [
      typeScale.diagValue.lineHeight,
      typeScale.diagLabel.lineHeight,
      typeScale.diagSection.lineHeight,
    ];
    expect(lines).toEqual([16, 16, 16]);
    expect(layout.diagRow).toBeGreaterThanOrEqual(Math.max(...lines));
  });

  it('checked every height, and there were three (anti-vacuity)', () => {
    expect(HEIGHTS).toHaveLength(3);
    expect(fitsChecked).toBe(HEIGHTS.length);
  });
});

// The text in the rows. The canvas ("Settings, landscape", the design of record) sets the values in Geist Mono
// 13 and the items in Geist 500 at 13; the section names are Barlow Condensed 600 at 14, caps, +0.6 spacing.
// Widths are measured per glyph from the font files the app ships (test/fontMetrics.ts; its reader is pinned
// to a second reader below), at the size the card's type roles declare, and those roles are pinned to the
// canvas's literals just below. No width is read from the strings being judged.
const CANVAS_VALUE_PX = 13;
const CANVAS_ITEM_PX = 13;
const CANVAS_SECTION_PX = 14;
const SECTION_SPACING = 0.6;

/** 640 wide: two screen pads of 16, a 16 gap between the halves (canvas), the card's 12 pad each side. */
const HALF = (640 - 2 * space.md - space.md) / 2;
/** What the item and the value share in a row: the half less the card's side padding and the section column. */
const ITEM_AND_VALUE = HALF - 2 * layout.diagPad - layout.diagSection;
/** The section name's text: its column less the 12 dp it keeps clear of the item. */
const SECTION_TEXT = layout.diagSection - layout.diagPad;

const mono = loadFont('geist-mono-400');
const medium = loadFont('geist-500');
const condensed = loadFont('barlow-condensed-600');
const ADVANCE = mono.advance('0'.codePointAt(0) ?? 0);

const NOW = Date.parse('2026-10-03T13:00:00Z');

/** The nine rows of the card, by key (Q1). Written out so a row that is renamed or dropped is noticed. */
const CARD_ROWS = [
  'diag.transport',
  'diag.bitrate',
  'diag.rtt',
  'diag.delivery',
  'diag.lag',
  'diag.checked',
  'diag.battery',
  'diag.thermal',
  'diag.hbSent',
] as const satisfies readonly MessageKey[];

/** The port's ThermalStatus, in full. `satisfies` makes the list complete or a type error. */
const THERMAL = {
  none: 0,
  light: 0,
  moderate: 0,
  severe: 0,
  critical: 0,
  emergency: 0,
  shutdown: 0,
} as const satisfies Record<ThermalStatus, 0>;
const THERMAL_STATUSES = Object.keys(THERMAL) as ThermalStatus[];

/**
 * One reading the card must hold: a row, the state that gives it that text, and the snapshot that shows it.
 * `static` texts are the dictionary's own; `worst` ones are numbers, taken at the widest the row can be
 * before an incident owns the screen (the reason is at each).
 */
type Probe = {
  readonly row: (typeof CARD_ROWS)[number];
  readonly state: string;
  readonly kind: 'static' | 'worst';
  /** A `worst` probe must really show its number (decimal point as dots), a `no reading` one the dash. */
  readonly contains?: string;
  readonly shown: (scene: (name: FakeScene) => EngineSnapshot) => EngineSnapshot;
};

const withTelemetry = (
  snapshot: EngineSnapshot,
  telemetry: Partial<Telemetry>,
): EngineSnapshot => ({
  ...snapshot,
  telemetry: { ...snapshot.telemetry, ...telemetry },
});

/** Nothing measured yet: the telemetry field behind each row is null, and the row shows its dash. */
const NO_READING: Readonly<Record<string, (snapshot: EngineSnapshot) => EngineSnapshot>> = {
  'diag.bitrate': (snapshot) => withTelemetry(snapshot, { bitrateKbps: null }),
  'diag.rtt': (snapshot) => withTelemetry(snapshot, { srt: null }),
  'diag.lag': (snapshot) => withTelemetry(snapshot, { deliveredLagMs: null }),
  'diag.checked': (snapshot) => withTelemetry(snapshot, { deliveryCheckedAtMs: null }),
  'diag.battery': (snapshot) => withTelemetry(snapshot, { batteryPercent: null }),
  'diag.thermal': (snapshot) => withTelemetry(snapshot, { thermalStatus: null }),
  'diag.hbSent': (snapshot) =>
    withTelemetry(snapshot, {
      heartbeat: { ...snapshot.telemetry.heartbeat, lastSentAtEpochMs: null },
    }),
};
const DASH_ROWS = Object.keys(NO_READING) as (keyof typeof NO_READING &
  (typeof CARD_ROWS)[number])[];

function probes(): readonly Probe[] {
  const live = (scene: (name: FakeScene) => EngineSnapshot) => scene('live');
  return [
    { row: 'diag.transport', state: 'SRT', kind: 'static', shown: live },
    {
      row: 'diag.transport',
      state: 'RTMPS (fell back)',
      kind: 'static',
      shown: (scene) => scene('fell-back'),
    },
    {
      row: 'diag.transport',
      state: 'RTMPS only (A18)',
      kind: 'static',
      shown: (scene) => {
        const snapshot = scene('fell-back');
        if (snapshot.broadcast === null) throw new Error('fell-back holds no broadcast');
        return { ...snapshot, broadcast: { ...snapshot.broadcast, srtOffered: false } };
      },
    },
    ...(['ok', 'stalled', 'unknown'] as const).map((delivery) => ({
      row: 'diag.delivery' as const,
      state: `delivery ${delivery}`,
      kind: 'static' as const,
      shown: (scene: (name: FakeScene) => EngineSnapshot) =>
        withTelemetry(live(scene), { delivery }),
    })),
    ...THERMAL_STATUSES.map((thermalStatus) => ({
      row: 'diag.thermal' as const,
      state: `thermal ${thermalStatus}`,
      kind: 'static' as const,
      shown: (scene: (name: FakeScene) => EngineSnapshot) =>
        withTelemetry(live(scene), { thermalStatus }),
    })),
    ...DASH_ROWS.map((row) => ({
      row,
      state: 'no reading',
      kind: 'static' as const,
      shown: (scene: (name: FakeScene) => EngineSnapshot) =>
        NO_READING[row]?.(live(scene)) ?? live(scene),
    })),
    // Transport has its dash too: before a session there is no transport to name.
    {
      row: 'diag.transport',
      state: 'no reading',
      kind: 'static',
      shown: (scene) => scene('paired-ready'),
    },
    {
      // 12000 kbps: five digits, above any single-stream 1080p60 the regulator would target.
      row: 'diag.bitrate',
      state: '12000 kbps',
      kind: 'worst',
      contains: '12000',
      shown: (scene) => withTelemetry(live(scene), { bitrateKbps: 12000 }),
    },
    {
      // 9999 ms: four digits, a link that has already stalled.
      row: 'diag.rtt',
      state: '9999 ms',
      kind: 'worst',
      contains: '9999',
      shown: (scene) => {
        const snapshot = live(scene);
        const srt = snapshot.telemetry.srt;
        if (srt === null) throw new Error('the live scene reports SRT stats');
        return withTelemetry(snapshot, { srt: { ...srt, rttMs: 9999 } });
      },
    },
    {
      // Just past the hold window the broadcast declares: three digits and the one decimal formatNumber allows.
      row: 'diag.lag',
      state: 'hold window + 0.9 s',
      kind: 'worst',
      contains: '183.9',
      shown: (scene) => {
        const snapshot = live(scene);
        const hold = snapshot.broadcast?.holdWindowSeconds.srt;
        if (hold === undefined) throw new Error('the live scene holds a broadcast');
        return withTelemetry(snapshot, { deliveredLagMs: hold * 1000 + 900 });
      },
    },
    {
      // 99.9 s ago: the widest age under 100 s. A check or a heartbeat older than that is an incident the
      // attention colour already owns, and the value is then cut at its tail by the backstop and not wrapped.
      row: 'diag.checked',
      state: '99.9 s ago',
      kind: 'worst',
      contains: '99.9',
      shown: (scene) => withTelemetry(live(scene), { deliveryCheckedAtMs: NOW - 99_900 }),
    },
    {
      row: 'diag.hbSent',
      state: '99.9 s ago',
      kind: 'worst',
      contains: '99.9',
      shown: (scene) =>
        withTelemetry(live(scene), {
          heartbeat: { ...live(scene).telemetry.heartbeat, lastSentAtEpochMs: NOW - 99_900 },
        }),
    },
    // 100 %: a percentage's own ceiling.
    {
      row: 'diag.battery',
      state: '100 %',
      kind: 'worst',
      contains: '100',
      shown: (scene) => withTelemetry(live(scene), { batteryPercent: 100 }),
    },
  ];
}

/** Probes per language: 4 Transport, 3 Delivery, 8 Heat, 6 other dashes, 6 worst-case numbers. */
const PROBES_PER_LANGUAGE = 27;

/** A fake engine in a named scene, read once. */
function scene(name: FakeScene): EngineSnapshot {
  const engine = createFakeCaptureEngine(() => NOW);
  engine.scene(name);
  const snapshot = engine.getSnapshot();
  engine.dispose();
  return snapshot;
}

type Reading = { readonly label: string; readonly value: string; readonly section: string | null };

/** The card's own rows for a snapshot, through the real composition and the real row selection. */
function cardRows(
  snapshot: EngineSnapshot,
  lang: Lang,
): readonly (Reading & { key: MessageKey })[] {
  return settingsDiagRows(diagnosticsSections(snapshot, NOW, createTranslator(lang)));
}

const fmt = (n: number) => n.toFixed(1);

let probesChecked = 0;
let labelsChecked = 0;
let sectionsChecked = 0;

describe('every Diagnostics row fits its line at 640 × 360, in every language (I-2)', () => {
  it('reads the fonts: Geist Mono is monospaced at 0.6 em', () => {
    expect(ADVANCE).toBeCloseTo(0.6, 9);
    for (const char of 'RTMPS (·)—SRTonly0123456789,%/hé') {
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

  it('the canvas type is what the roles carry: 13 / 13 / 14', () => {
    expect(typeScale.diagValue.fontSize).toBe(CANVAS_VALUE_PX);
    expect(typeScale.diagLabel.fontSize).toBe(CANVAS_ITEM_PX);
    expect(typeScale.diagSection.fontSize).toBe(CANVAS_SECTION_PX);
    expect(typeScale.diagSection.letterSpacing).toBe(SECTION_SPACING);
  });

  it('the item and value share 188 dp at 640 × 360: (640 - 32 - 16) / 2 - 24 - 84', () => {
    expect(ITEM_AND_VALUE).toBe(188);
    expect(SECTION_TEXT).toBe(72);
  });

  it.each(LANGS)(
    '%s: each of the nine items and its value, in every state, share the line',
    (lang) => {
      const set = probes();
      expect(set).toHaveLength(PROBES_PER_LANGUAGE);
      expect(set.filter((probe) => probe.kind === 'worst')).toHaveLength(6);
      const misfits: string[] = [];
      let checkedHere = 0;
      for (const probe of set) {
        const rows = cardRows(probe.shown(scene), lang);
        expect(rows.map((row) => row.key)).toEqual(CARD_ROWS);
        const row = rows.find((candidate) => candidate.key === probe.row);
        if (row === undefined) throw new Error(`no ${probe.row} row`);
        // The probe shows what it says it does: a dash for no reading, its number for a worst case.
        if (probe.state === 'no reading') expect(row.value, `${lang} ${probe.row}`).toBe('—');
        if (probe.contains !== undefined) {
          expect(row.value.replace(',', '.'), `${lang} ${probe.row} [${probe.state}]`).toContain(
            probe.contains,
          );
        }
        // Every character has a glyph in the face it is set in (a missing one falls back and is wider).
        for (const char of row.value) {
          expect(
            mono.has(char.codePointAt(0) ?? 0),
            `${lang} ${probe.row} value "${row.value}" has "${char}"`,
          ).toBe(true);
        }
        for (const char of row.label) {
          expect(
            medium.has(char.codePointAt(0) ?? 0),
            `${lang} label "${row.label}" has "${char}"`,
          ).toBe(true);
        }
        const itemWidth = medium.width(row.label, typeScale.diagLabel.fontSize);
        const valueWidth = mono.width(row.value, typeScale.diagValue.fontSize);
        const need = itemWidth + layout.diagPad + valueWidth;
        if (need > ITEM_AND_VALUE) {
          misfits.push(
            `${lang} ${probe.row} [${probe.state}] "${row.label}" ${fmt(itemWidth)} + ${layout.diagPad} + "${row.value}" ${fmt(valueWidth)} = ${fmt(need)} > ${ITEM_AND_VALUE}`,
          );
        }
        checkedHere += 1;
        probesChecked += 1;
      }
      expect(misfits).toEqual([]);
      expect(checkedHere).toBe(PROBES_PER_LANGUAGE);
    },
  );

  it.each(LANGS)('%s: the nine item labels are all there and fit a line on their own', (lang) => {
    const rows = cardRows(scene('paired-ready'), lang);
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(
        medium.width(row.label, typeScale.diagLabel.fontSize) + layout.diagPad,
        `${lang} "${row.label}"`,
      ).toBeLessThanOrEqual(ITEM_AND_VALUE);
      labelsChecked += 1;
    }
  });

  it.each(LANGS)('%s: the four section names fit the 72 dp of their column', (lang) => {
    const named = cardRows(scene('paired-ready'), lang).filter((row) => row.section !== null);
    expect(named).toHaveLength(4);
    for (const row of named) {
      const name = (row.section ?? '').toUpperCase();
      for (const char of name) {
        expect(
          condensed.has(char.codePointAt(0) ?? 0),
          `${lang} section "${name}" has "${char}"`,
        ).toBe(true);
      }
      const width =
        condensed.width(name, typeScale.diagSection.fontSize) +
        Array.from(name).length * (typeScale.diagSection.letterSpacing ?? 0);
      expect(width, `${lang} section "${name}"`).toBeLessThanOrEqual(SECTION_TEXT);
      sectionsChecked += 1;
    }
  });

  it('checked every string it set out to, in every language (anti-vacuity)', () => {
    expect(LANGS).toHaveLength(4);
    expect(probesChecked).toBe(4 * PROBES_PER_LANGUAGE);
    expect(labelsChecked).toBe(4 * 9);
    expect(sectionsChecked).toBe(4 * 4);
  });
});
