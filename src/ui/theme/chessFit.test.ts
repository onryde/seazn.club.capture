import { describe, expect, it } from 'vitest';
import { chessResultLine } from '@/domain/scoring/chessPad';
import type { ChessMethod } from '@/domain/scoring/chessTypes';
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
// colours, the strip's lines, the header's result line, the last-tap sentences, and the sheet that asks How. Whether real
// text stays inside on a phone is the device check's.

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

describe('the header’s result line at 320 and 360', () => {
  /** What the tally has: the column less Back, Match details, History, the badge's slot and the four gaps (padFit.test.ts). */
  const tallyRoom = (width: number) =>
    column(width) - 3 * layout.iconButton - layout.padSyncBox - 4 * space.xs;
  const lineOf = (outcome: 'white' | 'draw' | 'black') =>
    chessResultLine(chessDisplay({ result: { outcome, method: null, own: false } }));

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
    ] as const;
  };

  const cut = (width: number, limit: number) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      sentences(dictionary)
        .filter(([, text]) => linesOf(text, lineRoom(width, dictionary), controlWidth) > limit)
        .map(([name]) => `${lang} ${name}`),
    );

  it('reads nine sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary)).toHaveLength(9);
  });

  // Dutch's Undo ("Ongedaan maken") is the widest and leaves its sentence 129.5 dp at 320, as it does table tennis's: the
  // undone line, which wraps the sentence it takes back, takes four lines and is cut at three with an ellipsis. The words
  // before the colon are in the kept lines.
  it('holds every sentence whole in the line’s three lines at 360, in four languages', () => {
    expect(cut(360, layout.padLineLines)).toEqual([]);
  });

  it('cuts only Dutch’s undone line after its third line at 320, the head kept', () => {
    expect(cut(320, layout.padLineLines)).toEqual(['nl undone wonBy', 'nl undone drawnBy']);
    const [, text] = sentences(nl).find(([name]) => name === 'undone wonBy') ?? ['', ''];
    const kept = linesIn(text, lineRoom(320, nl), controlWidth).slice(0, layout.padLineLines);
    expect(kept.join(' ').startsWith('Ongedaan gemaakt:')).toBe(true);
  });

  // A note ("Counted once") sits under a sentence and leaves it one line fewer. As table tennis's, only Dutch outgrows
  // two lines, its Undo being the widest.
  it('cuts only Dutch’s undone line under a note at 360', () => {
    expect(cut(360, layout.padLineLines - 1)).toEqual(['nl undone drawnBy']);
  });

  it('cuts only Dutch’s sentences under a note at 320: a draw by a method, and the undone lines', () => {
    expect(cut(320, layout.padLineLines - 1)).toEqual([
      'nl drawnBy',
      'nl undone wonBy',
      'nl undone drawnBy',
      'nl undone swap',
    ]);
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
