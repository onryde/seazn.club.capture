import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// S2-7 Task 6: every `scoring.tennis.*` word at 320 and 360 dp in four languages, portrait only (so the orientation question
// does not apply). The rooms are written out from the token and type declarations and the kit's styles, the widths measured
// from the shipped fonts (`test/fontMetrics.ts`) and the copy read from the dictionaries: nothing is read from a component.
// `padFit.test.ts` is past 1500 lines, so tennis's sweep lives here (AGENTS §3), as volleyball's does. Whether real text stays
// inside on a phone is the device check's (exit item 5).

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
type Dictionary = Readonly<Record<string, string>>;
const WIDTHS = [320, 360] as const;
const TN = 'scoring.tennis';

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');

/** `actionSecondary`: a tool's label, Barlow Condensed 600 at 16, uppercase, letter-spaced. */
const toolWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.actionSecondary.fontSize) +
  typeScale.actionSecondary.letterSpacing * [...text].length;
/** `metricUnit`: Geist 500 at 12. The strip. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `control`: Geist 500 at 14. A half's foot. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `body`: Geist 400. A rules row. */
const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
/** `title`: a sheet's title, Barlow Condensed 700, uppercase, letter-spaced. */
const titleWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
/** `panelTitle`: the result card's title, Barlow Condensed 700 at 22, uppercase, letter-spaced. */
const panelWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.panelTitle.fontSize) +
  typeScale.panelTitle.letterSpacing * [...text].length;

const said = (dictionary: Dictionary, key: string) => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), text);
const words = (text: string) => text.split(' ');
/** Every word of the text fits the room: what wraps is never broken, and nothing overflows. */
const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  words(text).every((word) => measure(word) <= room);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** A tool cell's text in a row of four: the row less its gaps, shared equally, less the cell's padding and border. */
const toolRoom = (width: number) =>
  (column(width) - 3 * space.sm) / 4 - 2 * space.sm - 2 * layout.iconBorder;
/** A strip slot: the row less its gaps, shared equally by the strip's three slots (set, note, ends). */
const stripSlot = (width: number) => (column(width) - 2 * space.sm) / 3;
/** A strip of two (a default waiting, an ending): the note takes one of two slots. */
const stripHalf = (width: number) => (column(width) - space.sm) / 2;
/** Inside a half: the column less the side bar and the half's padding (space.md a side). */
const halfInner = (width: number) => column(width) - layout.padSideBar - 2 * space.md;
/** A step sheet's content: the screen less its padding. A choice's text: less its own padding and border. */
const sheet = (width: number) => width - 2 * space.md;
const choice = (width: number) => sheet(width) - 2 * space.md - 2 * layout.iconBorder;
/** The result card's text: the column less the card's padding and its edge. */
const cardRoom = (width: number) => column(width) - 2 * space.md - layout.padSideBar;

describe('tennis: the tool row at 320 and 360 in four languages', () => {
  const fits = (label: string, room: number) =>
    linesOf(label, room, toolWidth) <= layout.padToolLines && wordsFit(label, room, toolWidth);

  it('leaves each cell’s text 48 dp at 320 and 58 at 360 (a row of four)', () => {
    expect(WIDTHS.map(toolRoom)).toEqual([48, 58]);
  });

  it.each(LANGUAGES)(
    '%s: every drawn label (the short Violation and Award game, Break, Set score) in its lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const labels = ['tool.violationShort', 'tool.break', 'tool.awardShort', 'tool.setScore'].map(
        (key) => said(dictionary, `${TN}.${key}`),
      );
      for (const label of labels)
        for (const width of WIDTHS)
          expect(fits(label, toolRoom(width)), `${label} @${width}`).toBe(true);
    },
  );

  // Ruling 232: a label wider than its cell at 320 takes a short form with the full word said, and only then. The full words
  // are measured too, so the short form is never drawn where the full one fits, and where it is the same word it is the full.
  it.each(LANGUAGES)(
    '%s: the short form is drawn exactly where the full word does not fit a cell at 320',
    (_lang, dictionary: Dictionary) => {
      for (const [full, short] of [
        ['tool.violation', 'tool.violationShort'],
        ['tool.award', 'tool.awardShort'],
      ] as const) {
        const longWord = said(dictionary, `${TN}.${full}`);
        const drawn = said(dictionary, `${TN}.${short}`);
        expect(drawn === longWord, longWord).toBe(fits(longWord, toolRoom(320)));
      }
    },
  );

  // Anti-vacuity: the full Violation does not fit in any language but one that has a short word of its own, so the short
  // form is needed; the Dutch "Overtr." (51.5 dp) is wider than the 48 dp cell and "Overtr" (47.6, the owner's ruling 236) is not.
  it('would not hold the full Violation in a cell at 320 in any language, which is why every language has a short word', () => {
    for (const [lang, dictionary] of LANGUAGES)
      expect(fits(said(dictionary, `${TN}.tool.violation`), toolRoom(320)), lang).toBe(false);
    expect(fits('Overtr.', toolRoom(320))).toBe(false);
    expect(fits('Overtr', toolRoom(320))).toBe(true);
    expect(said(nl, `${TN}.tool.violationShort`)).toBe('Overtr');
  });

  // The Spanish and French "Infrac." fitted a 48 dp cell by 0.1 dp, and Android rounds to whole px (B2 review): "Infr." has room.
  it('draws "Infr." in Spanish and French, with at least 2 dp of margin in the 320 cell (the fit assertion kept)', () => {
    for (const dictionary of [es, fr]) {
      const drawn = said(dictionary, `${TN}.tool.violationShort`);
      expect(drawn).toBe('Infr.');
      expect(fits(drawn, toolRoom(320))).toBe(true);
      expect(toolRoom(320) - toolWidth(drawn)).toBeGreaterThanOrEqual(2);
    }
    expect(toolRoom(320) - toolWidth('Infrac.')).toBeLessThan(2);
  });

  it('would not hold the full Award game in French or Dutch, which is why they have a short word', () => {
    const wide = LANGUAGES.filter(
      ([, dictionary]) => !fits(said(dictionary, `${TN}.tool.award`), toolRoom(320)),
    ).map(([lang]) => lang);
    expect(wide).toEqual(['fr', 'nl']);
  });
});

