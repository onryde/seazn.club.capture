import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { halfNeeds, scoreRole } from '@/ui/theme/scoreRole';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesIn, linesOf } from '../../../test/textFit';

// The S2 pad preview (the controller's brief, 2026-10-31: "a 320-dp-wide render keeps the tool row and sync text
// without overflow"). Portrait only, layout A. The rooms are written out from the token and type declarations and the
// screen's styles, the widths measured from the fonts the app ships (test/fontMetrics.ts) and the copy read from the
// dictionaries: nothing is read from the components. Whether real text stays inside on a phone is the device check's.
//
// Widths: 320 (the brief's narrowest) and 360 (the owner's phone, 360 × 804, and most Android phones).

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
type Dictionary = Readonly<Record<string, string>>;
const WIDTHS = [320, 360] as const;

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist500 = loadFont('geist-500');

/** `actionSecondary`: a tool's label, Barlow Condensed 600 at 16, uppercase, letter-spaced. */
const toolWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `state`: the serving plate's word, Barlow Condensed 700 at 15, uppercase, letter-spaced. */
const plateWordWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The strip, the sync words, a tool's side, the Preview tag (`controlSmall`, same). */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `control`: Geist 500 at 14. The last-tap sentence, a refusal, and Undo's word. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `label`: Barlow Condensed 600 at 20, as typed. A half's names. */
const nameWidth = (text: string) => barlow600.width(text, typeScale.label.fontSize);

const words = (text: string) => text.split(' ');
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** A tool cell's text: a third of the row less its two gaps (space.sm), less the cell's padding (space.sm) and border. */
const toolText = (width: number) =>
  (column(width) - 2 * space.sm) / 3 - 2 * space.sm - 2 * layout.iconBorder;
/** A strip slot: a third of the row less its two gaps. */
const stripSlot = (width: number) => (column(width) - 2 * space.sm) / 3;

/** The sample names, as the fake's samples type them; doubles is the widest. */
const NAMES = ['A. Sharma', 'L. Chen', 'A. Sharma / R. Iyer', 'L. Chen / M. Wong'] as const;

describe('the rooms at 320 and 360', () => {
  it('the column is 288 and 328; a tool’s text 72.67 and 86; a strip slot 90.67 and 104', () => {
    expect(WIDTHS.map(column)).toEqual([288, 328]);
    expect(WIDTHS.map((width) => toolText(width).toFixed(2))).toEqual(['72.67', '86.00']);
    expect(WIDTHS.map((width) => stripSlot(width).toFixed(2))).toEqual(['90.67', '104.00']);
  });
});

describe('the tool row fits at 320 in four languages', () => {
  it.each(LANGUAGES)(
    '%s: every label in its reserved lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of ['scoring.badminton.tool.sanction', 'scoring.badminton.tool.setScore']) {
        const label = dictionary[key] ?? '';
        expect(label).not.toBe('');
        for (const width of WIDTHS) {
          expect(linesOf(label, toolText(width), toolWidth)).toBeLessThanOrEqual(
            layout.padToolLines,
          );
          for (const word of words(label))
            expect(toolWidth(word)).toBeLessThanOrEqual(toolText(width));
        }
      }
    },
  );

  it('a singles side’s name fits a Sanction’s second line; a doubles side is cut there (its spoken name is whole)', () => {
    const fits = (name: string, width: number) => unitWidth(name) <= toolText(width);
    expect(WIDTHS.map((width) => NAMES.map((name) => fits(name, width)))).toEqual([
      [true, true, false, false],
      [true, true, false, false],
    ]);
  });
});

describe('the header’s sync words fit at 320 in four languages', () => {
  /** Beside Back (touch), the Preview tag (its words, padding xs a side, border) and the dot (syncDot, gap xs). */
  const syncRoom = (width: number, dictionary: Dictionary) =>
    column(width) -
    layout.touch -
    space.sm -
    (unitWidth(dictionary['scoring.preview.tag'] ?? '') + 2 * space.xs + 2 * layout.iconBorder) -
    space.sm -
    layout.syncDot -
    space.xs;

  it.each(LANGUAGES)(
    '%s: each status, at 1 and 99 taps, in its reserved lines',
    (_lang, dictionary: Dictionary) => {
      const statuses = ['scoring.sync.synced'].concat(
        ...['sending', 'offline', 'refused'].map((kind) => [
          `scoring.sync.${kind}.one`,
          `scoring.sync.${kind}.other`,
        ]),
      );
      for (const key of statuses) {
        for (const count of ['1', '99']) {
          const text = fill(dictionary[key] ?? '', { count });
          expect(text).not.toBe('');
          for (const width of WIDTHS) {
            expect(linesOf(text, syncRoom(width, dictionary), unitWidth)).toBeLessThanOrEqual(
              layout.padSyncLines,
            );
          }
        }
      }
    },
  );

  it('Spanish offline needs both lines at 320: one line was not enough (anti-vacuity)', () => {
    const text = fill(es['scoring.sync.offline.other'], { count: '3' });
    expect(linesOf(text, syncRoom(320, es), unitWidth)).toBe(2);
  });
});

describe('the strip fits at 320 in four languages', () => {
  it.each(LANGUAGES)(
    '%s: each fact in its reserved lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const facts = [
        fill(dictionary['scoring.badminton.context'] ?? '', { bestOf: '3', game: '3' }),
        dictionary['scoring.badminton.court.left'] ?? '',
        dictionary['scoring.badminton.court.right'] ?? '',
        fill(dictionary['scoring.badminton.intervalAt'] ?? '', { point: '11' }),
        dictionary['scoring.badminton.intervalNow'] ?? '',
      ];
      for (const fact of facts) {
        expect(fact).not.toBe('');
        expect(linesOf(fact, stripSlot(320), unitWidth)).toBeLessThanOrEqual(layout.padStripLines);
        for (const word of words(fact)) expect(unitWidth(word)).toBeLessThanOrEqual(stripSlot(320));
      }
    },
  );
});

