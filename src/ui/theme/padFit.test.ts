import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { halfNeeds, scoreRole } from '@/ui/theme/scoreRole';
import { layout, space } from '@/ui/theme/tokens';
import { maxFontScale, typeScale } from '@/ui/theme/type';
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

describe('the header fits on one row at 320 and 360 (owner ruling 20)', () => {
  // Owner ruling 20 (2026-10-31): Back, then at the right end the sync status, then Rules and History, round icon
  // buttons as Home's gear (the order, owner 2026-11-03); between them the games tally, where the Preview tag was (owner, 2026-11-01). The owner's badge
  // (2026-11-02: "remove sending word and have a symbol/icon like green uparrow", and "increase the size of 0:0 to fit in
  // that space") took the words away: the status is an arrow and a count in `padSyncBox`, and the tally grows into the
  // room that gave back. The row's items are `space.xs` apart: Back, the tally and the end group, and inside the group
  // the badge's slot, Rules and History. Nothing in the row is a word any more, so there is no language to measure in
  // (the badge's words are a screen reader's, never drawn); what can still change its size is the phone's font scale,
  // which the tally and the badge's count cap (`maxFontScale`, review minor 4 of round 2).
  /** "1:0" in `tally`: two tabular digits (`zero.tf`, the widest) and the colon. Best of 3: a side wins 2 at most. */
  const tallyAt = (fontSize: number) =>
    (2 * barlow700.advanceOfName('zero.tf') + barlow700.advance(':'.codePointAt(0) ?? 0)) *
    fontSize;
  const tally = tallyAt(typeScale.tally.fontSize);
  /** What the tally has: the column less Back, Rules, History, the badge's slot and the four gaps. */
  const tallyRoom = (width: number) =>
    column(width) - 3 * layout.iconButton - layout.padSyncBox - 4 * space.xs;
  /** `syncCount`: Barlow Condensed 700 at 18, tabular figures. */
  const countWidth = (text: string) =>
    [...text].reduce(
      (sum, char) =>
        sum +
        (/\d/.test(char)
          ? barlow700.advanceOfName('zero.tf')
          : barlow700.advance(char.codePointAt(0) ?? 0)) *
          typeScale.syncCount.fontSize,
      0,
    );
  /** The badge as drawn: its heavier outline either side, its padding, the arrow's box and the count (SyncBadge). */
  const badgeWidth = (text: string) =>
    2 * layout.iconBorderOn + 2 * space.xs + layout.padSyncGlyph + countWidth(text);

  it('draws Back, Rules and History as touch targets, 48 dp square (IconButton)', () => {
    expect(layout.iconButton).toBe(layout.touch);
  });

  it('holds the widest badge, "99+" in the heavier outline, in its slot: 55.8 dp of 56', () => {
    expect(badgeWidth('99+').toFixed(1)).toBe('55.8');
    expect(badgeWidth('99+')).toBeLessThanOrEqual(layout.padSyncBox);
    // Every count the badge can show is no wider (it never draws a third digit: it says "99+").
    for (let taps = 0; taps <= 99; taps += 1) {
      expect(badgeWidth(String(taps))).toBeLessThanOrEqual(layout.padSyncBox);
    }
  });

  it('would not hold a third digit, which is why the badge stops at "99+" (anti-vacuity)', () => {
    expect(badgeWidth('100')).toBeGreaterThan(layout.padSyncBox);
  });

  it('keeps the count on one 20 dp line, inside the badge’s 48 dp touch height', () => {
    expect(typeScale.syncCount.lineHeight).toBeLessThanOrEqual(
      layout.touch - 2 * layout.iconBorderOn,
    );
    expect(layout.padSyncGlyph).toBeLessThanOrEqual(layout.touch - 2 * layout.iconBorderOn);
  });

  // The tally is digits, the same in every language, so one width holds for all four. At 320 the row leaves it 72 dp.
  it('holds the tally whole at 320 (58.5 dp of 72) and 360 (of 112), on a line that is the 48 dp row', () => {
    expect(WIDTHS.map(tallyRoom)).toEqual([72, 112]);
    expect(tally.toFixed(1)).toBe('58.5');
    expect(WIDTHS.map((width) => tally <= tallyRoom(width))).toEqual([true, true]);
    expect(typeScale.tally.lineHeight).toBe(layout.touch);
  });

  it('keeps the tally clear of the badge’s slot at 320 by more than a few dp, for a width the fonts read slightly differently', () => {
    expect(tallyRoom(320) - tally).toBeGreaterThanOrEqual(8);
  });

  // The words took 88 dp and left the tally 40: at 30 dp it was 38.1. Its size is bound by the row's height, not by its
  // room: at 54 dp the digits still have room at 320, but the line they are set on would be taller than the 48 dp row.
  it('is bound by the 48 dp row’s height, not by its room: 54 dp would still fit the width at 320, and its line would not fit the row', () => {
    expect(tallyAt(54)).toBeLessThanOrEqual(tallyRoom(320));
    expect(Math.ceil(54 * (typeScale.tally.lineHeight / typeScale.tally.fontSize))).toBeGreaterThan(
      layout.touch,
    );
  });

  // Review minor 4 (round 2): the phone's font scale grows text the row measured at 1. The tally, which never shrinks, would
  // push Rules and History off the row at 320 from a 1.23 scale; the count would leave its 56 dp slot at any scale
  // above 1. Their roles cap it (`maxFontScale`, read by `Text`), and a 1.3 scale, a common one, still fits.
  describe('at a font scale of 1.3', () => {
    const SCALE = 1.3;
    const grown = (role: keyof typeof maxFontScale) => Math.min(SCALE, maxFontScale[role] ?? SCALE);

    it('would push the row out of 320 uncapped (anti-vacuity): the tally 76.1 dp of 72, the widest badge 56.3 of 56', () => {
      expect(tallyAt(typeScale.tally.fontSize * SCALE)).toBeGreaterThan(tallyRoom(320));
      expect(badgeWidth('99+') + (SCALE - 1) * countWidth('99+')).toBeGreaterThan(
        layout.padSyncBox,
      );
    });

    it('keeps the tally whole in its room at 320: capped at 1.15, 67.2 dp of 72, with a few dp to spare', () => {
      expect(maxFontScale.tally).toBe(1.15);
      expect(grown('tally')).toBe(1.15);
      const width = tallyAt(typeScale.tally.fontSize * grown('tally'));
      expect(width.toFixed(1)).toBe('67.2');
      expect(tallyRoom(320) - width).toBeGreaterThanOrEqual(4);
    });

    it('keeps the widest count, "99+", in the badge’s slot: capped at 1, so it does not grow at all', () => {
      expect(maxFontScale.syncCount).toBe(1);
      const width = badgeWidth('99+') + (grown('syncCount') - 1) * countWidth('99+');
      expect(width).toBeLessThanOrEqual(layout.padSyncBox);
    });

    it('caps no other role: everything else follows the phone’s scale, as the rest of the app does', () => {
      expect(Object.keys(maxFontScale).sort()).toEqual(['syncCount', 'tally']);
    });
  });

  it('is larger than the 30 dp it was, and was bound by the words then (the old box left it 40 at 320)', () => {
    const OLD_BOX = 88;
    const oldRoom = column(320) - 3 * layout.iconButton - OLD_BOX - 4 * space.xs;
    expect(oldRoom).toBe(40);
    expect(tallyAt(32)).toBeGreaterThan(oldRoom);
    expect(typeScale.tally.fontSize).toBeGreaterThan(30);
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
        said('start', { side }),
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

  // Fifteen since S2-1 Task 7 added the start with no named server ("Match started"); eighteen since Task 9 added three
  // refusals the hook says: the match moved on, this phone could not save the tap, and the save is being retried.
  it('reads eighteen sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary)).toHaveLength(18);
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
  // The other note, "Another scorer since" (Task 9), stands under the last tap while Undo is off for that reason; a
  // third, "Undo waiting to send", while an Undo waits for its tap's answer: one line each, in the same ink.
  it.each([
    'scoring.pad.countedOnce',
    'scoring.pad.otherScorerSince',
    'scoring.pad.undoWaiting',
  ] as const)(
    'holds the note %s on one line beside Undo at 320 and 360, in four languages',
    (key) => {
      for (const [lang, dictionary] of LANGUAGES) {
        const note = dictionary[key] ?? '';
        expect(note).not.toBe('');
        for (const width of WIDTHS) {
          const lines = linesOf(note, lineRoom(width, dictionary), controlWidth);
          expect({ lang, width, lines }).toEqual({ lang, width, lines: 1 });
        }
      }
    },
  );

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
   * a gap and the button row (48: two lines of 19, 2 × 4 padding, 2 × 1 border); the pad's note, "Couldn't open it" (a gap and a line)
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
  const NOTE = space.sm + tallest('scoring.card.cantOpen') * 18;

  it('is 152 tall at most (two lines, two lines, the buttons), and 178 with the note under it', () => {
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

/**
 * The match card (owner, 2026-11-01, option A), on the Not started card, in the Match details sheet and on the Start
 * screen, at 320 and 360 in four languages, for the singles and the doubles samples (the longest names and competition
 * the fake has), a long one an organiser can type (round 8 review) and every language's widest rule label. Nothing is
 * cut: nothing in the card has a line limit, so what can fail is a word wider than its room. The one word that may
 * break is the match's, on its plate, capped at `padMatchPlateMax` so it never squeezes the header: the fake's fit
 * whole, a long id wraps inside the cap. The rooms: the Not started card's text (the column less the card's padding,
 * space.md a side, and its edge, `padSideBar`), the sheet's (the screen less its padding) and the Start screen's (the
 * column). Inside the card: the header's text beside the match's plate, a side's names beside its bar on the versus
 * panel, and a rule's label and value beside each other.
 */
describe('the match card at 320 and 360 in four languages (owner, 2026-11-01, option A)', () => {
  const geist400 = loadFont('geist-400');
  const caps = (role: 'state' | 'panelTitle') => (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
    typeScale[role].letterSpacing * [...text].length;
  const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
  /** `matchName`: Barlow Condensed 600 at 26, as typed. A side's names on the versus panel. */
  const sideWidth = (text: string) => barlow600.width(text, typeScale.matchName.fontSize);
  const ROOMS = {
    card: (width: number) => column(width) - 2 * space.md - layout.padSideBar,
    sheet: (width: number) => width - 2 * space.md,
    start: (width: number) => column(width),
  } as const;
  /** The plate's box if nothing capped it: its word in `state` caps, its padding (space.sm a side) and its outline. */
  const plateWhole = (match: string) => caps('state')(match) + 2 * space.sm + 2 * layout.iconBorder;
  /** The plate's box: as wide as its word, and at most `padMatchPlateMax`, where a longer word wraps inside it. */
  const plateBox = (match: string) => Math.min(plateWhole(match), layout.padMatchPlateMax);
  /** What the plate holds a line: its capped box less its padding and its outline. */
  const plateText = () => layout.padMatchPlateMax - 2 * space.sm - 2 * layout.iconBorder;
  /** The header's text: the card less the plate and their gap. */
  const headerText = (room: number, match: string) => room - space.sm - plateBox(match);
  /** A side's names: the panel less its padding (space.md a side), the bar and the bar's gap. */
  const sideText = (room: number) => room - 2 * space.md - layout.labelBar - layout.labelBarGap;
  const SAMPLES = [
    {
      competition: 'Spring Open 2026',
      where: 'U15 Boys Singles · Round 1',
      match: 'Match 4',
      sides: ['A. Sharma', 'L. Chen'],
    },
    {
      competition: 'Riverside Badminton Club Championships 2026',
      where: 'Open Mixed Doubles · Quarter-final',
      match: 'BAD0001',
      sides: ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'],
    },
    // The long sample of MatchCard.test.tsx: a county's whole name, a long division and round, a long match id and
    // double-barrelled partners. What an organiser can type, not what the fake has.
    {
      competition: 'Northamptonshire County Badminton Association Veterans Championships 2026',
      where: 'Over 45 Mixed Doubles Category A · Second Qualifying Round',
      match: 'NCBA-2026-0417',
      sides: [
        'Christopher Featherstonehaugh / Bartholomew Anstruther-Gough',
        'Maximiliano Fernández-Villaverde / Anneliese Oppenheimer-Weiß',
      ],
    },
  ] as const;
  const RULES = [
    ['format', 'scoring.badminton.rules.bestOf.other', { count: '3' }],
    ['points', 'scoring.badminton.rules.points.value', { points: '21', winBy: '2' }],
    ['cap', 'scoring.badminton.rules.cap.value', { cap: '30' }],
    ['interval', 'scoring.badminton.rules.interval.value', { point: '11' }],
    ['endsChange', 'scoring.badminton.rules.endsChange.value', { point: '11', game: '3' }],
  ] as const;
  /** Every word of the text fits the room: what wraps is never broken, and nothing overflows. */
  const fits = (text: string, room: number, measure: (text: string) => number) =>
    words(text).every((word) => measure(word) <= room);
  const rows = (dictionary: Dictionary) => {
    const said = (key: string) => {
      const text = dictionary[key] ?? '';
      expect(text).not.toBe('');
      return text;
    };
    return RULES.map(([name, key, vars]) => ({
      label: said(`scoring.badminton.rules.${name}.label`),
      value: fill(said(key), vars),
    }));
  };
  /** The label column: the widest label, rounded up as the card rounds it, and at most `padRuleLabelMax`. */
  const labelColumn = (labels: readonly string[]) =>
    Math.min(Math.ceil(Math.max(...labels.map(bodyWidth))), layout.padRuleLabelMax);

  it('the card’s text is 252 and 292 wide, the sheet’s and the Start screen’s 288 and 328', () => {
    expect(WIDTHS.map(ROOMS.card)).toEqual([252, 292]);
    expect(WIDTHS.map(ROOMS.sheet)).toEqual([288, 328]);
    expect(WIDTHS.map(ROOMS.start)).toEqual([288, 328]);
  });

  it('leaves a value 124 dp at 320 on the card beside the widest label column', () => {
    expect(ROOMS.card(320) - layout.padRuleLabelMax - space.md).toBe(124);
  });

  // Round 8 review: the plate had no width limit, so a long match id (NCBA-2026-0417, a 123 dp plate) left the header's
  // text 120.8 at 320 on the card, and the competition's longest word (NORTHAMPTONSHIRE, 128.9) broke mid-word.
  it('caps the match plate at 112: the header’s text keeps 132 at 320 on the card, and 128.9 is what its longest word needs', () => {
    expect(layout.padMatchPlateMax).toBe(112);
    expect(headerText(ROOMS.card(320), SAMPLES[2].match)).toBe(132);
    // Anti-vacuity: uncapped, that plate leaves the header less than the longest word needs.
    const uncapped = ROOMS.card(320) - space.sm - plateWhole(SAMPLES[2].match);
    expect(uncapped).toBeLessThan(caps('state')('Northamptonshire'));
    expect(headerText(ROOMS.card(320), SAMPLES[2].match)).toBeGreaterThan(
      caps('state')('Northamptonshire'),
    );
  });

  // The plate wraps inside its cap, which is the one place a word can break: the fake's match words fit its 94 dp
  // whole, the long sample's id (105.2) does not and wraps. Where the phone breaks an id with no space is the phone's
  // (UAX 14's LB25 allows no break between a hyphen and a digit), so only "wider than a line, so it wraps" is claimed.
  it('keeps the fake’s match words whole on the plate, and wraps the long sample’s id inside the cap', () => {
    expect(plateText()).toBe(94);
    for (const sample of SAMPLES.slice(0, 2))
      for (const word of words(sample.match))
        expect(caps('state')(word)).toBeLessThanOrEqual(plateText());
    expect(caps('state')(SAMPLES[2].match)).toBeGreaterThan(plateText());
  });

  // The size the owner approved on build 716 (2026-11-01): a step up from the match label's 20.
  it('sets the sides at 26, and the doubles sample’s names on one line a side at 320 on the card', () => {
    expect(typeScale.matchName.fontSize).toBe(26);
    for (const name of SAMPLES[1].sides)
      expect(linesOf(name, sideText(ROOMS.card(320)), sideWidth)).toBe(1);
  });

  // The `padRuleLabelMax` comment: Spanish's widest label (Cambio de lado, 108) keeps one line, French's and Dutch's
  // (Changement de côté, Van kant wisselen) wrap to two, and English's fit on one. The counts are literals, never read
  // back from the code.
  const RULE_LABEL_LINES = { en: 1, es: 1, fr: 2, nl: 2 } as const;
  it.each(LANGUAGES)(
    '%s: the widest label keeps one line where it is narrower than the cap, two where it is wider',
    (lang, dictionary: Dictionary) => {
      const labels = rows(dictionary).map((row) => row.label);
      const column = labelColumn(labels);
      const lines = labels.map((label) => linesOf(label, column, bodyWidth));
      expect(Math.max(...lines)).toBe(RULE_LABEL_LINES[lang]);
    },
  );

  it.each(LANGUAGES)(
    '%s: no word wider than its room, in any room, for every sample',
    (_lang, dictionary: Dictionary) => {
      const table = rows(dictionary);
      const column = labelColumn(table.map((row) => row.label));
      const heading = dictionary['scoring.rules.heading'] ?? '';
      for (const width of WIDTHS) {
        for (const room of Object.values(ROOMS).map((of) => of(width))) {
          for (const sample of SAMPLES) {
            const header = headerText(room, sample.match);
            expect(fits(sample.competition, header, caps('state'))).toBe(true);
            expect(fits(sample.where, header, bodyWidth)).toBe(true);
            for (const name of sample.sides)
              expect(fits(name, sideText(room), sideWidth)).toBe(true);
          }
          expect(fits(heading, room, caps('state'))).toBe(true);
          for (const { label, value } of table) {
            expect(fits(label, column, bodyWidth)).toBe(true);
            expect(fits(value, room - column - space.md, bodyWidth)).toBe(true);
          }
        }
        const card = ROOMS.card(width);
        expect(
          fits(dictionary['scoring.card.notStarted.title'] ?? '', card, caps('panelTitle')),
        ).toBe(true);
        expect(fits(dictionary['scoring.card.notStarted.body'] ?? '', card, bodyWidth)).toBe(true);
      }
    },
  );
});

/**
 * The Start screen (owner, 2026-11-01, option A) in the pad's column: the match card (measured above), "Who serves
 * first?", the two sides' buttons and Start match. Nothing is cut: every line wraps, so what can fail is a word wider
 * than its room, and the buttons standing side by side.
 */
describe('the Start screen at 320 and 360 in four languages (owner, 2026-11-01)', () => {
  const caps = (role: 'state' | 'action') => (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
    typeScale[role].letterSpacing * [...text].length;
  /** A side's button: half the row less its gap, less its padding (`space.sm` a side) and its border. */
  const tossText = (width: number) =>
    (column(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
  /** Start match's label: the column less the Button's padding (`space.xl` a side). */
  const startText = (width: number) => column(width) - 2 * space.xl;
  const SIDES = ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'] as const;

  it('holds the two sides side by side at 320 and 360: two of `padTossMin` and the gap fit the column', () => {
    for (const width of WIDTHS) {
      expect(2 * layout.padTossMin + space.sm).toBeLessThanOrEqual(column(width));
    }
    expect(WIDTHS.map(tossText)).toEqual([122, 142]);
  });

  it('fits every word of the doubles names in a button, wrapping to two lines at most', () => {
    for (const width of WIDTHS) {
      for (const name of SIDES) {
        expect(linesOf(name, tossText(width), nameWidth)).toBeLessThanOrEqual(2);
        for (const word of words(name))
          expect(nameWidth(word)).toBeLessThanOrEqual(tossText(width));
      }
    }
    // Anti-vacuity: at 320 a doubles name needs its second line, and the button grows for it.
    expect(SIDES.map((name) => linesOf(name, tossText(320), nameWidth))).toEqual([2, 2]);
  });

  it.each(LANGUAGES)(
    '%s: the question and Start match, no word wider than its room',
    (_lang, dictionary: Dictionary) => {
      const ask = dictionary['scoring.badminton.start.ask'] ?? '';
      const start = dictionary['scoring.start.confirm'] ?? '';
      expect([ask, start]).not.toContain('');
      for (const width of WIDTHS) {
        for (const word of words(ask)) {
          expect(caps('state')(word)).toBeLessThanOrEqual(column(width));
        }
        for (const word of words(start)) {
          expect(caps('action')(word)).toBeLessThanOrEqual(startText(width));
        }
      }
    },
  );
});

/**
 * The recorded result's card and its Undo window (owner, 2026-11-03), on the pad at 320 and 360 in four languages: the
 * title, the sentence while Undo is open, the sentence once it is closed, and the countdown line. The card has no line
 * limit (it stands above the halves and they give way), so what can fail is a word wider than its room, and a card so tall
 * the halves lose their room: the sentences are held to three lines, which is what the first wording of the French one
 * (four at 320) broke. The room is the card's text: the column less the card's padding (space.md a side) and its edge.
 */
describe('the recorded result card at 320 and 360 in four languages (owner, 2026-11-03)', () => {
  const geist400 = loadFont('geist-400');
  const titleWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.panelTitle.fontSize) +
    typeScale.panelTitle.letterSpacing * [...text].length;
  const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
  const room = (width: number) => column(width) - 2 * space.md - layout.padSideBar;
  /** The countdown line: its digits are tabular, every one as wide as Geist's `zero.tf`, and the most it counts is 45, two of them. */
  const countdownWidth = (text: string) =>
    bodyWidth(fill(text, { seconds: '' })) +
    2 * geist400.advanceOfName('zero.tf') * typeScale.body.fontSize;
  const said = (dictionary: Dictionary, name: string) => {
    const text = dictionary[`scoring.card.resultRecorded.${name}`] ?? '';
    expect(text).not.toBe('');
    return text;
  };
  const MOST_LINES = 3;

  it('has 252 and 292 for its text', () => {
    expect(WIDTHS.map(room)).toEqual([252, 292]);
  });

  it.each(LANGUAGES)(
    '%s: the title is one line, each sentence at most three, the countdown one, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS) {
        expect(linesOf(said(dictionary, 'title'), room(width), titleWidth)).toBe(1);
        for (const name of ['bodyOpen', 'bodyClosed']) {
          const text = said(dictionary, name);
          expect(linesOf(text, room(width), bodyWidth)).toBeLessThanOrEqual(MOST_LINES);
          for (const word of words(text)) expect(bodyWidth(word)).toBeLessThanOrEqual(room(width));
        }
        const counting = said(dictionary, 'undoCountdown');
        expect(linesOf(fill(counting, { seconds: '45' }), room(width), bodyWidth)).toBe(1);
        expect(countdownWidth(counting)).toBeLessThanOrEqual(room(width));
      }
    },
  );

  // The tallest the card is, in any language at 320 or 360: padding, the title, a gap, the sentence, and open also a
  // gap and the countdown line. `panelTitle` is 24 a line and `body` 22.
  it('is 160 tall at most with Undo open and 130 once it is closed', () => {
    expect([typeScale.panelTitle.lineHeight, typeScale.body.lineHeight]).toEqual([24, 22]);
    const tallest = (name: string) =>
      Math.max(
        ...LANGUAGES.flatMap(([, dictionary]) =>
          WIDTHS.map((width) => linesOf(said(dictionary, name), room(width), bodyWidth)),
        ),
      );
    const chrome = 2 * space.md + typeScale.panelTitle.lineHeight + space.sm;
    const open = chrome + tallest('bodyOpen') * 22 + space.sm + 22;
    const closed = chrome + tallest('bodyClosed') * 22;
    expect([open, closed]).toEqual([160, 130]);
  });

  // Anti-vacuity: the French sentence the card first had is four lines at 320, which is why it was cut.
  it('would be four lines in French at 320 with its first wording', () => {
    const first =
      "L'organisateur le finalise. Vous repérez une erreur dans vos propres saisies\u00a0? Annuler reste possible.";
    expect(linesOf(first, room(320), bodyWidth)).toBe(4);
    expect(linesOf(said(fr, 'bodyOpen'), room(320), bodyWidth)).toBe(3);
  });
});