describe('tennis: the strip at 320 and 360 in four languages', () => {
  const facts = (dictionary: Dictionary) => [
    fill(said(dictionary, `${TN}.setOf`), { set: '5', bestOf: '5' }),
    said(dictionary, `${TN}.breaker.tiebreak`),
    said(dictionary, `${TN}.breaker.matchTiebreak`),
    said(dictionary, `${TN}.note.deuce`),
    said(dictionary, `${TN}.note.decidingPoint`),
    said(dictionary, `${TN}.endsChange`),
  ];

  it('is 90.67 dp a slot at 320 and 104 at 360', () => {
    expect(WIDTHS.map((width) => stripSlot(width).toFixed(2))).toEqual(['90.67', '104.00']);
  });

  it.each(LANGUAGES)(
    '%s: each fact on one line in its slot, at both widths',
    (_lang, dictionary: Dictionary) => {
      for (const fact of facts(dictionary))
        for (const width of WIDTHS)
          expect(linesOf(fact, stripSlot(width), unitWidth), `${fact} @${width}`).toBe(
            layout.padStripLines,
          );
    },
  );

  // A default waiting, or an ending, takes the two slots' room for itself: two lines, no word broken, with the longest
  // staging name the organiser can type on the side (the cut is an ellipsis, never a broken word).
  const SAID_LINES = 2;
  const LONG = 'Springfield Tennis Club';
  it.each(LANGUAGES)(
    '%s: the waiting default and every ending in two lines of a two-slot strip, no word broken, inside the strip’s reserved height',
    (_lang, dictionary: Dictionary) => {
      const word = (kind: string) => said(dictionary, `${TN}.ending.${kind}`);
      const texts = [
        said(dictionary, `${TN}.endingPending`),
        ...['retired', 'defaulted', 'walkover', 'withdrew', 'abandoned'].map(word),
        ...['retired', 'defaulted', 'walkover', 'withdrew'].map((kind) =>
          fill(said(dictionary, `${TN}.ending.by`), { ending: word(kind), side: LONG }),
        ),
      ];
      for (const text of texts)
        for (const width of WIDTHS) {
          expect(wordsFit(text, stripHalf(width), unitWidth), `${text} @${width}`).toBe(true);
          expect(
            linesOf(text, stripHalf(width), unitWidth),
            `${text} @${width}`,
          ).toBeLessThanOrEqual(SAID_LINES);
          // The reserved height: SAID_LINES strip lines, one line of which the strip always holds.
          expect(
            linesOf(text, stripHalf(width), unitWidth) * typeScale.metricUnit.lineHeight,
            `${text} @${width}`,
          ).toBeLessThanOrEqual(SAID_LINES * typeScale.metricUnit.lineHeight);
        }
    },
  );
});

