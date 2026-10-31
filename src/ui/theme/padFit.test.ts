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

describe('the header fits on one row at 320 and 360 in four languages', () => {
  // Owner ruling 15 (2026-10-31): a Rules button in the top bar beside the sync status. Back, the Preview tag, Rules and
  // the sync status share one row, `space.xs` apart; Rules is its word as a tool's (`actionSecondary`) in an outline,
  // `space.xs` a side, at least a touch target wide.
  const tag = (dictionary: Dictionary) =>
    unitWidth(dictionary['scoring.preview.tag'] ?? '') + 2 * space.xs + 2 * layout.iconBorder;
  const rules = (dictionary: Dictionary) =>
    Math.max(
      layout.touch,
      toolWidth(dictionary['scoring.rules.open'] ?? '') + 2 * space.xs + 2 * layout.iconBorder,
    );
  /** What the sync words have: the column less Back, the tag (preview only), Rules, the dot and the gaps between. */
  const syncRoom = (width: number, dictionary: Dictionary, withTag = true) =>
    column(width) -
    layout.touch -
    space.xs -
    (withTag ? tag(dictionary) + space.xs : 0) -
    rules(dictionary) -
    space.xs -
    layout.syncDot -
    space.xs;
  const statuses = ['scoring.sync.synced'].concat(
    ...['sending', 'offline', 'refused'].map((kind) => [
      `scoring.sync.${kind}.one`,
      `scoring.sync.${kind}.other`,
    ]),
  );
  /** The most lines any status takes, at 1 and at 99 taps (the longest sync words). */
  const mostLines = (width: number, dictionary: Dictionary, withTag = true) =>
    Math.max(
      ...statuses.flatMap((key) =>
        ['1', '99'].map((count) => {
          const text = fill(dictionary[key] ?? '', { count });
          expect(text).not.toBe('');
          return linesOf(text, syncRoom(width, dictionary, withTag), unitWidth);
        }),
      ),
    );

  it('has the Rules word in every language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(dictionary['scoring.rules.open']).toBeTruthy();
  });

  it('gives the sync words three lines, which are the header’s own touch height: a third line never grows the row', () => {
    expect(layout.padSyncLines * typeScale.metricUnit.lineHeight).toBe(layout.touch);
  });

  it.each(LANGUAGES)(
    '%s: with the Preview tag, each status at 1 and 99 taps in its reserved lines',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(mostLines(width, dictionary)).toBeLessThanOrEqual(layout.padSyncLines);
    },
  );

  // The tag is the preview's own (S2's real pad has none): without it, every status keeps to two lines at 320.
  it.each(LANGUAGES)(
    '%s: without the Preview tag, each status in two lines at 320 and 360',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(mostLines(width, dictionary, false)).toBeLessThanOrEqual(2);
    },
  );

  it('needs the third line only in Spanish at 320, beside the Preview tag (anti-vacuity)', () => {
    const third = LANGUAGES.flatMap(([lang, dictionary]) =>
      WIDTHS.filter((width) => mostLines(width, dictionary) === 3).map(
        (width) => `${lang} ${width}`,
      ),
    );
    expect(third).toEqual(['es 320']);
    const offline = fill(es['scoring.sync.offline.other'], { count: '99' });
    expect(linesOf(offline, syncRoom(320, es), unitWidth)).toBe(3);
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

  it('reads thirteen sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary)).toHaveLength(13);
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

  // A repeat within the bounce window says "Counted once" under the sentence of the tap that counted (review item 3):
  // one line of `controlInk` (Geist 500 at 14, as `control`), and the sentence gives up a line for it.
  it('holds "Counted once" on one line beside Undo at 320 and 360, in four languages', () => {
    for (const [, dictionary] of LANGUAGES) {
      const note = dictionary['scoring.pad.countedOnce'] ?? '';
      expect(note).not.toBe('');
      for (const width of WIDTHS)
        expect(linesOf(note, lineRoom(width, dictionary), controlWidth)).toBe(1);
    }
  });

  /** The sentences a note can sit under: a rally that counted (a point, a game, the match) and any Undo. */
  const NOTED = /^scoring\.badminton\.(last\.(rally|game|match)|undone\.)/;
  const cutUnderNote = (width: number) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      sentences(dictionary)
        .filter(({ key }) => NOTED.test(key))
        .filter(
          ({ text }) =>
            linesOf(text, lineRoom(width, dictionary), controlWidth) > layout.padLineLines - 1,
        )
        .map(({ key }) => `${lang} ${key}`),
    );

  it('reads seven sentences a note can sit under, in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES)
      expect(sentences(dictionary).filter(({ key }) => NOTED.test(key))).toHaveLength(7);
  });

  // Under a note the sentence has two lines, and Dutch's Undo is wide: at its widest (doubles names, a
  // disqualification) these are cut after their second line with an ellipsis. What was recorded or undone, the words
  // before the colon, is always within the two kept lines; the names are what an ellipsis may cut. English, Spanish
  // and French hold every one whole at both widths.
  it('cuts only these Dutch sentences under a note: two at 360, five at 320', () => {
    expect(cutUnderNote(360)).toEqual([
      'nl scoring.badminton.last.match',
      'nl scoring.badminton.undone.sanction',
    ]);
    expect(cutUnderNote(320)).toEqual([
      'nl scoring.badminton.last.game',
      'nl scoring.badminton.last.match',
      'nl scoring.badminton.undone.rally',
      'nl scoring.badminton.undone.sanction',
      'nl scoring.badminton.undone.ending',
    ]);
  });

  it('keeps what was recorded or undone within the two lines of every Dutch sentence at 320', () => {
    const all = sentences(nl)
      .filter(({ key }) => NOTED.test(key))
      .map(({ key, text }) => ({
        key,
        head: (nl[key as keyof typeof nl] ?? '').split(':')[0] ?? '',
        kept: linesIn(text, lineRoom(320, nl), controlWidth)
          .slice(0, layout.padLineLines - 1)
          .join(' '),
      }));
    expect(all).toHaveLength(7);
    expect(all.filter(({ head, kept }) => head === '' || !kept.startsWith(head))).toEqual([]);
  });
});

