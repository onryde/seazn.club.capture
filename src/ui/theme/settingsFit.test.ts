import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
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
/**
 * Back is an icon button, 48 square. The card's header row is 48 too: it held Share record's 48 dp button until N33
 * moved Share to the record row (the D3 fixes plan's Task 6.3), and it keeps that height (`minHeight: layout.touch`),
 * so the card is still 272. Share record's button is the 48 dp target around the board's box, drawn 37 dp tall (its
 * outline's rules are 35.9 dp apart, plus the 1 dp stroke). SettingsScreen.test.tsx and GhostButton.test.tsx pin both
 * rendered.
 */
const BACK = 48;
const HEADER = 48;
const SHARE = 48;
/** The board's drawn Share record box, and the padding and 12 dp text it holds (the board's, measured). */
const SHARE_DRAWN = 37;
const SHARE_PAD_X = 11;
const SHARE_BORDER = 1;
const SHARE_TEXT_PX = 12;

let fitsChecked = 0;

/** The halves under the way back: window - 2 × the screen's vertical padding - Back - the gap under it (space.sm). */
const halvesBudget = (height: number) => height - 2 * layout.settingsPadV - BACK - space.sm;
/** The card: 2 × its vertical padding + the header row + the gap under it + the rows. */
const cardHeight = 2 * layout.diagPadV + HEADER + layout.diagGap + ROWS * layout.diagRow;

