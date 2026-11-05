import { describe, expect, it } from 'vitest';
import { chessResultLine } from '@/domain/scoring/chessPad';
import { CHESS_TIEBREAK_SCORES, type ChessMethod } from '@/domain/scoring/chessTypes';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { chessDisplay } from '../../../test/chessLedger';
import { loadFont } from '../../../test/fontMetrics';
import { linesIn, linesOf } from '../../../test/textFit';

// Plan S2-3 Task 3: what the chess pad draws fits at 320 and 360 dp in four languages (the controller's brief; the pattern
// of padFit.test.ts, whose rooms are copied here from the token and type declarations and the components' styles, never
// read from the components): the half with the longest name beside its plate, what a tap records, Draw and Swap
// colours, the strip's lines, the header's result line, the last-tap sentences, and the sheet that asks How. S2-3b adds the
// tie-break: its tile, its "{name} advances · {rung}" line in the strip, the last-tap line and its Undo wrapper, and every
// step of its sheet. Whether real text stays inside on a phone is the device check's.

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
const geist400 = loadFont('geist-400');

const said = (dictionary: Dictionary, key: string): string => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text);

/** `actionSecondary`: a tool's label, Barlow Condensed 600 at 16, uppercase, letter-spaced. */
const toolWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `state`: a plate's word, Barlow Condensed 700 at 15, uppercase, letter-spaced. */
const plateWordWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The strip's line and a half's visible action. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `control`: Geist 500 at 14. The last-tap sentence and Undo's word; `controlInk` (a chip's word) is the same size. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `body`: Geist 400 at 15. The sheet's line under its title and its hint. */
const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
/** `label`: Barlow Condensed 600 at 20, as typed. A half's names. */
const nameWidth = (text: string) => barlow600.width(text, typeScale.label.fontSize);
/** `title`: Barlow Condensed 700 at 26, uppercase, letter-spaced. The sheet's question. */
const titleWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
/** `tally`: Barlow Condensed 700 at 46, tabular digits (`zero.tf`); every other glyph at its own advance. */
const tallyWidth = (text: string) =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        typeScale.tally.fontSize,
    0,
  );

const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  text.split(' ').every((word) => measure(word) <= room);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** Inside a half: the column less the side bar and the half's padding (space.md a side). */
const halfInner = (width: number) => column(width) - layout.padSideBar - 2 * space.md;
/** A plate (`SidePlate`): its word, padding space.sm a side and a hairline. */
const plateOf = (dictionary: Dictionary) =>
  Math.max(
    ...['white', 'black'].map((colour) =>
      plateWordWidth(said(dictionary, `scoring.chess.chip.${colour}`)),
    ),
  ) +
  2 * space.sm +
  2 * layout.iconBorder;
/** The names' room on a half's head: inside the half, less the plate and the gap before it. */
const namesRoom = (width: number, dictionary: Dictionary) =>
  halfInner(width) - plateOf(dictionary) - space.sm;

/** The sample names, as the fake types them, and a long one as an organiser might. */
const NAMES = ['A. Sharma', 'L. Chen'] as const;
const LONG = 'Alexandra Sharma-Williams';

/** The engine's two lists (`adjudication` is in both). */
const DECISIVE: readonly ChessMethod[] = [
  'checkmate',
  'resign',
  'time',
  'adjudication',
  'illegal_move',
];
const DRAWN: readonly ChessMethod[] = [
  'agreement',
  'stalemate',
  'insufficient',
  'adjudication',
  'repetition',
  'fifty_move',
  'dead_position',
];
const METHODS: readonly ChessMethod[] = [...new Set([...DECISIVE, ...DRAWN])];
const RUNGS = ['rapid', 'blitz', 'armageddon'] as const;

/** The widest of a language's rung words by `measure`: the line that carries one is the longest in that language. */
const widestRung = (dictionary: Dictionary, measure: (text: string) => number) =>
  RUNGS.map((rung) => said(dictionary, `scoring.chess.tiebreak.rung.${rung}`)).reduce((a, b) =>
    measure(b) > measure(a) ? b : a,
  );