describe('the update banner (owner ruling 8)', () => {
  /** Inside the banner: the column less its padding (space.sm a side) and its caution edge. */
  const inner = (width: number) => column(width) - 2 * space.sm - layout.padSideBar;
  /** A button's text: half the row less its gap, less the cell's padding (space.sm a side) and border. */
  const buttonText = (width: number) =>
    (inner(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
  const lines = (dictionary: Dictionary, key: string, width: number, vars = {}) => {
    const text = fill(dictionary[key] ?? '', vars);
    expect(text).not.toBe('');
    return linesOf(text, inner(width), controlWidth);
  };

  it('has 268 and 308 inside at 320 and 360; a button’s text 112 and 132', () => {
    expect(WIDTHS.map(inner)).toEqual([268, 308]);
    expect(WIDTHS.map(buttonText)).toEqual([112, 132]);
  });

  it.each(LANGUAGES)(
    '%s: Update and Score in the browser in a tool’s reserved lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of ['scoring.card.updateNeeded.update', 'scoring.card.updateNeeded.browser']) {
        const label = dictionary[key] ?? '';
        expect(label).not.toBe('');
        for (const width of WIDTHS) {
          expect(linesOf(label, buttonText(width), toolWidth)).toBeLessThanOrEqual(
            layout.padToolLines,
          );
          for (const word of words(label))
            expect(toolWidth(word)).toBeLessThanOrEqual(buttonText(width));
        }
      }
    },
  );

  /**
   * Its height at its tallest, in any language at 320 or 360: padding (2 × 8), the sentence, a gap, the count at 99 taps,
   * a gap and the button row (48: two lines of 19, 2 × 4 padding, 2 × 1 border); the preview's note (a gap and a line)
   * on top. `control` and `controlInk` are 18 a line.
   */
  const tallest = (key: string, vars = {}) =>
    Math.max(
      ...LANGUAGES.flatMap(([, dictionary]) =>
        WIDTHS.map((width) => lines(dictionary, key, width, vars)),
      ),
    );
  const BANNER =
    2 * space.sm +
    tallest('scoring.card.updateNeeded.body') * 18 +
    space.sm +
    tallest('scoring.card.updateNeeded.unsent.other', { count: '99' }) * 18 +
    space.sm +
    48;
  const NOTE = space.sm + tallest('scoring.preview.noop') * 18;

  it('is 152 tall at most (two lines, two lines, the buttons), and 178 with the preview’s note', () => {
    expect(typeScale.control.lineHeight).toBe(18);
    expect(typeScale.controlInk.lineHeight).toBe(18);
    expect(
      2 * space.xs +
        2 * layout.iconBorder +
        layout.padToolLines * typeScale.actionSecondary.lineHeight,
    ).toBe(layout.touch);
    expect([BANNER, BANNER + NOTE]).toEqual([152, 178]);
  });

  /**
   * In the place of the last-tap line and the tools (`cardPlacement`'s `forControls`): around the halves, the screen's
   * padding (32), the header (48), the strip (32), the preview row (48) and the four gaps between the five (32), then
   * the banner and the gap between the halves.
   */
  const FIXED_UPDATE = 32 + 48 + 32 + 48 + 4 * 8;
  const halvesUnder = (height: number, banner: number) =>
    (height - FIXED_UPDATE - banner - space.sm) / 2;

  it('leaves each half 186 on the owner’s phone, about 360 × 724 (173 with the note): the score at 64, whole', () => {
    expect(FIXED_UPDATE).toBe(192);
    expect([halvesUnder(724, BANNER), halvesUnder(724, BANNER + NOTE)]).toEqual([186, 173]);
    expect(scoreRole(halvesUnder(724, BANNER + NOTE))).toBe('scoreCompact');
    expect(halvesUnder(724, BANNER + NOTE)).toBeGreaterThanOrEqual(halfNeeds('scoreCompact'));
  });

  it('would cut the score above the halves: with the last-tap line kept, a half 151 on the owner’s phone', () => {
    // The line (54) and the empty tool row's gap stay; the banner and its gap join the halves' column.
    const above = 32 + 48 + 32 + 54 + 48 + 5 * 8;
    const half = (724 - above - BANNER - 2 * space.sm) / 2;
    expect(half).toBe(151);
    expect(half).toBeLessThan(halfNeeds('scoreCompact'));
  });

  it('holds the score whole from 676 tall, 702 with the note', () => {
    expect(halvesUnder(676, BANNER)).toBe(halfNeeds('scoreCompact'));
    expect(halvesUnder(702, BANNER + NOTE)).toBe(halfNeeds('scoreCompact'));
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

  // Owner ruling 14 (2026-10-31): "score centred and larger". The controller's size: Barlow Condensed 700 at 128/132.
  it('holds a two-digit score at 128 across its width at 320: two tabular digits, 127.5 dp', () => {
    expect([typeScale.scoreLarge.fontSize, typeScale.scoreLarge.lineHeight]).toEqual([128, 132]);
    const digits = 2 * barlow700.advanceOfName('zero.tf') * typeScale.scoreLarge.fontSize;
    expect(digits.toFixed(1)).toBe('127.5');
    expect(digits).toBeLessThanOrEqual(column(320) - layout.padSideBar - 2 * space.md);
  });

  it('needs 226 for the score at 128, 194 at 96 and 162 at 64: 2 × 16 padding + 2 × 22 names + 132, 100 or 68 + the bottom row’s 18', () => {
    expect(halfNeeds('scoreLarge')).toBe(226);
    expect(halfNeeds('score')).toBe(194);
    expect(halfNeeds('scoreCompact')).toBe(162);
    expect([null, 226, 225, 194, 193, 162].map(scoreRole)).toEqual([
      'score',
      'scoreLarge',
      'score',
      'score',
      'scoreCompact',
      'scoreCompact',
    ]);
  });

  // The halves as laid out on the owner's phone (NE2211, 360 × 804; the controller's brief, 2026-10-31, from the device).
  it('sets the score at 96 on the owner’s phone with the preview row (a half 209), at 128 without it (233)', () => {
    expect(scoreRole(209)).toBe('score');
    expect(scoreRole(233)).toBe('scoreLarge');
  });
});

describe('a half’s bottom row: the games line and the hint (owner ruling 14)', () => {
  /** Inside a half: the column less the side bar and the half's padding (space.md a side). */
  const inner = (width: number) => column(width) - layout.padSideBar - 2 * space.md;
  /** Beside the games line (`control`) and the row's gap: the hint's room, one line of `metricUnit`. */
  const hintRoom = (width: number, games: string) => inner(width) - controlWidth(games) - space.sm;

  it('costs no height over the games line alone: the hint’s 16 dp line sits in the games line’s 18', () => {
    expect(typeScale.metricUnit.lineHeight).toBeLessThanOrEqual(typeScale.control.lineHeight);
  });

  it.each(LANGUAGES)(
    '%s: the games line is whole at 320 with the widest sanction',
    (_lang, dictionary: Dictionary) => {
      for (const level of ['warning', 'penalty', 'expulsion', 'disqualification']) {
        const games = fill(dictionary['scoring.badminton.gamesSanctioned'] ?? '', {
          count: '2',
          sanction: dictionary[`scoring.sanction.${level}`] ?? '',
        });
        expect(controlWidth(games)).toBeLessThanOrEqual(inner(320));
      }
    },
  );

  // The hint is one line, cut with an ellipsis where it is wider than its room. Beside "Games 0", a singles side's is
  // whole everywhere; a doubles side's names are what the ellipsis cuts.
  it('cuts only these hints beside “Games 0”: doubles in Spanish and French at 320, in French at 360', () => {
    const cut = WIDTHS.flatMap((width) =>
      LANGUAGES.flatMap(([lang, dictionary]) =>
        NAMES.filter((side) => {
          const games = fill(dictionary['scoring.badminton.games'], { count: '0' });
          const hint = fill(dictionary['scoring.badminton.hintLine'], { side });
          return unitWidth(hint) > hintRoom(width, games);
        }).map((side) => `${width} ${lang} ${side}`),
      ),
    );
    expect(cut).toEqual([
      '320 es A. Sharma / R. Iyer',
      '320 es L. Chen / M. Wong',
      '320 fr A. Sharma / R. Iyer',
      '320 fr L. Chen / M. Wong',
      '360 fr A. Sharma / R. Iyer',
      '360 fr L. Chen / M. Wong',
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

  it('sets the score at 128 from 778 tall', () => {
    expect(halves(778)).toBe(halfNeeds('scoreLarge'));
    expect(scoreRole(halves(777))).toBe('score');
  });
});