describe('the Diagnostics card fits its half in landscape (spec §6)', () => {
  it('the halves have 280 at 640 × 360: 360 - 2 × 12 - 48 - 8 (canvas padding 12, Back 48)', () => {
    expect(halvesBudget(360)).toBe(280);
  });

  it('the card is 272: 2 × 10 + 48 + 6 + 9 × 22 (canvas padding 10, gap 6)', () => {
    expect(cardHeight).toBe(272);
  });

  // Every sum in this file adds these up. They are the board's numbers written as literals, so a token that drifts
  // from the board is red here and not quietly re-added into a new total (SettingsScreen.test.tsx pins the same
  // numbers in what it renders, so a token and its use cannot drift apart either).
  it('adds up the board’s numbers: the gaps, the paddings, the rows and the box', () => {
    expect({
      gap: space.sm,
      screenPad: space.md,
      landscapePadV: layout.settingsPadV,
      cardPadX: layout.diagPad,
      cardPadV: layout.diagPadV,
      cardGap: layout.diagGap,
      row: layout.diagRow,
      touch: layout.touch,
      switchRowPadX: layout.switchRowPadX,
      switchTrackW: layout.switchTrackW,
      segmentPadX: layout.segmentPadX,
      segmentMin: layout.segmentMin,
      shareBox: layout.ghostCompact,
      sharePadX: layout.ghostCompactPadX,
      shareBorder: layout.iconBorder,
    }).toEqual({
      gap: 8,
      screenPad: 16,
      landscapePadV: 12,
      cardPadX: 12,
      cardPadV: 10,
      cardGap: 6,
      row: 22,
      touch: 48,
      switchRowPadX: 12,
      switchTrackW: 40,
      segmentPadX: 12,
      segmentMin: 66,
      shareBox: SHARE_DRAWN,
      sharePadX: SHARE_PAD_X,
      shareBorder: SHARE_BORDER,
    });
    expect(layout.touch).toBe(HEADER); // the header row keeps the touch height
    expect(layout.touch).toBe(SHARE); // Share record's button is the touch target
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
const condensedBold = loadFont('barlow-condensed-700');
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
  /** The row must read the dash alone (a transport not yet named, whatever the broadcast offered). */
  readonly dash?: boolean;
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

/** [seconds, its digits as written in en]: the widest of each band of formatAge and both edges of each. */
const AGES = [
  [99.9, '99.9'],
  [100, '100'],
  [300, '300'],
  [599, '599'],
  [600, '10'],
  [5999, '99'],
  [6000, '1'],
  [86400, '24'],
] as const;
const LAGS = [
  [99.9, '99.9'],
  [100, '100'],
  [300, '300'],
  [599, '599'],
  [600, '600'],
  [5999, '5999'],
  [6000, '6000'],
  [86400, '86400'],
] as const;

/** Session states that name no transport (arming has none either, but a broadcast is not yet held). */
const NO_TRANSPORT = {
  armed: { kind: 'armed', cause: 'organiser', notReady: 'held' },
  reconnecting: {
    kind: 'reconnecting',
    cause: 'video-stalled',
    holdRemainingSeconds: 38,
    holdWindowSeconds: 183,
    sinceEpochMs: NOW,
  },
} as const satisfies Record<string, SessionState>;

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
    // Round 2: armed and reconnecting name no transport, so an RTMPS-only broadcast reads the dash alone.
    ...(['armed', 'reconnecting'] as const).map((name) => ({
      row: 'diag.transport' as const,
      state: `${name}, RTMPS only`,
      kind: 'static' as const,
      dash: true,
      shown: (scene: (name: FakeScene) => EngineSnapshot) => {
        const snapshot = live(scene);
        if (snapshot.broadcast === null) throw new Error('the live scene holds a broadcast');
        return {
          ...snapshot,
          state: NO_TRANSPORT[name],
          broadcast: { ...snapshot.broadcast, srtOffered: false },
        };
      },
    })),
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
    // Ages and durations from 0 s to 24 h. Off air the heartbeat runs every pollSeconds (5 to 300 s), so
    // ages of minutes and hours are normal; each band of the format (tenths, seconds, minutes, hours) is
    // sampled at its widest and at each edge (formatAge.test.ts pins the strings).
    ...AGES.flatMap(([seconds, contains]) => [
      {
        row: 'diag.checked' as const,
        state: `${seconds} s ago`,
        kind: 'worst' as const,
        contains,
        shown: (scene: (name: FakeScene) => EngineSnapshot) =>
          withTelemetry(live(scene), { deliveryCheckedAtMs: NOW - seconds * 1000 }),
      },
      {
        row: 'diag.hbSent' as const,
        state: `${seconds} s ago`,
        kind: 'worst' as const,
        contains,
        shown: (scene: (name: FakeScene) => EngineSnapshot) =>
          withTelemetry(live(scene), {
            heartbeat: {
              ...live(scene).telemetry.heartbeat,
              lastSentAtEpochMs: NOW - seconds * 1000,
            },
          }),
      },
    ]),
    // Behind live is a length of time and is not worded as an age, so it stays in plain seconds: 86400 s is
    // seven characters and fits, which the sweep proves at every edge.
    ...LAGS.map(([seconds, contains]) => ({
      row: 'diag.lag' as const,
      state: `${seconds} s behind`,
      kind: 'worst' as const,
      contains,
      shown: (scene: (name: FakeScene) => EngineSnapshot) =>
        withTelemetry(live(scene), { deliveredLagMs: seconds * 1000 }),
    })),
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

/**
 * Probes per language: 6 Transport (SRT, RTMPS, RTMPS only, the dash, and armed and reconnecting RTMPS-only),
 * 3 Delivery, 8 Heat, 6 other dashes, and 28 worst-case numbers (bitrate, rtt, battery, the lag at the hold
 * window, and 8 samples each of Behind live, Checked and Last sent).
 */
const PROBES_PER_LANGUAGE = 51;
const WORST_PER_LANGUAGE = 28;

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

/** The owner's Settings board (2026-10-08): the pulse beside the heading is drawn in an 18 dp box; the heading is 18 caps. */
const BOARD_PULSE_PX = 18;
const BOARD_TITLE_PX = 18;

/** The words of a label wrapped greedily into `width` dp of Geist 500; null when one word alone is wider. */
function wrapLines(label: string, width: number, size: number): number | null {
  const space = medium.width(' ', size);
  let lines = 1;
  let used = 0;
  for (const word of label.split(' ')) {
    const wide = medium.width(word, size);
    if (wide > width) return null;
    if (used === 0) used = wide;
    else if (used + space + wide <= width) used += space + wide;
    else {
      lines += 1;
      used = wide;
    }
  }
  return lines;
}

let probesChecked = 0;
let labelsChecked = 0;
let sectionsChecked = 0;
let headersChecked = 0;

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

  // The owner's board draws "DIAGNOSTICS" 90 dp wide in Barlow Condensed bold (measured 90.5 at 1.436 px per dp):
  // 18 is the size at which the shipped font sets it that wide, and its pulse is an 18 dp box.
  it('the heading is what the board draws: 18 caps, 90 dp wide, beside an 18 dp pulse', () => {
    expect(typeScale.diagTitle.fontSize).toBe(BOARD_TITLE_PX);
    expect(typeScale.diagTitle.textTransform).toBe('uppercase');
    expect(layout.pulseGlyph).toBe(BOARD_PULSE_PX);
    const word = 'DIAGNOSTICS';
    const width =
      condensedBold.width(word, typeScale.diagTitle.fontSize) +
      word.length * (typeScale.diagTitle.letterSpacing ?? 0);
    expect(Math.abs(width - 90.5)).toBeLessThanOrEqual(2);
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
      expect(set.filter((probe) => probe.kind === 'worst')).toHaveLength(WORST_PER_LANGUAGE);
      const misfits: string[] = [];
      let checkedHere = 0;
      for (const probe of set) {
        const rows = cardRows(probe.shown(scene), lang);
        expect(rows.map((row) => row.key)).toEqual(CARD_ROWS);
        const row = rows.find((candidate) => candidate.key === probe.row);
        if (row === undefined) throw new Error(`no ${probe.row} row`);
        // The probe shows what it says it does: a dash for no reading, its number for a worst case.
        if (probe.state === 'no reading' || probe.dash === true) {
          expect(row.value, `${lang} ${probe.row} [${probe.state}]`).toBe('—');
        }
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

  // N33: Share record left the header for the record row (the D3 fixes plan's Task 6.3); its labels are proved below,
  // in the column the row sits in. The header is the board's pulse and the heading on one line, still 48 dp tall. Two
  // widths bound it: the half of a 640 dp landscape window, and a 320 dp portrait phone's card (the narrowest card
  // there is: 320 - 2 x 16 - 2 x 12 = 264).
  const HEADER_WIDTHS = [
    ['640 landscape half', HALF - 2 * layout.diagPad, 272],
    ['320 portrait card', 320 - 2 * space.md - 2 * layout.diagPad, 264],
  ] as const;
  const LINE_16 = typeScale.controlSmall.lineHeight;

  it('the label is the board’s 12 dp on 16, and a wrapped label still fits the 37 dp box', () => {
    expect(typeScale.controlSmall.fontSize).toBe(SHARE_TEXT_PX);
    expect(LINE_16).toBe(16);
    // Two lines and the box's rules: 34, inside the 37 the board draws, so the box does not grow past the row's 48.
    expect(2 * LINE_16 + 2 * SHARE_BORDER).toBe(34);
    expect(Math.max(SHARE_DRAWN, 2 * LINE_16 + 2 * SHARE_BORDER)).toBeLessThanOrEqual(SHARE);
    // Three would not (50 > 48): the proof allows two.
    expect(3 * LINE_16 + 2 * SHARE_BORDER).toBeGreaterThan(SHARE);
  });

  it.each(HEADER_WIDTHS)('the %s is the width the proof says it is', (_name, inner, literal) => {
    expect(inner).toBe(literal);
  });

  describe.each(HEADER_WIDTHS)('%s', (where, inner) => {
    it.each(LANGS)('%s: the pulse and the heading share the header’s one line', (lang) => {
      const { t } = createTranslator(lang);
      const heading = t('diag.title').toUpperCase();
      for (const char of heading) {
        expect(
          condensedBold.has(char.codePointAt(0) ?? 0),
          `${lang} heading "${heading}" has "${char}"`,
        ).toBe(true);
      }
      const title =
        condensedBold.width(heading, typeScale.diagTitle.fontSize) +
        Array.from(heading).length * (typeScale.diagTitle.letterSpacing ?? 0);
      expect(
        BOARD_PULSE_PX + space.sm + title,
        `${where} ${lang} "${heading}"`,
      ).toBeLessThanOrEqual(inner);
      headersChecked += 1;
    });
  });

  it('checked every string it set out to, in every language (anti-vacuity)', () => {
    expect(LANGS).toHaveLength(4);
    expect(headersChecked).toBe(2 * 4); // two widths x four languages
    expect(probesChecked).toBe(4 * PROBES_PER_LANGUAGE);
    expect(labelsChecked).toBe(4 * 9);
    expect(sectionsChecked).toBe(4 * 4);
  });
});

// The switch rows and the side control are content-sized to their label (the board's rows): they are scrollers'
// content, so they never overflow the screen, but a word that cannot fit beside its control would be broken in
// the middle. Proved on the narrowest line the app lays them on: a 320 dp portrait phone, 16 dp each side
// (288), which is also under the 296 of a 640 dp landscape half.
const NARROW_LINE = 320 - 2 * space.md;
let sideChecked = 0;
let switchLabelsChecked = 0;
let powerChecked = 0;

/** The widest single word of a label, in Geist 500 at the control role's size. */
const longestWord = (label: string) =>
  Math.max(...label.split(' ').map((word) => medium.width(word, typeScale.control.fontSize)));

describe('the side control and the switch rows fit the narrowest line, in every language', () => {
  it('the narrowest line is 288 dp, and a 640 dp landscape half is wider (296)', () => {
    expect(NARROW_LINE).toBe(288);
    expect((640 - 2 * space.md - space.md) / 2).toBeGreaterThan(NARROW_LINE);
  });

  it.each(LANGS)('%s: the pair fits and leaves its label room for its longest word', (lang) => {
    const { t } = createTranslator(lang);
    const segment = (label: string) =>
      Math.max(
        layout.segmentMin,
        medium.width(label, typeScale.control.fontSize) + 2 * layout.segmentPadX,
      );
    // The box's own 1 dp outline each side, on top of its two segments.
    const pair =
      segment(t('settings.side.left')) + segment(t('settings.side.right')) + 2 * layout.iconBorder;
    const room = NARROW_LINE - pair - space.sm;
    const label = t('settings.side.label');
    expect(room, `${lang} room left for "${label}"`).toBeGreaterThanOrEqual(longestWord(label));
    sideChecked += 1;
  });

  it.each(LANGS)('%s: the switch label’s longest word fits beside its switch', (lang) => {
    const { t } = createTranslator(lang);
    // The row's padding each side, the 40 dp pill and the 8 dp gap between the label and it.
    const cell = NARROW_LINE - 2 * layout.switchRowPadX - layout.switchTrackW - space.sm;
    for (const key of ['settings.automatic.label'] as const) {
      expect(longestWord(t(key)), `${lang} ${key}`).toBeLessThanOrEqual(cell);
      switchLabelsChecked += 1;
    }
  });

  it('the English pair is the board’s: Left and Right sit on the 66 dp floor, 134 dp with the outline', () => {
    const { t } = createTranslator('en');
    for (const word of [t('settings.side.left'), t('settings.side.right')]) {
      expect(medium.width(word, typeScale.control.fontSize) + 2 * layout.segmentPadX).toBeLessThan(
        layout.segmentMin,
      );
    }
    expect(2 * layout.segmentMin + 2 * layout.iconBorder).toBe(134); // measured 134.4 on the board
  });

  // R5: the battery row's label shares its line with the state word, set at the control size; its longest word must
  // fit beside the longest of the three mode words (M5 of the Batch 5 review). Its button's words fit the compact box
  // on one line, and the path and the on-air reason (I3) are one line each at the caption size.
  it.each(LANGS)(
    '%s: the battery row’s label and state word share a line, and its button fits',
    (lang) => {
      const { t } = createTranslator(lang);
      const state = Math.max(
        ...(
          [
            'settings.power.unrestricted',
            'settings.power.optimized',
            'settings.power.restricted',
          ] as const
        ).map((key) => medium.width(t(key), typeScale.control.fontSize)),
      );
      const room = NARROW_LINE - state - space.sm;
      expect(longestWord(t('settings.power.background')), `${lang} label`).toBeLessThanOrEqual(
        room,
      );
      const button =
        medium.width(t('settings.power.open'), typeScale.controlSmall.fontSize) +
        2 * layout.ghostCompactPadX +
        2 * layout.iconBorder;
      expect(button, `${lang} button`).toBeLessThanOrEqual(NARROW_LINE);
      for (const key of ['settings.power.path', 'settings.power.onAir'] as const) {
        const line = t(key);
        // Every character is Geist's own: a fallback face on the phone would set the arrow wider than measured.
        expect(
          [...line].filter((char) => !medium.has(char.codePointAt(0) ?? 0)),
          `${lang} ${key}`,
        ).toEqual([]);
        expect(
          medium.width(line, typeScale.metricUnit.fontSize),
          `${lang} ${key}`,
        ).toBeLessThanOrEqual(NARROW_LINE);
      }
      powerChecked += 1;
    },
  );

  it('checked every language for the pair, the switch label and the battery row (anti-vacuity)', () => {
    expect(sideChecked).toBe(4);
    expect(switchLabelsChecked).toBe(4 * 1);
    expect(powerChecked).toBe(4);
  });
});

// N33 and P11 (the D3 fixes plan's ruling, the controller's): the record row stacks Share record and Send record to
// Seazn in the settings column, so each button may take the column's whole width. Two widths bound the column: a
// 640 dp landscape window's half (296), and a 320 dp portrait phone (288). The box's label is its width less 11 dp of
// padding and 1 dp of border each side. Every label fits one line, with no word broken: the words as written, and
// Sent with the longest reference the port accepts. (The 37 dp box would hold two, above; none needs the second.)
const RECORD_WIDTHS = [
  ['640 landscape half', HALF, 296],
  ['320 portrait column', NARROW_LINE, 288],
] as const;
/** The longest reference the upload port accepts (16 characters), in the widest capital. */
const WORST_REF = `R-${'W'.repeat(14)}`;
let recordLabelsChecked = 0;

describe('the record row’s buttons fit the settings column, in every language (N33, P11)', () => {
  it.each(RECORD_WIDTHS)('the %s is the width the proof says it is', (_name, width, literal) => {
    expect(width).toBe(literal);
  });

  describe.each(RECORD_WIDTHS)('%s', (where, width) => {
    it.each(LANGS)('%s: every label of both buttons fits its box', (lang) => {
      const { t } = createTranslator(lang);
      const text = width - 2 * SHARE_PAD_X - 2 * SHARE_BORDER;
      const labels = [
        t('diag.share'),
        t('diag.shareFailed'),
        t('record.send'),
        t('record.sending'),
        t('record.sendFailed'),
        t('record.sent', { ref: 'R-7K2Q' }),
        t('record.sent', { ref: WORST_REF }),
      ];
      for (const label of labels) {
        expect(
          [...label].filter((char) => !medium.has(char.codePointAt(0) ?? 0)),
          `${lang} "${label}"`,
        ).toEqual([]);
        const lines = wrapLines(label, text, typeScale.controlSmall.fontSize);
        expect(lines, `${where} ${lang} "${label}" breaks no word in ${fmt(text)} dp`).not.toBe(
          null,
        );
        expect(lines, `${where} ${lang} "${label}"`).toBe(1);
        recordLabelsChecked += 1;
      }
    });
  });

  it('checked seven labels at both widths in every language (anti-vacuity)', () => {
    expect(recordLabelsChecked).toBe(2 * 4 * 7);
  });
});