describe('the header’s result line at 320 and 360', () => {
  /** What the tally has: the column less Back, Match details, History, the badge's slot and the four gaps (padFit.test.ts). */
  const tallyRoom = (width: number) =>
    column(width) - 3 * layout.iconButton - layout.padSyncBox - 4 * space.xs;
  const lineOf = (outcome: 'white' | 'draw' | 'black') =>
    chessResultLine(chessDisplay({ result: { outcome, method: null } }));

  it('has 72 and 112 dp, as the other pads’ tally does', () => {
    expect(WIDTHS.map(tallyRoom)).toEqual([72, 112]);
  });

  it.each(['white', 'draw', 'black'] as const)(
    'holds the %s result whole, clear of the badge’s slot by 8 dp, at 320 and 360',
    (outcome) => {
      for (const width of WIDTHS)
        expect(tallyWidth(lineOf(outcome)), `${width} ${lineOf(outcome)}`).toBeLessThanOrEqual(
          tallyRoom(width) - 8,
        );
    },
  );

  // Why a draw is a bare "½" in the header and not "½–½": at 46 dp the scoresheet's line is 81 dp, wider than the 72 the
  // row leaves at 320, and would push Match details and History off the screen. The halves say "½" under each name and
  // the strip says "Drawn", so nothing is lost.
  it('would not hold "½–½" at 320 (anti-vacuity): 81 dp of 72', () => {
    expect(tallyWidth('½–½').toFixed(0)).toBe('81');
    expect(tallyWidth('½–½')).toBeGreaterThan(tallyRoom(320));
    expect(tallyWidth('1–0')).toBeLessThanOrEqual(tallyRoom(320) - 8);
  });
});

describe('a half: the names beside the colour’s plate', () => {
  it('leaves the names 186, 169, 177 and 183 dp at 320 beside the plate, in en, es, fr and nl', () => {
    expect(LANGUAGES.map(([, dictionary]) => namesRoom(320, dictionary).toFixed(0))).toEqual([
      '186',
      '169',
      '177',
      '183',
    ]);
  });

  it.each(LANGUAGES)(
    '%s: holds the sample names and a long one in their two lines at 320 and 360, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const name of [...NAMES, LONG]) {
          const room = namesRoom(width, dictionary);
          expect(linesOf(name, room, nameWidth), `${width} ${name}`).toBeLessThanOrEqual(
            layout.padNameLines,
          );
          expect(wordsFit(name, room, nameWidth), `${width} ${name}`).toBe(true);
        }
    },
  );

  it('is one line of the plate’s word, inside the names’ two lines', () => {
    expect(typeScale.state.lineHeight + 2 * space.xs + 2 * layout.iconBorder).toBeLessThanOrEqual(
      layout.padNameLines * typeScale.label.lineHeight,
    );
  });

  it.each(LANGUAGES)(
    '%s: says what a tap records on one line at 320 and 360 for the sample names, either colour',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        for (const name of NAMES)
          for (const key of ['white', 'black', 'plain'] as const) {
            const action = fill(said(dictionary, `scoring.chess.result.${key}`), { name });
            expect(linesOf(action, halfInner(width), unitWidth), `${width} ${action}`).toBe(1);
          }
    },
  );
});