describe('tennis: the serve plate at 320 and 360 in four languages', () => {
  const plateWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;

  // The plate shares a half's head with the names: it takes at most two fifths of the inner width (volleyball ships the same words), with its padding.
  it.each(LANGUAGES)(
    '%s: "Serving" in two fifths of a half’s head',
    (lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(
          plateWidth(said(dictionary, `${TN}.serving`)) + 2 * space.sm,
          `${lang} @${width}`,
        ).toBeLessThanOrEqual((halfInner(width) * 2) / 5);
    },
  );
});

describe('tennis: a half’s foot at 320 and 360 in four languages', () => {
  // "Games 12" at its widest (a set score's bound, 12 games), in the bottom row's slot beside "Tap": the half's inner width,
  // less a gap on each side and the kit's word Tap.
  const foot = (dictionary: Dictionary) =>
    fill(said(dictionary, `${TN}.foot.games`), { games: '12' });

  it.each(LANGUAGES)('%s: the foot is never cut beside Tap', (lang, dictionary: Dictionary) => {
    const tap = unitWidth(said(dictionary, 'scoring.pad.tap'));
    for (const width of WIDTHS)
      expect(controlWidth(foot(dictionary)), `${lang} @${width}`).toBeLessThanOrEqual(
        halfInner(width) - 2 * space.sm - tap,
      );
  });
});

describe('tennis: the rules rows and the result card at 320 and 360 in four languages', () => {
  const ROOMS = {
    card: (width: number) => column(width) - 2 * space.md - layout.padSideBar,
    sheet: (width: number) => width - 2 * space.md,
    start: (width: number) => column(width),
  } as const;
  /** Every row at its widest: a Grand Slam's, in double digits. */
  const rows = (dictionary: Dictionary) => {
    const at = { at: '12', to: '10' };
    return [
      ['format.label', 'bestOf', { bestOf: '5' }],
      ['set.label', 'gamesTo', { gamesTo: '12' }],
      ['tiebreak.label', 'tiebreakAt', at],
      ['tiebreak.label', 'noTiebreak', {}],
      ['game.label', 'noAd', {}],
      ['finalSet.label', 'finalTiebreak', at],
      ['finalSet.label', 'finalMatchTiebreak', { to: '10' }],
    ].map(([label, value, vars]) => ({
      label: said(dictionary, `${TN}.rules.${String(label)}`),
      value: fill(said(dictionary, `${TN}.rules.${String(value)}`), vars as Record<string, string>),
    }));
  };
  const labelColumn = (labels: readonly string[]) =>
    Math.min(Math.ceil(Math.max(...labels.map(bodyWidth))), layout.padRuleLabelMax);

  it.each(LANGUAGES)(
    '%s: no rule label or value has a word wider than its room, in the card, the sheet and the Start screen',
    (_lang, dictionary: Dictionary) => {
      const table = rows(dictionary);
      const labels = table.map((row) => row.label);
      const column = labelColumn(labels);
      for (const width of WIDTHS)
        for (const room of Object.values(ROOMS).map((of) => of(width)))
          for (const { label, value } of table) {
            expect(wordsFit(label, column, bodyWidth), label).toBe(true);
            expect(wordsFit(value, room - column - space.md, bodyWidth), value).toBe(true);
          }
    },
  );

  it.each(LANGUAGES)(
    '%s: the result title keeps every word whole with the longest name and five sets with tie-breaks',
    (_lang, dictionary: Dictionary) => {
      const sets = '7–6(5) 6–7(10) 7–6(12) 6–7(5) [10–8]';
      const titles = [
        fill(said(dictionary, `${TN}.result`), { side: 'Springfield Tennis Club', sets }),
        ...['retired', 'defaulted', 'walkover', 'withdrew'].map((kind) =>
          fill(said(dictionary, `${TN}.ending.by`), {
            ending: said(dictionary, `${TN}.ending.${kind}`),
            side: 'Springfield Tennis Club',
          }),
        ),
      ];
      for (const title of titles)
        for (const width of WIDTHS)
          expect(wordsFit(title, cardRoom(width), panelWidth), `${title} @${width}`).toBe(true);
    },
  );

  it.each(LANGUAGES)(
    '%s: "Players ready?" in the Start screen’s column',
    (_lang, dictionary: Dictionary) => {
      for (const width of WIDTHS)
        expect(wordsFit(said(dictionary, `${TN}.start.ask`), column(width), panelWidth)).toBe(true);
    },
  );
});