describe('the last-tap line', () => {
  /** Beside Undo (GhostButton: its word, padding md a side, border) and the gap before it. */
  const lineRoom = (width: number, dictionary: Dictionary) =>
    column(width) -
    (controlWidth(dictionary['scoring.pad.undo'] ?? '') + 2 * space.md + 2 * layout.iconBorder) -
    space.sm;
  /** Every sentence and refusal, at its widest: doubles names, a disqualification, a game in double figures. */
  const sentences = (dictionary: Dictionary) =>
    Object.keys(dictionary)
      .filter((key) => /^scoring\.(badminton\.(last|undone)|refusal)\./.test(key))
      .map((key) => ({
        key,
        text: fill(dictionary[key] ?? '', {
          side: 'A. Sharma / R. Iyer',
          person: 'A. Sharma',
          level: dictionary['scoring.sanction.disqualification'] ?? '',
          game: '3',
          score: '29–28',
        }),
      }));
  const cut = (width: number) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      sentences(dictionary)
        .filter(
          ({ text }) =>
            linesOf(text, lineRoom(width, dictionary), controlWidth) > layout.padLineLines,
        )
        .map(({ key }) => `${lang} ${key}`),
    );

  it('reads fourteen sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary)).toHaveLength(14);
  });

  it('holds every sentence and refusal whole at 360, in four languages', () => {
    expect(cut(360)).toEqual([]);
  });

  // At 320, Dutch's Undo ("Ongedaan maken") leaves its sentence 129.5 dp: these four take four lines and are cut at
  // three with an ellipsis. Each refusal still begins with "Niet vastgelegd", the part that says the tap did not count.
  it('cuts only these four Dutch lines at 320, after their third line', () => {
    expect(cut(320)).toEqual([
      'nl scoring.refusal.invalidScore',
      'nl scoring.refusal.nothingToUndo',
      'nl scoring.badminton.last.sanction',
      'nl scoring.badminton.undone.sanction',
    ]);
    const kept =
      linesIn(nl['scoring.refusal.invalidScore'], lineRoom(320, nl), controlWidth)[0] ?? '';
    expect(kept.startsWith('Niet vastgelegd')).toBe(true);
  });
});

describe('a half', () => {
  it('holds a doubles side’s names beside the widest serving plate at 320, in its reserved lines', () => {
    const plate = Math.max(
      ...LANGUAGES.map(
        ([, dictionary]) => plateWordWidth(dictionary['scoring.pad.serving']) + 2 * space.sm,
      ),
    );
    const room = column(320) - layout.padSideBar - 2 * space.md - plate - space.sm;
    for (const name of NAMES)
      expect(linesOf(name, room, nameWidth)).toBeLessThanOrEqual(layout.padNameLines);
  });

  it('holds a two-digit score at 96 across its width at 320: two tabular digits, 95.6 dp', () => {
    const digits = 2 * barlow700.advanceOfName('zero.tf') * typeScale.score.fontSize;
    expect(digits.toFixed(1)).toBe('95.6');
    expect(digits).toBeLessThanOrEqual(column(320) - layout.padSideBar - 2 * space.md);
  });

  it('needs 194 for the score at 96 and 162 at 64: 2 × 16 padding + 2 × 22 names + 100 or 68 + 18 games line', () => {
    expect(halfNeeds('score')).toBe(194);
    expect(halfNeeds('scoreCompact')).toBe(162);
    expect([null, 194, 193, 162].map(scoreRole)).toEqual([
      'score',
      'score',
      'scoreCompact',
      'scoreCompact',
    ]);
  });
});

describe('the pad’s height, portrait', () => {
  /**
   * Everything but the halves: the screen's padding (2 × 16), the header (touch, 48), the strip (2 lines of 16), the
   * last-tap line (3 lines of 18: 54, over touch), a tool row with a two-line label and a side (2 × 4 + 2 × 1 + 2 × 19 +
   * 16 = 64), the preview row (touch), and the five gaps between the six (8).
   */
  const FIXED = 32 + 48 + 32 + 54 + 64 + 48 + 5 * 8;
  const halves = (height: number) => (height - FIXED - space.sm) / 2;

  it('reserves 318 dp around the halves', () => {
    expect(FIXED).toBe(318);
    expect(layout.touch).toBe(48);
    expect(layout.padStripLines * typeScale.metricUnit.lineHeight).toBe(32);
    expect(layout.padLineLines * typeScale.control.lineHeight).toBe(54);
    expect(
      2 * space.xs +
        2 * layout.iconBorder +
        layout.padToolLines * typeScale.actionSecondary.lineHeight +
        typeScale.metricUnit.lineHeight,
    ).toBe(64);
  });

  // The owner's phone is 360 × 804; with its status bar (32) and 3-button navigation (48) the app has about 724, an
  // estimate from N35's sideways insets (804 × 360 laid out 728 × 328). A device check settles it; `scoreRole` adapts
  // either way.
  it('sets the score at 96 on the owner’s phone, about 360 × 724: each half 199, 5 to spare', () => {
    expect(halves(724)).toBe(199);
    expect(scoreRole(halves(724))).toBe('score');
  });

  it('sets the score at 96 from 714 tall, at 64 from 650; below that a half is cut, never drawn over the other', () => {
    expect(halves(714)).toBe(halfNeeds('score'));
    expect(halves(650)).toBe(halfNeeds('scoreCompact'));
    expect(scoreRole(halves(713))).toBe('scoreCompact');
  });
});