describe('the tool row: Draw and Swap colours, two cells', () => {
  /** A tool cell's text in a row of two: the row less its gap, shared, less the cell's padding and border (padFit.test.ts). */
  const toolText = (width: number) =>
    (column(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;

  it('leaves each cell’s text 122 dp at 320 and 142 at 360', () => {
    expect(WIDTHS.map(toolText)).toEqual([122, 142]);
  });

  it.each(LANGUAGES)(
    '%s: holds both labels in their two lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of ['scoring.chess.tool.draw', 'scoring.chess.tool.swap'])
        for (const width of WIDTHS) {
          const label = said(dictionary, key);
          expect(linesOf(label, toolText(width), toolWidth), `${width} ${key}`).toBeLessThanOrEqual(
            layout.padToolLines,
          );
          expect(wordsFit(label, toolText(width), toolWidth), `${width} ${key}`).toBe(true);
        }
    },
  );
});

describe('the Tie-break tile, the pad’s one tool while a tie-break is owed', () => {
  /** One cell takes the whole row: the column less the cell's padding and border (`ToolRow`). */
  const tileText = (width: number) => column(width) - 2 * space.sm - 2 * layout.iconBorder;

  it('leaves its text 270 dp at 320 and 310 at 360', () => {
    expect(WIDTHS.map(tileText)).toEqual([270, 310]);
  });

  it.each(LANGUAGES)(
    '%s: holds its label on one line, no word broken',
    (_lang, dictionary: Dictionary) => {
      const label = said(dictionary, 'scoring.chess.tiebreak.tool');
      for (const width of WIDTHS) {
        expect(linesOf(label, tileText(width), toolWidth), `${width}`).toBe(1);
        expect(wordsFit(label, tileText(width), toolWidth), `${width}`).toBe(true);
      }
    },
  );
});

describe('the strip’s one line', () => {
  // One slot takes the whole row (`PadStrip`): the column.
  const lines: readonly string[] = [
    'scoring.chess.waiting.tiebreak',
    'scoring.chess.forfeit',
    'scoring.chess.last.won',
    'scoring.chess.last.drawn',
  ];

  // The strip's one line is cut with an ellipsis past the row, and a font read slightly differently must not cut it: 8 dp clear.
  it.each(LANGUAGES)(
    '%s: holds each line on the strip’s one line at 320 and 360, 8 dp clear',
    (_lang, dictionary: Dictionary) => {
      for (const key of lines)
        for (const width of WIDTHS) {
          const text = fill(said(dictionary, key), { name: NAMES[0] });
          expect(linesOf(text, column(width), unitWidth), `${width} ${key}`).toBe(
            layout.padStripLines,
          );
          expect(unitWidth(text), `${width} ${key}`).toBeLessThanOrEqual(column(width) - 8);
        }
    },
  );

  // The winner's name is the organiser's as typed: a long one still takes the strip's one line in English and Dutch. Past the
  // row it is cut with an ellipsis, and the half's head and the last-tap line carry it whole.
  it('holds a long winner’s name on the strip’s one line in English and Dutch', () => {
    for (const [, dictionary] of [LANGUAGES[0], LANGUAGES[3]]) {
      const text = fill(said(dictionary, 'scoring.chess.last.won'), { name: LONG });
      expect(linesOf(text, column(320), unitWidth)).toBe(1);
    }
  });

  it('reads the four lines in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES)
      for (const key of lines) expect(said(dictionary, key)).not.toBe('');
  });

  // S2-3b: after a tie-break the strip names the player it sent through and the rung.
  const advancesLine = (dictionary: Dictionary, name: string, rung: (typeof RUNGS)[number]) =>
    fill(said(dictionary, 'scoring.chess.tiebreak.advances'), {
      name,
      how: said(dictionary, `scoring.chess.tiebreak.rung.${rung}`),
    });

  it.each(LANGUAGES)(
    '%s: holds "{name} advances · {rung}" for each rung on the one line at 320 and 360, 8 dp clear',
    (_lang, dictionary: Dictionary) => {
      for (const rung of RUNGS)
        for (const width of WIDTHS) {
          const text = advancesLine(dictionary, NAMES[0], rung);
          expect(linesOf(text, column(width), unitWidth), `${width} ${text}`).toBe(1);
          expect(unitWidth(text), `${width} ${text}`).toBeLessThanOrEqual(column(width) - 8);
        }
    },
  );

  // A long name is the organiser's as typed. The line is cut with an ellipsis past the row; the half's head carries the name
  // whole and the last-tap line says the rest. At 320 only Armageddon, the widest rung, outgrows the row, and only in English
  // and Dutch (298 dp of 288; French's 284 is within the row but not 8 dp clear of it); at 360 every one is whole.
  const longCuts = (width: number) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      RUNGS.filter(
        (rung) => linesOf(advancesLine(dictionary, LONG, rung), column(width), unitWidth) > 1,
      ).map((rung) => `${lang} ${rung}`),
    );

  it('cuts a long winner’s name on the strip only for Armageddon, in English and Dutch, at 320', () => {
    expect(longCuts(320)).toEqual(['en armageddon', 'nl armageddon']);
    expect(longCuts(360)).toEqual([]);
  });

  it('holds a long name whole in the other three rungs and languages at 320 (anti-vacuity)', () => {
    const fits = LANGUAGES.flatMap(([, dictionary]) =>
      RUNGS.map((rung) => unitWidth(advancesLine(dictionary, LONG, rung))),
    );
    expect(Math.max(...fits.filter((width) => width <= column(320)))).toBeGreaterThan(280);
    expect(fits.filter((width) => width > column(320))).toHaveLength(2);
  });

  // The Dutch sentence for a held game: it names the organiser, not a tie-break (design §3).
  it.each(LANGUAGES)(
    '%s: holds the held game’s line at its reworded length, 8 dp clear at 320',
    (_lang, dictionary: Dictionary) => {
      const text = said(dictionary, 'scoring.chess.waiting.tiebreak');
      expect(unitWidth(text)).toBeLessThanOrEqual(column(320) - 8);
    },
  );
});