describe('tennis: the violation, award and break sheets at 320 and 360 in four languages', () => {
  const SIDES = ['Ana Ruiz', 'Springfield Tennis Club', 'Ruiz / Vega h1 / Ruiz / Vega h2'] as const;
  const kinds = ['medical', 'toilet', 'heat', 'other'] as const;
  const levels = ['warning', 'pointPenalty', 'gamePenalty'] as const;

  it.each(LANGUAGES)(
    '%s: each sheet’s title in at most two lines, no word wider than the sheet',
    (_lang, dictionary: Dictionary) => {
      const titles = [
        'violation.title',
        'violation.who',
        'violation.confirm.title',
        'award.title',
        'award.confirm.title',
        'break.title',
        ...kinds.map((kind) => `break.kind.${kind}`),
      ].map((key) => said(dictionary, `${TN}.${key}`));
      for (const title of titles)
        for (const width of WIDTHS) {
          expect(wordsFit(title, sheet(width), titleWidth), `${title} @${width}`).toBe(true);
          expect(
            linesOf(title, sheet(width), titleWidth),
            `${title} @${width}`,
          ).toBeLessThanOrEqual(2);
        }
    },
  );

  it.each(LANGUAGES)(
    '%s: each choice, no word wider than a choice’s text, and a long side in at most two lines',
    (_lang, dictionary: Dictionary) => {
      const texts = [
        ...levels.map((level) => said(dictionary, `${TN}.level.${level}`)),
        ...kinds.map((kind) => said(dictionary, `${TN}.break.kind.${kind}`)),
        said(dictionary, `${TN}.break.both`),
        said(dictionary, `${TN}.violation.confirm.action`),
        said(dictionary, `${TN}.award.confirm.action`),
        ...SIDES,
      ];
      for (const text of texts)
        for (const width of WIDTHS)
          expect(wordsFit(text, choice(width), controlWidth), `${text} @${width}`).toBe(true);
      for (const side of SIDES)
        for (const width of WIDTHS)
          expect(
            linesOf(side, choice(width), controlWidth),
            `${side} @${width}`,
          ).toBeLessThanOrEqual(2);
    },
  );

  // The sentences a step says in the body role: wrapping at spaces, never broken, in at most four lines.
  it.each(LANGUAGES)(
    '%s: the questions, the confirm lines and the done lines in at most four lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      const side = SIDES[2];
      const lines = [
        said(dictionary, `${TN}.award.ask`),
        said(dictionary, `${TN}.break.askKind`),
        said(dictionary, `${TN}.break.askSide`),
        fill(said(dictionary, `${TN}.award.confirm.body`), { side }),
        fill(said(dictionary, `${TN}.violation.confirm.body`), {
          level: said(dictionary, `${TN}.level.gamePenalty`),
          who: side,
        }),
        fill(said(dictionary, `${TN}.violation.done.point`), { other: side }),
        fill(said(dictionary, `${TN}.violation.done.game`), { other: side }),
        said(dictionary, `${TN}.violation.done.breaker`),
      ];
      for (const text of lines)
        for (const width of WIDTHS) {
          expect(wordsFit(text, sheet(width), bodyWidth), `${text} @${width}`).toBe(true);
          expect(linesOf(text, sheet(width), bodyWidth), `${text} @${width}`).toBeLessThanOrEqual(
            4,
          );
        }
    },
  );
});

describe('tennis: History’s rows and the last-tap line at 320 and 360 in four languages', () => {
  // As volleyball's: a row's sentence takes the column less the right column, in at most `padHistoryLines`.
  const room = (width: number) => column(width) - space.sm - layout.padHistorySide;
  const SIDES = ['Ana Ruiz', 'Ruiz / Vega', 'Springfield Tennis Club'] as const;
  const sentences = (dictionary: Dictionary, side: string) => {
    const longest = (keys: readonly string[]) =>
      keys
        .map((key) => said(dictionary, `${TN}.${key}`))
        .reduce((a, b) => (controlWidth(b) > controlWidth(a) ? b : a));
    const vars = {
      side,
      person: 'Ruiz / Vega h2',
      level: longest(['level.warning', 'level.pointPenalty', 'level.gamePenalty', 'level.default']),
      kind: longest([
        'break.kind.medical',
        'break.kind.toilet',
        'break.kind.heat',
        'break.kind.other',
      ]),
      set: '5',
      score: '7–6(10)',
    };
    return Object.keys(dictionary)
      .filter((key) => key.startsWith(`${TN}.last.`) || key.startsWith(`${TN}.undone.`))
      .map((key) => ({ key, text: fill(said(dictionary, key), vars) }));
  };

  it('reads the last-tap vocabulary (anti-vacuity): ten last and five undone', () => {
    for (const [, dictionary] of LANGUAGES)
      expect(sentences(dictionary, 'Ana Ruiz')).toHaveLength(15);
  });

  it.each(LANGUAGES)(
    '%s: every sentence in the two lines of a History row, no word broken, for a player, a pair and a club',
    (lang, dictionary: Dictionary) => {
      for (const side of SIDES)
        for (const { key, text } of sentences(dictionary, side))
          for (const width of WIDTHS) {
            expect(
              linesOf(text, room(width), controlWidth),
              `${lang} ${key} ${side} @${width}`,
            ).toBeLessThanOrEqual(layout.padHistoryLines);
            expect(wordsFit(text, room(width), controlWidth), `${key} @${width}`).toBe(true);
          }
    },
  );

  const headingWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;

  it.each(LANGUAGES)(
    '%s: "Set 5" on one line in the cover’s column',
    (_lang, dictionary: Dictionary) => {
      const heading = fill(said(dictionary, `${TN}.setHeading`), { set: '5' });
      for (const width of WIDTHS) expect(linesOf(heading, column(width), headingWidth)).toBe(1);
    },
  );
});

