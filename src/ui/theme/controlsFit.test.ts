import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { formatElapsed } from '@/i18n/formatElapsed';
import { controlsHalfWidth, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// Owner, 2026-10-08 (design follow-up §1, amended): the controls half takes the width its content needs and the
// camera half takes the rest. This proves the number. The width is the WIDEST ROW of the controls half in any state,
// plus the half's padding. Each row is written out here from the token and type declarations, the fonts the app
// ships (test/fontMetrics.ts) and the four dictionaries: none of it is read from a component. Whether real text
// stays inside is the phone's (and the browser harness's); jsdom lays nothing out.

type Dictionary = Readonly<Record<string, string>>;
const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist500 = loadFont('geist-500');

/** The gap of the icon row, the chip row and the plate row: `space.sm` in all three (the rendered tree pins it). */
const GAP = space.sm;

const wordsOf = (text: string) => text.split(/[  ]/).filter((word) => word !== '');

/** `state`: Barlow Condensed 700, uppercase, letter-spaced. The tally plate's word. */
const stateWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * [...text].length;
/** `action`: Barlow Condensed 700, uppercase, letter-spaced. The hold button's label. */
const actionWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.action.fontSize) +
  typeScale.action.letterSpacing * [...text].length;
/** `actionSecondary`: Barlow Condensed 600, uppercase, letter-spaced. The peek button's label. */
const peekLabelWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The reasons, the start line, the photo line. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `control`: Geist 500 at 14. The AUTO chip's word. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);

// ---------------------------------------------------------------------------------------------------------------
// (A) The rows, and the width they make
// ---------------------------------------------------------------------------------------------------------------

/**
 * Every row of the controls half whose width is the content's, in the state it is widest in. Each is `[name, the sum
 * from the declared makeup, the same worked by hand]`: the hand-worked number is what a dropped term fails by.
 *  - icons before air: Settings, Home, Take photo, Remote scoring: four 48 dp buttons, three gaps.
 *  - icons on air: Settings, Take photo, Remote scoring and then the peek, which is not an icon but a labelled
 *    button, and the row's remaining width: three 48 dp buttons, three gaps and the least cell the peek holds.
 *  - chips: camera, sound and network, and AUTO when automatic mode is on: the row is one line (it wraps in the
 *    component, but a second line is 44 + 8 dp the 360 dp stack has no room for), so all four sit side by side.
 *  - the plate row: the tally plate and the clock (on air) or the sound meter (before), a cell each, one gap.
 */
const ROWS = [
  [
    'icons before air',
    4 * layout.iconButton + 3 * GAP, // 4 × 48 + 3 × 8
    216,
  ],
  [
    'icons on air: three buttons and the peek cell',
    3 * layout.iconButton + 3 * GAP + layout.peekCell, // 3 × 48 + 3 × 8 + 101
    269,
  ],
  [
    'chips with AUTO',
    3 * layout.chip + 3 * GAP + layout.autoChip, // 3 × 44 + 3 × 8 + 52
    208,
  ],
  [
    'the plate row, with the clock',
    2 * layout.clockCell + GAP, // 2 × 135 + 8
    278,
  ],
] as const;

const NEEDED = Math.max(...ROWS.map((row) => row[1]));
const CONTENT = layout.controlsHalf - 2 * layout.controlsPad;

describe('the controls half is as wide as its widest row (owner, 2026-10-08)', () => {
  it.each(ROWS)('%s is %d dp, worked by hand', (_name, width, worked) => {
    expect(width).toBe(worked);
  });

  it('is the widest of the four rows plus the half’s padding either side: 278 + 2 × 16 = 310', () => {
    expect(ROWS).toHaveLength(4);
    expect(NEEDED).toBe(278);
    expect(layout.controlsHalf).toBe(NEEDED + 2 * layout.controlsPad);
    expect(layout.controlsHalf).toBe(310);
    expect(CONTENT).toBe(278);
  });

  it('is governed by the plate row, with the clock, and by no other', () => {
    const governing = ROWS.filter((row) => row[1] === NEEDED).map((row) => row[0]);
    expect(governing).toEqual(['the plate row, with the clock']);
  });

  it('holds every row: none is wider than the content the half leaves', () => {
    for (const [name, width] of ROWS) {
      expect({ name, fits: width <= CONTENT }).toEqual({ name, fits: true });
    }
  });
});