describe('the last-tap line', () => {
  /** Beside Undo (GhostButton: its word, padding md a side, border) and the gap before it. */
  const lineRoom = (width: number, dictionary: Dictionary) =>
    column(width) -
    (controlWidth(said(dictionary, 'scoring.pad.undo')) + 2 * space.md + 2 * layout.iconBorder) -
    space.sm;

  /** The widest of a result's methods in this language: a win never names a drawn method, nor a draw a decisive one. */
  const widest = (dictionary: Dictionary, methods: readonly ChessMethod[]) =>
    methods
      .map((method) => said(dictionary, `scoring.chess.method.${method}`))
      .reduce((a, b) => (controlWidth(b) > controlWidth(a) ? b : a));

  /** Every sentence the line can say, with a name and the widest method of its kind; the undone line wraps the sentence it takes back. */
  const sentences = (dictionary: Dictionary) => {
    const won = fill(said(dictionary, 'scoring.chess.last.wonBy'), {
      name: NAMES[0],
      how: widest(dictionary, DECISIVE),
    });
    const drawn = fill(said(dictionary, 'scoring.chess.last.drawnBy'), {
      how: widest(dictionary, DRAWN),
    });
    const undone = (what: string) => fill(said(dictionary, 'scoring.chess.last.undone'), { what });
    // A tie-break names the player it sent through and the rung, the widest rung word of the language (S2-3b).
    const advances = fill(said(dictionary, 'scoring.chess.tiebreak.advances'), {
      name: NAMES[0],
      how: widestRung(dictionary, controlWidth),
    });
    return [
      ['start', said(dictionary, 'scoring.chess.last.start')],
      ['swap', said(dictionary, 'scoring.chess.last.swap')],
      ['won', fill(said(dictionary, 'scoring.chess.last.won'), { name: NAMES[0] })],
      ['wonBy', won],
      ['drawn', said(dictionary, 'scoring.chess.last.drawn')],
      ['drawnBy', drawn],
      ['undone wonBy', undone(won)],
      ['undone drawnBy', undone(drawn)],
      ['undone swap', undone(said(dictionary, 'scoring.chess.last.swap'))],
      ['advances', advances],
      ['undone advances', undone(advances)],
    ] as const;
  };

  const cut = (width: number, limit: number) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      sentences(dictionary)
        .filter(([, text]) => linesOf(text, lineRoom(width, dictionary), controlWidth) > limit)
        .map(([name]) => `${lang} ${name}`),
    );

  it('reads eleven sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary)).toHaveLength(11);
  });

  // Dutch's Undo ("Ongedaan maken") is the widest and leaves its sentence 129.5 dp at 320, as it does table tennis's: the
  // undone line, which wraps the sentence it takes back, takes four lines and is cut at three with an ellipsis. The words
  // before the colon are in the kept lines.
  it('holds every sentence whole in the line’s three lines at 360, in four languages', () => {
    expect(cut(360, layout.padLineLines)).toEqual([]);
  });

  // S2-3b: "Ongedaan gemaakt: A. Sharma gaat door · Armageddon" is four lines at 320, the same class as the two above, so it
  // is pinned with them rather than shortened: the verb leads, and the lines kept say what was undone.
  it('cuts only Dutch’s undone line after its third line at 320, the head kept', () => {
    expect(cut(320, layout.padLineLines)).toEqual([
      'nl undone wonBy',
      'nl undone drawnBy',
      'nl undone advances',
    ]);
    const [, text] = sentences(nl).find(([name]) => name === 'undone wonBy') ?? ['', ''];
    const kept = linesIn(text, lineRoom(320, nl), controlWidth).slice(0, layout.padLineLines);
    expect(kept.join(' ').startsWith('Ongedaan gemaakt:')).toBe(true);
  });

  // A note ("Counted once") sits under a sentence and leaves it one line fewer. As table tennis's, only Dutch outgrows
  // two lines, its Undo being the widest.
  it('cuts only Dutch’s undone line under a note at 360', () => {
    expect(cut(360, layout.padLineLines - 1)).toEqual(['nl undone drawnBy', 'nl undone advances']);
  });

  it('cuts only Dutch’s sentences under a note at 320: a draw by a method, and the undone lines', () => {
    expect(cut(320, layout.padLineLines - 1)).toEqual([
      'nl drawnBy',
      'nl undone wonBy',
      'nl undone drawnBy',
      'nl undone swap',
      'nl undone advances',
    ]);
  });

  // A long name in the tie-break sentence: three lines in every language at 360, and at 320 all but Dutch's Armageddon,
  // which is four and is cut at the third with the name's head kept. The half's head carries the name whole.
  it('holds a long winner’s name in the advances sentence in three lines at 360, and at 320 but for Dutch’s Armageddon', () => {
    const long = (width: number) =>
      LANGUAGES.flatMap(([lang, dictionary]) =>
        RUNGS.filter((rung) => {
          const text = fill(said(dictionary, 'scoring.chess.tiebreak.advances'), {
            name: LONG,
            how: said(dictionary, `scoring.chess.tiebreak.rung.${rung}`),
          });
          return linesOf(text, lineRoom(width, dictionary), controlWidth) > layout.padLineLines;
        }).map((rung) => `${lang} ${rung}`),
      );
    expect(long(360)).toEqual([]);
    expect(long(320)).toEqual(['nl armageddon']);
  });
});