describe('tennis: Set score’s sheet at 320 and 360 in four languages', () => {
  // The score sheet's title is the sheet's title role; a field's label shares its row with the two-touch-wide input.
  const field = (width: number) => sheet(width) - 2 * layout.touch - space.sm;
  const SIDES = ['Ana Ruiz', 'Springfield Tennis Club', 'Ruiz / Vega h1 / Ruiz / Vega h2'] as const;

  it.each(LANGUAGES)(
    '%s: the title in at most two lines, no word wider than the sheet',
    (_lang, dictionary: Dictionary) => {
      const title = fill(said(dictionary, `${TN}.setScore.title`), { set: '5' });
      for (const width of WIDTHS) {
        expect(wordsFit(title, sheet(width), titleWidth), `${title} @${width}`).toBe(true);
        expect(linesOf(title, sheet(width), titleWidth), `${title} @${width}`).toBeLessThanOrEqual(
          2,
        );
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: each field’s label, with the longest side, in at most three lines, no word broken',
    (_lang, dictionary: Dictionary) => {
      for (const key of ['games', 'tiebreak'])
        for (const side of SIDES)
          for (const width of WIDTHS) {
            const label = fill(said(dictionary, `${TN}.setScore.${key}`), { side });
            expect(wordsFit(label, field(width), controlWidth), `${label} @${width}`).toBe(true);
            expect(
              linesOf(label, field(width), controlWidth),
              `${label} @${width}`,
            ).toBeLessThanOrEqual(3);
          }
    },
  );
});

describe('tennis: every word it has is measured here (the sweep)', () => {
  // A key added to the dictionary must be named by a group above or below: a dead or unmeasured word fails here.
  const MEASURED: readonly RegExp[] = [
    /^tool\./,
    /^setOf$/,
    /^breaker\./,
    /^note\./,
    /^endsChange$/,
    /^endingPending$/,
    /^foot\.games$/,
    /^rules\./,
    /^ending\./,
    /^result$/,
    /^start\.ask$/,
    /^violation\./,
    /^award\./,
    /^break\./,
    /^last\./,
    /^undone\./,
    /^setHeading$/,
    /^setScore\./,
  ];
  /** Words the fit tests do not measure, each with the reason. */
  const ELSEWHERE: Readonly<Record<string, string>> = {
    hint: 'the half’s spoken hint: never drawn (the kit draws the word Tap)',
    serving: 'the plate’s word: the serve plate group above',
    setsTally: 'said to a screen reader only',
    'foot.gamesSaid': 'said to a screen reader only',
    'level.warning':
      'a level’s word: a screen reader, and the violation sheet’s choices (measured with the sheets)',
    'level.pointPenalty':
      'a level’s word: a screen reader, and the violation sheet’s choices (measured with the sheets)',
    'level.gamePenalty':
      'a level’s word: a screen reader, and the violation sheet’s choices (measured with the sheets)',
    'level.default':
      'a level’s word: a screen reader, and History’s sentences (measured with the History group)',
    player: 'a word standing for a name: measured inside the History sentences through the names',
  };

  it('every scoring.tennis key is in a measured group or has its reason', () => {
    const unowned = Object.keys(en)
      .filter((key) => key.startsWith(`${TN}.`))
      .map((key) => key.slice(TN.length + 1))
      .filter((key) => !MEASURED.some((pattern) => pattern.test(key)) && !(key in ELSEWHERE));
    expect(unowned).toEqual([]);
  });

  it('names no key the dictionary lacks', () => {
    for (const key of Object.keys(ELSEWHERE))
      expect(Object.keys(en), key).toContain(`${TN}.${key}`);
  });
});
