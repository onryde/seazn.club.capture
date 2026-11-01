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
const geistMono = loadFont('geist-mono-400');

/** `actionSecondary`: a tool's label, Barlow Condensed 600 at 16, uppercase, letter-spaced. */
const toolWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `state`: the serving plate's word, Barlow Condensed 700 at 15, uppercase, letter-spaced. */
const plateWordWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The strip, the sync words, a tool's side. */
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
/** A strip slot: half the row less its gap (the game of how many, and the interval; owner rulings 16 and 17). */
const stripSlot = (width: number) => (column(width) - space.sm) / 2;

/** The sample names, as the fake's samples type them; doubles is the widest. */
const NAMES = ['A. Sharma', 'L. Chen', 'A. Sharma / R. Iyer', 'L. Chen / M. Wong'] as const;

describe('the rooms at 320 and 360', () => {
  it('the column is 288 and 328; a tool’s text 72.67 and 86; a strip slot 140 and 160', () => {
    expect(WIDTHS.map(column)).toEqual([288, 328]);
    expect(WIDTHS.map((width) => toolText(width).toFixed(2))).toEqual(['72.67', '86.00']);
    expect(WIDTHS.map(stripSlot)).toEqual([140, 160]);
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

describe('the header fits on one row at 320 and 360 in four languages (owner ruling 20)', () => {
  // Owner ruling 20 (2026-10-31): Back, then at the right end Rules and History, round icon buttons as Home's gear, and
  // the sync status; between them the games tally, where the Preview tag was (owner, 2026-11-01). The row's items are
  // `space.xs` apart: Back, the tally and the end group, and inside the group Rules, History and the sync box
  // (`padSyncBox`: the dot, its gap and the words).
  /** "1:0" in `tally`: two tabular digits (`zero.tf`, the widest) and the colon. Best of 3: a side wins 2 at most. */
  const tally =
    (2 * barlow700.advanceOfName('zero.tf') + barlow700.advance(':'.codePointAt(0) ?? 0)) *
    typeScale.tally.fontSize;
  /** What the tally has: the column less Back, Rules, History, the sync box and the four gaps. */
  const tallyRoom = (width: number) =>
    column(width) - 3 * layout.iconButton - layout.padSyncBox - 4 * space.xs;
  /** The sync words' width in their box. */
  const syncWords = layout.padSyncBox - layout.syncDot - space.xs;
  const statuses = ['scoring.sync.synced'].concat(
    ...['sending', 'offline', 'refused'].map((kind) => [
      `scoring.sync.${kind}.one`,
      `scoring.sync.${kind}.other`,
    ]),
  );
  /** The most lines any status takes in a width, at 1 and at 99 taps (the longest sync words). */
  const mostLinesIn = (dictionary: Dictionary, width: number) =>
    Math.max(
      ...statuses.flatMap((key) =>
        ['1', '99'].map((count) => {
          const text = fill(dictionary[key] ?? '', { count });
          expect(text).not.toBe('');
          return linesOf(text, width, unitWidth);
        }),
      ),
    );
  /** ... in the box's words. */
  const mostLines = (dictionary: Dictionary) => mostLinesIn(dictionary, syncWords);

  it('draws Back, Rules and History as touch targets, 48 dp square (IconButton)', () => {
    expect(layout.iconButton).toBe(layout.touch);
    expect(syncWords).toBe(74);
  });

  it('gives the sync words three lines, which are the header’s own touch height: a third line never grows the row', () => {
    expect(layout.padSyncLines * typeScale.metricUnit.lineHeight).toBe(layout.touch);
  });

  it.each(LANGUAGES)(
    '%s: each status at 1 and 99 taps in its reserved lines, in the sync box, at any width',
    (_lang, dictionary: Dictionary) => {
      expect(mostLines(dictionary)).toBeLessThanOrEqual(layout.padSyncLines);
    },
  );

  // The ruling hoped the icons would give the sync words a line back. Two 48 dp icons and their gap take 100 dp where the
  // Rules word took 49 to 56, so the box holds Spanish offline in three lines and no fewer. The tag's going (owner,
  // 2026-11-01) frees nothing at 320: the tally takes its place, and the box is all that is left (below).
  it('needs the third line in Spanish, French and Dutch: `padSyncLines` stays at 3 (anti-vacuity)', () => {
    expect(LANGUAGES.map(([lang, dictionary]) => [lang, mostLines(dictionary)])).toEqual([
      ['en', 2],
      ['es', 3],
      ['fr', 3],
      ['nl', 3],
    ]);
    const offline = fill(es['scoring.sync.offline.other'], { count: '99' });
    expect(linesOf(offline, syncWords - 1, unitWidth)).toBe(4);
  });

  // The tally is digits, the same in every language, so one width holds for all four.
  it('holds the tally whole at 320 (38.1 dp of 40) and 360 (of 80), on a line inside the 48 dp row', () => {
    expect(WIDTHS.map(tallyRoom)).toEqual([40, 80]);
    expect(tally.toFixed(1)).toBe('38.1');
    expect(tally).toBeLessThanOrEqual(tallyRoom(320));
    expect(typeScale.tally.lineHeight).toBeLessThanOrEqual(layout.touch);
  });

  // The owner asked for 28 to 32 dp. At 32 "1:0" is 40.7 dp: over the 40 at 320.
  it('would not fit at 32 dp, the top of the asked range (anti-vacuity)', () => {
    expect(tally * (32 / typeScale.tally.fontSize)).toBeGreaterThan(tallyRoom(320));
  });

  // padSyncLines cannot drop to 2: the box would need fr's 101.5 dp of words (115.5 with the dot), and at 320 the row
  // leaves it 89.9 beside the tally.
  it('leaves the sync box no more room at 320 than it has: two lines would need 116', () => {
    const boxRoom = column(320) - 3 * layout.iconButton - tally - 4 * space.xs;
    expect(boxRoom.toFixed(1)).toBe('89.9');
    expect(LANGUAGES.some(([, dictionary]) => mostLinesIn(dictionary, boxRoom - 14) > 2)).toBe(
      true,
    );
  });
});

describe('History’s rows at 320 and 360 in four languages (owner ruling 21)', () => {
  // A row in the cover's column (the pad's: `space.md` a side): the sentence in `control`, `space.sm`, then the right
  // column (`padHistorySide`), never cut: the score (`metricValue`, Geist Mono 16), who recorded it and "Undone"
  // (`metricUnit`), each wrapping where it is wider. The sentence takes what is left, in at most `padHistoryLines`.
  const monoWidth = (text: string) => geistMono.width(text, typeScale.metricValue.fontSize);
  const SIDE_WORDS = [
    'scoring.history.thisPhone',
    'scoring.history.otherScorer',
    'scoring.history.undone',
  ] as const;
  const sentenceRoom = (width: number) => column(width) - space.sm - layout.padHistorySide;
  const PEOPLE = ['A. Sharma', 'R. Iyer', 'L. Chen', 'M. Wong'] as const;
  const LEVELS = ['warning', 'penalty', 'expulsion', 'disqualification'] as const;
  /** Every sentence a row can say, with the samples' names (doubles the widest) and game 3. */
  const sentences = (dictionary: Dictionary) => {
    const said = (key: string, vars: Readonly<Record<string, string>>) => {
      const text = dictionary[`scoring.badminton.last.${key}`] ?? '';
      expect(text).not.toBe('');
      return fill(text, vars);
    };
    return [
      ...NAMES.flatMap((side) => [
        said('rally', { side }),
        said('game', { game: '3', side }),
        said('match', { side }),
      ]),
      ...PEOPLE.flatMap((person) => [
        said('ending', { person }),
        ...LEVELS.map((level) =>
          said('sanction', { level: dictionary[`scoring.sanction.${level}`] ?? '', person }),
        ),
      ]),
      said('setScore', { score: '30–29' }),
    ];
  };

  it('leaves the sentence 192 at 320 and 232 at 360', () => {
    expect(WIDTHS.map(sentenceRoom)).toEqual([192, 232]);
  });

  it('holds the score on one line in the right column, and each side word in two, no word broken', () => {
    expect(monoWidth('30–29')).toBeLessThanOrEqual(layout.padHistorySide);
    for (const [, dictionary] of LANGUAGES) {
      for (const key of SIDE_WORDS) {
        const text = dictionary[key] ?? '';
        expect(text).not.toBe('');
        expect(linesOf(text, layout.padHistorySide, unitWidth)).toBeLessThanOrEqual(2);
        for (const word of words(text))
          expect(unitWidth(word)).toBeLessThanOrEqual(layout.padHistorySide);
      }
    }
  });

  // fr "Un autre marqueur", nl "Een andere scorer" and "Ongedaan gemaakt" are wider than the column: they wrap, and a
  // column as wide as them would leave a sentence a third line at 320.
  it('wraps the side words that are wider than the column (anti-vacuity)', () => {
    const wrapped = LANGUAGES.flatMap(([lang, dictionary]) =>
      SIDE_WORDS.filter(
        (key) => linesOf(dictionary[key] ?? '', layout.padHistorySide, unitWidth) === 2,
      ).map((key) => `${lang} ${key.slice('scoring.history.'.length)}`),
    );
    expect(wrapped).toEqual(['fr otherScorer', 'nl otherScorer', 'nl undone']);
  });

  it.each(LANGUAGES)(
    '%s: every sentence in at most two lines at 320 and 360, no word broken',
    (_lang, dictionary: Dictionary) => {
      expect(layout.padHistoryLines).toBe(2);
      for (const width of WIDTHS) {
        const room = sentenceRoom(width);
        for (const text of sentences(dictionary)) {
          expect(linesOf(text, room, controlWidth)).toBeLessThanOrEqual(layout.padHistoryLines);
          for (const word of words(text)) expect(controlWidth(word)).toBeLessThanOrEqual(room);
        }
      }
    },
  );

  it('needs the second line at 320 (anti-vacuity)', () => {
    const two = LANGUAGES.filter(([, dictionary]) =>
      sentences(dictionary).some((text) => linesOf(text, sentenceRoom(320), controlWidth) === 2),
    ).map(([lang]) => lang);
    expect(two).toEqual(['en', 'es', 'fr', 'nl']);
  });
});

describe('the strip fits at 320 in four languages', () => {
  /** Its facts at their widest: "Game 3 of 3" (owner ruling 16), and the interval's two. */
  const facts = (dictionary: Dictionary) => [
    fill(dictionary['scoring.badminton.gameOf'] ?? '', { game: '3', bestOf: '3' }),
    fill(dictionary['scoring.badminton.intervalAt'] ?? '', { point: '11' }),
    dictionary['scoring.badminton.intervalNow'] ?? '',
  ];

  it.each(LANGUAGES)(
    '%s: each fact in its reserved lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const fact of facts(dictionary)) {
        expect(fact).not.toBe('');
        expect(linesOf(fact, stripSlot(320), unitWidth)).toBeLessThanOrEqual(layout.padStripLines);
        for (const word of words(fact)) expect(unitWidth(word)).toBeLessThanOrEqual(stripSlot(320));
      }
    },
  );

  // Owner, 2026-10-31 ("Yes to the 8 dp"): with the court on the serving plate (ruling 17) the strip has two slots,
  // and every fact takes one line at either width, so the strip reserves one.
  it('holds every fact on one line at 320 and 360 in four languages: the strip reserves one', () => {
    expect(layout.padStripLines).toBe(1);
    for (const [, dictionary] of LANGUAGES)
      for (const fact of facts(dictionary))
        for (const width of WIDTHS) expect(linesOf(fact, stripSlot(width), unitWidth)).toBe(1);
  });
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
   * padding (32), the header (48), the strip (one line, 16), the preview row (48) and the four gaps between the five
   * (32), then the banner and the gap between the halves.
   */
  const STRIP = layout.padStripLines * typeScale.metricUnit.lineHeight;
  const FIXED_UPDATE = 32 + 48 + STRIP + 48 + 4 * 8;
  const halvesUnder = (height: number, banner: number) =>
    (height - FIXED_UPDATE - banner - space.sm) / 2;

  it('leaves each half 194 on the owner’s phone, about 360 × 724 (181 with the note): the score at 96, 64 with it', () => {
    expect(FIXED_UPDATE).toBe(176);
    expect([halvesUnder(724, BANNER), halvesUnder(724, BANNER + NOTE)]).toEqual([194, 181]);
    expect(scoreRole(halvesUnder(724, BANNER))).toBe('score');
    expect(scoreRole(halvesUnder(724, BANNER + NOTE))).toBe('scoreCompact');
    expect(halvesUnder(724, BANNER + NOTE)).toBeGreaterThanOrEqual(halfNeeds('scoreCompact'));
  });

  it('would cut the score above the halves: with the last-tap line kept, a half 159 on the owner’s phone', () => {
    // The line (54) and the empty tool row's gap stay; the banner and its gap join the halves' column.
    const above = 32 + 48 + STRIP + 54 + 48 + 5 * 8;
    const half = (724 - above - BANNER - 2 * space.sm) / 2;
    expect(half).toBe(159);
    expect(half).toBeLessThan(halfNeeds('scoreCompact'));
  });

  it('holds the score whole from 660 tall, 686 with the note', () => {
    expect(halvesUnder(660, BANNER)).toBe(halfNeeds('scoreCompact'));
    expect(halvesUnder(686, BANNER + NOTE)).toBe(halfNeeds('scoreCompact'));
  });
});

describe('a half', () => {
  /** The serving plate with its court on one line (owner ruling 17): the wider of its two words, and its padding. */
  const plate = (dictionary: Dictionary) =>
    Math.max(
      ...['left', 'right'].map((court) => {
        const shown = dictionary[`scoring.badminton.serving.${court}`] ?? '';
        expect(shown).not.toBe('');
        return plateWordWidth(shown);
      }),
    ) +
    2 * space.sm;
  /** Beside it: the half's names' room, inside the side bar and the padding, less the plate and the gap. */
  const namesRoom = (width: number, dictionary: Dictionary) =>
    column(width) - layout.padSideBar - 2 * space.md - plate(dictionary) - space.sm;

  // Owner ruling 17: "If the plate doesn't fit beside the names at 320 dp in any language, the court goes on a second
  // line." It fits in every one, so the court stays on the plate's one line: "SERVING · RIGHT".
  it.each(LANGUAGES)(
    '%s: holds the sample names beside the plate with its court at 320 and 360, in their lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const name of NAMES) {
          expect(linesOf(name, namesRoom(width, dictionary), nameWidth)).toBeLessThanOrEqual(
            layout.padNameLines,
          );
          for (const word of words(name))
            expect(nameWidth(word)).toBeLessThanOrEqual(namesRoom(width, dictionary));
        }
    },
  );

  it('sets a doubles side’s names on two lines beside the plate at 320 in every language, one at 360 but es and nl', () => {
    const twoLines = WIDTHS.flatMap((width) =>
      LANGUAGES.flatMap(([lang, dictionary]) =>
        NAMES.filter((name) => linesOf(name, namesRoom(width, dictionary), nameWidth) === 2).map(
          (name) => `${width} ${lang} ${name}`,
        ),
      ),
    );
    expect(twoLines).toEqual([
      '320 en A. Sharma / R. Iyer',
      '320 en L. Chen / M. Wong',
      '320 es A. Sharma / R. Iyer',
      '320 es L. Chen / M. Wong',
      '320 fr A. Sharma / R. Iyer',
      '320 fr L. Chen / M. Wong',
      '320 nl A. Sharma / R. Iyer',
      '320 nl L. Chen / M. Wong',
      '360 es A. Sharma / R. Iyer',
      '360 nl A. Sharma / R. Iyer',
    ]);
  });

  it('is one line of the plate’s word, 25 tall, inside the names’ two lines: the court costs the half no height', () => {
    const tall = typeScale.state.lineHeight + 2 * space.xs;
    expect(tall).toBe(25);
    expect(tall).toBeLessThanOrEqual(layout.padNameLines * typeScale.label.lineHeight);
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

  // The halves as laid out on the owner's phone (NE2211, 360 × 804; the controller's brief, 2026-10-31, from the device):
  // 209 with the preview row and 233 without, with the strip's two lines. One line gives each 8 more (below): 217 still
  // sets the score at 96, 241 at 128. A device check settles them.
  it('sets the score at 96 on the owner’s phone with the preview row (a half 217), at 128 without it (241)', () => {
    expect([scoreRole(209), scoreRole(233)]).toEqual(['score', 'scoreLarge']);
    expect([scoreRole(209 + 8), scoreRole(233 + 8)]).toEqual(['score', 'scoreLarge']);
  });
});

describe('a half’s bottom row: the finished games’ boxes, the sanction and the hint (owner rulings 14, 16)', () => {
  /** Inside a half: the column less the side bar and the half's padding (space.md a side). */
  const inner = (width: number) => column(width) - layout.padSideBar - 2 * space.md;
  /** `periodScore`: Barlow Condensed 700 at 15, tabular digits (`zero.tf`, wider than any proportional digit). */
  const digit = barlow700.advanceOfName('zero.tf') * typeScale.periodScore.fontSize;
  /** `n` boxes, `space.xs` apart (none in game 1). */
  const boxes = (n: number) => (n === 0 ? 0 : n * layout.padPeriodBox + (n - 1) * space.xs);
  /** The boxes and the sanction after them: a dot between (`control`) when there are both, `space.sm` around it. */
  const kept = (n: number, sanction: string) => {
    if (sanction === '') return boxes(n);
    const dot = n === 0 ? 0 : space.sm + controlWidth('·') + space.sm;
    return boxes(n) + dot + controlWidth(sanction);
  };
  /** What the hint has: the row less what is kept and the gap before it. */
  const hintRoom = (width: number, n: number, sanction: string) =>
    inner(width) - kept(n, sanction) - (kept(n, sanction) === 0 ? 0 : space.sm);
  const widestSanction = (dictionary: Dictionary) =>
    ['warning', 'penalty', 'expulsion', 'disqualification']
      .map((level) => dictionary[`scoring.sanction.${level}`] ?? '')
      .reduce((wide, word) => (controlWidth(word) > controlWidth(wide) ? word : wide), '');
  const hint = (dictionary: Dictionary, side: string) =>
    fill(dictionary['scoring.badminton.hintLine'] ?? '', { side });
  /** The hints cut, at both widths and in four languages, beside `n` boxes and a sanction (or none). */
  const cutHints = (n: number, withSanction: boolean) =>
    WIDTHS.flatMap((width) =>
      LANGUAGES.flatMap(([lang, dictionary]) => {
        const sanction = withSanction ? widestSanction(dictionary) : '';
        return NAMES.filter(
          (side) => unitWidth(hint(dictionary, side)) > hintRoom(width, n, sanction),
        ).map((side) => `${width} ${lang} ${side}`);
      }),
    );

  it('has 252 and 292 inside at 320 and 360', () => {
    expect(WIDTHS.map(inner)).toEqual([252, 292]);
  });

  // `halfNeeds` counts the taller of the sanction's line and the hint's: a box must be no taller than that.
  it('costs no height: a box (16 dp of digits and two hairlines) is the sanction’s own 18 dp line', () => {
    const box = typeScale.periodScore.lineHeight + 2 * layout.iconBorder;
    expect(box).toBe(18);
    expect(box).toBeLessThanOrEqual(typeScale.control.lineHeight);
    expect(typeScale.metricUnit.lineHeight).toBeLessThanOrEqual(typeScale.control.lineHeight);
  });

  it('makes every box one width: two tabular digits, 14.9 dp, its padding and hairlines, in 26', () => {
    expect((2 * digit).toFixed(1)).toBe('14.9');
    expect(2 * digit + 2 * space.xs + 2 * layout.iconBorder).toBeLessThanOrEqual(
      layout.padPeriodBox,
    );
  });

  it('has the widest sanction in every language: Disqualification, Descalificación, Disqualification, Diskwalificatie', () => {
    expect(LANGUAGES.map(([, dictionary]) => widestSanction(dictionary))).toEqual([
      en['scoring.sanction.disqualification'],
      es['scoring.sanction.disqualification'],
      fr['scoring.sanction.disqualification'],
      nl['scoring.sanction.disqualification'],
    ]);
  });

  // Owner ruling 16: "Boxes are never cut." A best of 3 decided shows three boxes and no hint (its halves take no tap).
  it.each(LANGUAGES)(
    '%s: three boxes, the dot and the widest sanction, whole at 320',
    (_lang, dictionary: Dictionary) => {
      expect(kept(3, widestSanction(dictionary))).toBeLessThanOrEqual(inner(320));
    },
  );

  /** A box marked DQ (owner ruling 18): its padding and hairlines, two tabular digits, a gap and the mark. */
  const markedBox = (dictionary: Dictionary) =>
    Math.max(
      layout.padPeriodBox,
      2 * space.xs +
        2 * layout.iconBorder +
        2 * digit +
        space.xs +
        unitWidth(dictionary['scoring.badminton.mark.disqualified'] ?? ''),
    );

  it('marks a box DQ in every language, 46.3 dp with the mark (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES)
      expect(dictionary['scoring.badminton.mark.disqualified']).toBeTruthy();
    expect(markedBox(en).toFixed(1)).toBe('46.3');
  });

  // Owner ruling 18: a match a disqualification ends in game 3 shows three boxes, one marked DQ, and the side
  // disqualified has the widest sanction after them. Its halves take no tap, so there is no hint.
  it.each(LANGUAGES)(
    '%s: three boxes, one marked DQ, the dot and the widest sanction, whole at 320 and 360',
    (_lang, dictionary: Dictionary) => {
      const row =
        2 * layout.padPeriodBox +
        markedBox(dictionary) +
        2 * space.xs +
        space.sm +
        controlWidth('·') +
        space.sm +
        controlWidth(widestSanction(dictionary));
      for (const width of WIDTHS) expect(row).toBeLessThanOrEqual(inner(width));
    },
  );

  // In play there are two boxes at most. Beside them and the widest sanction the hint is cut with an ellipsis, never
  // hidden: its first word and the ellipsis stay ("the hint gives way (ellipsis, then hidden) before the boxes").
  it.each(LANGUAGES)(
    '%s: beside two boxes and the widest sanction at 320, the hint keeps its first word and an ellipsis',
    (_lang, dictionary: Dictionary) => {
      const first = (dictionary['scoring.badminton.hintLine'] ?? '').split(' ')[0] ?? '';
      expect(first).not.toBe('');
      const room = hintRoom(320, 2, widestSanction(dictionary));
      expect(unitWidth(`${first}…`)).toBeLessThanOrEqual(room);
      for (const side of NAMES) expect(unitWidth(hint(dictionary, side))).toBeGreaterThan(room);
    },
  );

  it('keeps 65 to 70 dp for the hint beside two boxes and the widest sanction at 320, 105 to 110 at 360', () => {
    const rooms = (width: number) =>
      LANGUAGES.map(([, dictionary]) => hintRoom(width, 2, widestSanction(dictionary)).toFixed(1));
    expect(rooms(320)).toEqual(['65.0', '67.2', '65.0', '70.0']);
    expect(rooms(360)).toEqual(['105.0', '107.2', '105.0', '110.0']);
  });

  // Game 1, no sanction: the row is the hint alone, whole everywhere (owner ruling 16: "the row shows only the hint").
  it('holds every hint whole in game 1, at 320 and 360', () => {
    expect(cutHints(0, false)).toEqual([]);
  });

  it('cuts only these hints beside two boxes with no sanction: doubles in es and fr, and fr singles, at 320', () => {
    expect(cutHints(2, false)).toEqual([
      '320 es A. Sharma / R. Iyer',
      '320 es L. Chen / M. Wong',
      '320 fr A. Sharma',
      '320 fr A. Sharma / R. Iyer',
      '320 fr L. Chen / M. Wong',
      '360 fr A. Sharma / R. Iyer',
      '360 fr L. Chen / M. Wong',
    ]);
  });
});

describe('the pad’s height, portrait', () => {
  /**
   * Everything but the halves: the screen's padding (2 × 16), the header (touch, 48), the strip (one line of 16), the
   * last-tap line (3 lines of 18: 54, over touch), a tool row with a two-line label and a side (2 × 4 + 2 × 1 + 2 × 19 +
   * 16 = 64), the preview row (touch), and the five gaps between the six (8).
   */
  const STRIP = layout.padStripLines * typeScale.metricUnit.lineHeight;
  const FIXED = 32 + 48 + STRIP + 54 + 64 + 48 + 5 * 8;
  const halves = (height: number) => (height - FIXED - space.sm) / 2;

  it('reserves 302 dp around the halves', () => {
    expect(FIXED).toBe(302);
    expect(layout.touch).toBe(48);
    expect(STRIP).toBe(16);
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
  it('sets the score at 96 on the owner’s phone, about 360 × 724: each half 207, 13 to spare', () => {
    expect(halves(724)).toBe(207);
    expect(scoreRole(halves(724))).toBe('score');
  });

  // Owner, 2026-10-31 ("Yes to the 8 dp"): the strip's second line (16) went to the halves.
  it('gives each half 8 dp more than the strip’s two lines did', () => {
    const twoLineStrip = (height: number) => (height - (FIXED + 16) - space.sm) / 2;
    expect(halves(724) - twoLineStrip(724)).toBe(8);
    expect(twoLineStrip(724)).toBe(199);
  });

  it('sets the score at 96 from 698 tall, at 64 from 634; below that a half is cut, never drawn over the other', () => {
    expect(halves(698)).toBe(halfNeeds('score'));
    expect(halves(634)).toBe(halfNeeds('scoreCompact'));
    expect(scoreRole(halves(697))).toBe('scoreCompact');
  });

  it('sets the score at 128 from 762 tall', () => {
    expect(halves(762)).toBe(halfNeeds('scoreLarge'));
    expect(scoreRole(halves(761))).toBe('score');
  });
});