describe('the sheet that asks How', () => {
  /** The sheet's padding is space.md a side (`padSheet`). */
  const inner = (width: number) => width - 2 * space.md;
  /** A chip's text: the sheet's inner width less the chip's padding (md a side) and border. */
  const chipText = (width: number) => inner(width) - 2 * space.md - 2 * layout.iconBorder;

  it.each(LANGUAGES)(
    '%s: holds the question, the longest name included, in its lines with no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of ['scoring.chess.how.won', 'scoring.chess.how.drawn'])
        for (const width of WIDTHS)
          for (const name of [...NAMES, LONG]) {
            const title = fill(said(dictionary, key), { name });
            expect(wordsFit(title, inner(width), titleWidth), `${width} ${title}`).toBe(true);
            expect(
              linesOf(title, inner(width), titleWidth),
              `${width} ${title}`,
            ).toBeLessThanOrEqual(3);
          }
    },
  );

  it.each(LANGUAGES)(
    '%s: holds every method in one chip line at 320 and 360',
    (_lang, dictionary: Dictionary) => {
      for (const method of METHODS)
        for (const width of WIDTHS) {
          const word = said(dictionary, `scoring.chess.method.${method}`);
          expect(linesOf(word, chipText(width), controlWidth), `${width} ${method}`).toBe(1);
        }
    },
  );

  it('reads the eleven methods in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES)
      expect(
        METHODS.map((method) => said(dictionary, `scoring.chess.method.${method}`)),
      ).toHaveLength(11);
  });

  it('lets the chips wrap onto lines of their own: the longest method is well under the room, the pair is not', () => {
    const [, dictionary] = LANGUAGES[0];
    const longest = Math.max(
      ...METHODS.map((method) => controlWidth(said(dictionary, `scoring.chess.method.${method}`))),
    );
    expect(longest).toBeLessThan(chipText(320));
    expect(2 * (longest + 2 * space.md + 2 * layout.iconBorder) + space.sm).toBeGreaterThan(
      inner(320),
    );
  });
});