// With the shipped cells ONE row governs, so a derivation that dropped any of the other three would read the same.
// Each row is therefore made the widest in turn, with the others small, and the result worked by hand.
describe('the derivation takes every row into account (the width is a max, not a sum of what happens to govern)', () => {
  const SMALL = { peekCell: 0, autoChip: 0, clockCell: 0 };
  const TURNS = [
    // [which row governs, the cells, the result: that row + 2 × 16]
    ['icons before air (four buttons)', { ...layout, ...SMALL }, 4 * 48 + 3 * 8 + 32],
    [
      'icons on air (three buttons and a 300 dp peek)',
      { ...layout, ...SMALL, peekCell: 300 },
      3 * 48 + 3 * 8 + 300 + 32,
    ],
    [
      'chips (three and a 300 dp AUTO)',
      { ...layout, ...SMALL, autoChip: 300 },
      3 * 44 + 3 * 8 + 300 + 32,
    ],
    [
      'the plate row (a 300 dp clock cell)',
      { ...layout, ...SMALL, clockCell: 300 },
      2 * 300 + 8 + 32,
    ],
  ] as const;

  it.each(TURNS)('%s governs: %s', (_name, cells, worked) => {
    expect(controlsHalfWidth(cells)).toBe(worked);
  });

  it('counted four rows, and the token is the derivation of the shipped cells', () => {
    expect(TURNS).toHaveLength(4);
    expect(new Set(TURNS.map((turn) => turn[2])).size).toBe(4);
    expect(controlsHalfWidth(layout)).toBe(layout.controlsHalf);
  });

  it('adds the half’s padding either side, and only that', () => {
    expect(controlsHalfWidth({ ...layout, controlsPad: 20 })).toBe(layout.controlsHalf + 8);
    expect(controlsHalfWidth({ ...layout, controlsPad: 0 })).toBe(layout.controlsHalf - 32);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (B) The three cells that hold text, each the least whole dp that holds its words
// ---------------------------------------------------------------------------------------------------------------

describe('the clock cell holds the clock at its widest', () => {
  // `tabular-nums` makes the font swap in its TABULAR figures (`zero.tf` … `nine.tf`), which no code point reaches and
  // which are wider than the widest proportional digit (498 units against 484): a clock sized from `advance` alone
  // came to 131.3 dp, and a browser wrapped `99:59:59` into the 132 dp cell that sizing made (the harness, 2026-10-08).
  // So the clock is measured at the tabular digit. The longest the clock gets is H:MM:SS with a two-digit hour: 99:59:59
  // (a broadcast is hours long; YouTube's limit is 12). Hours 100 and up would need a ninth character.
  const NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const tabular = NAMES.map(
    (name) => barlow700.advanceOfName(`${name}.tf`) * typeScale.elapsed.fontSize,
  );
  const TABULAR_DIGIT = Math.max(...tabular);
  const COLON = barlow700.width(':', typeScale.elapsed.fontSize);
  const clockWidth = (time: string) =>
    [...time].reduce((sum, char) => sum + (char === ':' ? COLON : TABULAR_DIGIT), 0);
  const CLOCK = clockWidth('99:59:59');
  const PROPORTIONAL_DIGIT = Math.max(
    ...[...'0123456789'].map((digit) => barlow700.width(digit, typeScale.elapsed.fontSize)),
  );

  it('is set in Barlow Condensed 700 at 38 with tabular figures, the role’s own', () => {
    expect(typeScale.elapsed.fontFamily).toBe('BarlowCondensed_700Bold');
    expect(typeScale.elapsed.fontSize).toBe(38);
    expect(typeScale.elapsed.fontVariant).toEqual(['tabular-nums']);
  });

  it('has ten tabular digits of one width, 498 units, and the second reader (the browser) agrees', () => {
    expect(tabular).toHaveLength(10);
    expect(new Set(tabular).size).toBe(1);
    expect(barlow700.advanceOfName('zero.tf')).toBeCloseTo(0.498, 9);
    // Chromium laid out `99:59:59` in this font under `tabular-nums` at 134.45 dp, a digit at 18.94 (the harness).
    expect(TABULAR_DIGIT).toBeCloseTo(18.94, 1);
    expect(CLOCK).toBeCloseTo(134.45, 1);
    expect(() => barlow700.advanceOfName('no.such.glyph')).toThrow(/no glyph named/);
  });

  it('is wider than a clock sized from the widest proportional digit, which is why that one wrapped', () => {
    const proportional = 6 * PROPORTIONAL_DIGIT + 2 * COLON;
    expect(Math.round(proportional * 10) / 10).toBe(131.3);
    expect(proportional).toBeLessThan(CLOCK);
    expect(Math.ceil(proportional)).toBeLessThan(layout.clockCell);
  });

  it('is the least whole dp that holds HH:MM:SS at the tabular digit, 134.4 to 135', () => {
    expect(Math.round(CLOCK * 10) / 10).toBe(134.4);
    expect(layout.clockCell).toBe(Math.ceil(CLOCK));
    expect(layout.clockCell).toBe(135);
  });

  it('holds every time the clock shows, from 0:00:00 to 99:59:59', () => {
    const SECONDS = [
      0,
      59,
      60,
      3599,
      3600,
      9 * 3600 + 3599,
      10 * 3600,
      12 * 3600,
      99 * 3600 + 3599,
    ];
    let checked = 0;
    for (const seconds of SECONDS) {
      const time = formatElapsed(seconds * 1000);
      expect({ time, fits: clockWidth(time) <= layout.clockCell }).toEqual({ time, fits: true });
      checked += 1;
    }
    expect(checked).toBe(9);
    expect(formatElapsed(99 * 3600 * 1000 + 3599 * 1000)).toBe('99:59:59');
    // The negative pair: the clock at 100 h is a ninth character, and does not fit the cell.
    expect(clockWidth(formatElapsed(100 * 3600 * 1000))).toBeGreaterThan(layout.clockCell);
  });

  it('the plate’s words fit the cell beside it, in the cell the half gives: 7 plates × 4 languages', () => {
    const CELL = (CONTENT - GAP) / 2;
    expect(CELL).toBe(layout.clockCell);
    let checked = 0;
    let widest = 0;
    for (const [lang, dictionary] of LANGUAGES) {
      for (const plate of [
        'starting',
        'notReady',
        'ready',
        'connecting',
        'live',
        'trouble',
        'ended',
      ] as const) {
        const text = (dictionary as Dictionary)[`stream.tally.${plate}`] ?? '';
        // The plate may take a second line (its minHeight is 56 against two 17 dp lines), so each WORD must fit.
        for (const piece of wordsOf(text)) {
          const width = stateWidth(piece) + 2 * space.sm;
          widest = Math.max(widest, width);
          expect({ lang, plate, piece, fits: width <= CELL }).toEqual({
            lang,
            plate,
            piece,
            fits: true,
          });
        }
        checked += 1;
      }
    }
    expect(checked).toBe(28);
    expect(widest).toBeGreaterThan(0);
  });
});

describe('the AUTO chip is as wide as its word needs', () => {
  it('is Geist 500 at 14, a 2 dp border and 8 dp of padding each side: 51.8 to 52', () => {
    expect(typeScale.control.fontSize).toBe(14);
    const widths = LANGUAGES.map(
      ([, dictionary]) =>
        controlWidth((dictionary as Dictionary)['stream.chip.auto'] ?? '') +
        2 * space.sm +
        2 * layout.chipBorder,
    );
    expect(widths).toHaveLength(4);
    expect(Math.round(Math.max(...widths) * 10) / 10).toBe(51.8);
    expect(layout.autoChip).toBe(Math.ceil(Math.max(...widths)));
    expect(layout.autoChip).toBe(52);
  });
});

describe('the peek cell is the least the peek control holds', () => {
  // The peek (on air) is the icon row's remaining width: a 1 dp border and 8 dp of padding either side of its label,
  // the label at most `peekLabelLines` lines and each reason (no picture; the phone hot, D2 §4.2) at most
  // `peekReasonLines`, every word whole.
  const padding = 2 * layout.iconBorder + 2 * space.sm;
  function holds(cell: number): boolean {
    return LANGUAGES.every(([, dictionary]) => {
      const label = (dictionary as Dictionary)['stream.peek.label'] ?? '';
      const reasons = ['stream.peek.unavailable', 'stream.peek.hot'].map(
        (key) => (dictionary as Dictionary)[key] ?? '',
      );
      return (
        wordsOf(label).every((word) => peekLabelWidth(word) <= cell - padding) &&
        reasons.every((reason) => wordsOf(reason).every((word) => unitWidth(word) <= cell)) &&
        linesOf(label, cell - padding, peekLabelWidth) <= layout.peekLabelLines &&
        reasons.every((reason) => linesOf(reason, cell, unitWidth) <= layout.peekReasonLines)
      );
    });
  }
  const LEAST = (() => {
    for (let cell = 0; cell <= 400; cell += 1) if (holds(cell)) return cell;
    return NaN;
  })();

  it('is found at 101 dp, with 100 not enough', () => {
    expect(LEAST).toBe(101);
    expect(holds(100)).toBe(false);
    expect(holds(101)).toBe(true);
    expect(layout.peekCell).toBe(LEAST);
  });

  it('the cell the half really gives is no narrower: 278 - 3 × 48 - 3 × 8 = 110', () => {
    const cell = CONTENT - 3 * layout.iconButton - 3 * GAP;
    expect(cell).toBe(110);
    expect(cell).toBeGreaterThanOrEqual(layout.peekCell);
    expect(holds(cell)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (C) Every line of text in the half fits the width the half gives it
// ---------------------------------------------------------------------------------------------------------------

describe('every line of text in the controls half fits the 278 dp it is given', () => {
  let rows = 0;

  it('the hold button’s label: every word whole, and at most the lines its 72 dp holds', () => {
    // The plate has a 2 dp border and 8 dp of padding either side of the label; a label of two lines (27 dp each)
    // and the border is 58 of the 72.
    const inside = CONTENT - 2 * (2 + space.sm);
    const lines = Math.floor((layout.holdHeight - 2 * 2) / typeScale.action.lineHeight);
    expect(lines).toBe(2);
    for (const [lang, dictionary] of LANGUAGES) {
      for (const key of ['stream.action.goLive', 'stream.action.stop'] as const) {
        const text = (dictionary as Dictionary)[key] ?? '';
        for (const piece of wordsOf(text)) {
          expect({ lang, key, piece, fits: actionWidth(piece) <= inside }).toEqual({
            lang,
            key,
            piece,
            fits: true,
          });
        }
        expect(linesOf(text, inside, actionWidth), `${lang} ${key}`).toBeLessThanOrEqual(lines);
        rows += 1;
      }
    }
  });

  it('Go live’s reason, the start line and the photo line are ONE line each: the 360 dp stack has no room for a second', () => {
    // viewfinderFit.test.ts stacks one metricUnit line for the hold's reason and for the start line, and the photo
    // line is `numberOfLines` 1 (an ellipsis would cut it). The start line is measured at its worst time: a 24-hour
    // time and a zone name of the longest short kind ("GMT+10:30").
    const START = '23:59 GMT+10:30';
    const keys = [
      'stream.blocker.camera',
      'stream.blocker.network',
      'stream.blocker.sound',
      'stream.blocker.held',
      'stream.photo.saved',
      'stream.photo.failed',
    ] as const;
    for (const [lang, dictionary] of LANGUAGES) {
      const dict = dictionary as Dictionary;
      for (const key of keys) {
        const width = unitWidth(dict[key] ?? '');
        expect({ lang, key, fits: width <= CONTENT }).toEqual({ lang, key, fits: true });
        rows += 1;
      }
      const starts = (dict['stream.startsAt'] ?? '').replace('{time}', START);
      expect({ lang, starts, fits: unitWidth(starts) <= CONTENT }).toEqual({
        lang,
        starts,
        fits: true,
      });
      rows += 1;
    }
  });

  it('counted every row: 8 hold labels, 6 lines × 4 languages and 4 start lines = 36 (anti-vacuity)', () => {
    expect(rows).toBe(8 + 24 + 4);
  });
});