describe('the tie-break sheet, every step', () => {
  /** The sheet's padding is space.md a side (`padSheet`). */
  const inner = (width: number) => width - 2 * space.md;
  /** A row or chip's text: the sheet's inner width less its padding (md a side) and border. */
  const rowText = (width: number) => inner(width) - 2 * space.md - 2 * layout.iconBorder;

  const TITLES = [
    'scoring.chess.tiebreak.rung.title',
    'scoring.chess.tiebreak.winner.title',
    'scoring.chess.tiebreak.score.title',
    'scoring.chess.tiebreak.black.title',
    'scoring.chess.tiebreak.result.title',
    'scoring.chess.tiebreak.confirm.title',
  ] as const;

  it.each(LANGUAGES)(
    '%s: holds each question in at most three lines at 320 and 360, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of TITLES)
        for (const width of WIDTHS) {
          const title = said(dictionary, key);
          expect(wordsFit(title, inner(width), titleWidth), `${width} ${key}`).toBe(true);
          expect(linesOf(title, inner(width), titleWidth), `${width} ${key}`).toBeLessThanOrEqual(
            3,
          );
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: holds each rung word on one row line',
    (_lang, dictionary: Dictionary) => {
      for (const rung of RUNGS)
        for (const width of WIDTHS)
          expect(
            linesOf(
              said(dictionary, `scoring.chess.tiebreak.rung.${rung}`),
              rowText(width),
              controlWidth,
            ),
            `${width} ${rung}`,
          ).toBe(1);
    },
  );

  // The names are the organiser's, in no language of ours: one row each, two lines at most (the long one is one at 320).
  it('holds the players’ names, the long one included, in a row of at most two lines (who won, who had Black)', () => {
    for (const width of WIDTHS)
      for (const name of [...NAMES, LONG]) {
        expect(linesOf(name, rowText(width), controlWidth), `${width} ${name}`).toBeLessThanOrEqual(
          2,
        );
        expect(wordsFit(name, rowText(width), controlWidth), `${width} ${name}`).toBe(true);
      }
  });

  // The Armageddon's result rows name the player holding each colour ("White won · L. Chen"), so a row is the colour's
  // sentence with the name filled in, and a draw says Black advances.
  it.each(LANGUAGES)(
    '%s: holds the three results, the long name included, in at most two lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const rows = (name: string) => [
        fill(said(dictionary, 'scoring.chess.result.white'), { name }),
        fill(said(dictionary, 'scoring.chess.result.black'), { name }),
        said(dictionary, 'scoring.chess.tiebreak.result.draw'),
      ];
      for (const width of WIDTHS)
        for (const name of [...NAMES, LONG])
          for (const row of rows(name)) {
            expect(
              linesOf(row, rowText(width), controlWidth),
              `${width} ${row}`,
            ).toBeLessThanOrEqual(2);
            expect(wordsFit(row, rowText(width), controlWidth), `${width} ${row}`).toBe(true);
          }
    },
  );

  it('wraps a result row onto a second line for a long name in French at 320 (anti-vacuity)', () => {
    const row = fill(said(fr, 'scoring.chess.result.white'), { name: LONG });
    expect(linesOf(row, rowText(320), controlWidth)).toBe(2);
  });

  // The score chips wrap as a group like How's methods; each is one line.
  it.each(LANGUAGES)(
    '%s: holds No score and the two scores each on one chip line',
    (_lang, dictionary: Dictionary) => {
      const chips = [
        said(dictionary, 'scoring.chess.tiebreak.score.none'),
        ...CHESS_TIEBREAK_SCORES,
      ];
      for (const width of WIDTHS)
        for (const chip of chips)
          expect(linesOf(chip, rowText(width), controlWidth), `${width} ${chip}`).toBe(1);
    },
  );

  // The line under the title: who advances (on the score step and the confirm), with the long name and the widest rung, and
  // the lots hint on the rung step. `body` is Geist 400 at 15.
  it.each(LANGUAGES)(
    '%s: holds who advances, the long name and the widest rung included, in at most three lines, and the lots hint in three',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS) {
        const advances = fill(said(dictionary, 'scoring.chess.tiebreak.advances'), {
          name: LONG,
          how: widestRung(dictionary, bodyWidth),
        });
        expect(
          linesOf(advances, inner(width), bodyWidth),
          `${width} ${advances}`,
        ).toBeLessThanOrEqual(3);
        const hint = said(dictionary, 'scoring.chess.tiebreak.lotsHint');
        expect(wordsFit(hint, inner(width), bodyWidth), `${width} ${hint}`).toBe(true);
        expect(linesOf(hint, inner(width), bodyWidth), `${width} ${hint}`).toBeLessThanOrEqual(3);
      }
    },
  );

  // A coarse height of the two tallest steps at 320, from the tokens and the lines above (not measured: how it sits over the
  // pad is the device check's). A sheet under 420 dp leaves the pad's top bar and header visible on the smallest phone (568 dp).
  it.each(LANGUAGES)(
    '%s: keeps the rung step and the score step under 420 dp at 320',
    (_lang, dictionary: Dictionary) => {
      const width = 320;
      const lines = (
        text: string,
        measure: (text: string) => number,
        room: number,
        lineHeight: number,
      ) => linesOf(text, room, measure) * lineHeight;
      const title = (key: string) =>
        lines(said(dictionary, key), titleWidth, inner(width), typeScale.title.lineHeight);
      const body = (text: string) =>
        lines(text, bodyWidth, inner(width), typeScale.body.lineHeight);
      const stack = (...parts: number[]) =>
        2 * space.md + parts.reduce((sum, part) => sum + part, 0) + (parts.length - 1) * space.sm;
      const rows = (count: number) => count * layout.touch + (count - 1) * space.sm;
      const rung = stack(
        title('scoring.chess.tiebreak.rung.title'),
        rows(3),
        body(said(dictionary, 'scoring.chess.tiebreak.lotsHint')),
        layout.touch,
      );
      const advances = fill(said(dictionary, 'scoring.chess.tiebreak.advances'), {
        name: LONG,
        how: widestRung(dictionary, bodyWidth),
      });
      // The three chips sit on one line here (the widest, No score, is under 110 dp) or wrap to two.
      const score = stack(
        title('scoring.chess.tiebreak.score.title'),
        body(advances),
        rows(2),
        56,
        layout.touch,
      );
      expect(Math.max(rung, score)).toBeLessThan(420);
    },
  );
});
