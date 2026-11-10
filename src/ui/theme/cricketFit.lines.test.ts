import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { linesIn, linesOf } from '../../../test/textFit';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import {
  CHASE,
  Dictionary,
  LANGUAGES,
  OVERS,
  PERSON,
  RESULT_KEYS,
  SCORE,
  SPELL,
  TEAM_TWELVE,
  THIRTY,
  TWELVE,
  WIDTHS,
  barlow700,
  bodyOf,
  buttonBox,
  capsOf,
  column,
  controlWidth,
  cricketKeys,
  figuresWidth,
  fill,
  geist400,
  ghostBox,
  labelWidth,
  ownsKey,
  reader,
  statusOf,
  unitWidth,
  unmeasured,
  wordsFit,
} from './cricketFitKit';

// S2-4 fit tests, the lines (plan Task 18): the setup steps, Match details, the last-tap line, History sentences, the result and
// break lines, the scorecard and the result board.

const { said, swept } = reader();

// ---------------------------------------------------------------------------------------------------------------
// S2-4 plan Task 18: the rest of the strings, at 320 and 360 dp in four languages, then the sweep that asks for every key.
// Rooms are written out from the components' styles (never read from them). A text that wraps is held to the lines the
// design allows and to every word whole: a word wider than its room is the failure. What is cut with an ellipsis (the
// last-tap line at three lines, a History sentence at two) is cut on the phone, so each such sentence is measured and the
// ones that run over at 320 are listed literally.
// ---------------------------------------------------------------------------------------------------------------

describe.each(WIDTHS)('the setup steps and the bowler step’s foot at %i dp', (width) => {
  const read = (dictionary: Dictionary, key: string) =>
    said(dictionary, `scoring.cricket.setup.${key}`);
  const startKeys = ['scoring.cricket.setup.startInnings', 'scoring.start.confirm'] as const;

  // The order step's foot is More (a break) beside Next, the bowler step's Back (or More) beside the start button, in one
  // wrapping row (`styles.pair`): a button that does not fit beside the ghost goes under it and takes the row. With both
  // Back and More the two share a row above the start button (Task 16 concern 3). So each piece must fit a row alone.
  it.each(LANGUAGES)(
    '%s: each foot button fits a row alone, so a wrapped pair is two whole rows',
    (_, dictionary) => {
      const ghosts = [read(dictionary, 'back'), said(dictionary, 'scoring.cricket.key.more')];
      const buttons = [read(dictionary, 'next'), ...startKeys.map((key) => said(dictionary, key))];
      for (const ghost of ghosts) expect(ghostBox(ghost), ghost).toBeLessThanOrEqual(column(width));
      for (const button of buttons)
        expect(buttonBox(button), button).toBeLessThanOrEqual(column(width));
    },
  );

  it.each(LANGUAGES)(
    '%s: two ghost buttons side by side are a half-row each, the start button a row of its own',
    (_, dictionary) => {
      const half = (column(width) - space.sm) / 2;
      for (const word of [read(dictionary, 'back'), said(dictionary, 'scoring.cricket.key.more')])
        expect(ghostBox(word), word).toBeLessThanOrEqual(half);
      for (const key of startKeys)
        expect(buttonBox(said(dictionary, key)), key).toBeLessThanOrEqual(column(width));
    },
  );

  // Anti-vacuity: the three in one row did not fit, which is why the foot stacks them (English is the shortest).
  it('Back, More and Start innings in one row would not fit (English, the shortest words)', () => {
    const row =
      ghostBox(read(en, 'back')) +
      ghostBox(said(en, 'scoring.cricket.key.more')) +
      buttonBox(read(en, 'startInnings')) +
      2 * space.sm;
    expect(row).toBeGreaterThan(column(width));
  });

  it.each(LANGUAGES)(
    '%s: the order and bowler headings keep every word whole in three lines with a thirty-character club',
    (_, dictionary) => {
      for (const key of ['order', 'bowler']) {
        const heading = fill(read(dictionary, key), { team: THIRTY });
        expect(wordsFit(heading, column(width), capsOf('panelTitle')), heading).toBe(true);
        expect(linesOf(heading, column(width), capsOf('panelTitle')), heading).toBeLessThanOrEqual(
          3,
        );
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: the hint is two lines at most and the openers line keeps every word whole',
    (_, dictionary) => {
      const hint = read(dictionary, 'orderHint');
      expect(linesOf(hint, column(width), bodyOf), hint).toBeLessThanOrEqual(2);
      const openers = fill(read(dictionary, 'openers'), { striker: PERSON, nonStriker: PERSON });
      expect(wordsFit(openers, column(width), bodyOf), openers).toBe(true);
      expect(linesOf(openers, column(width), bodyOf), openers).toBeLessThanOrEqual(3);
    },
  );

  it.each(LANGUAGES)('%s: Record (a typed number) is one line in its button', (_, dictionary) => {
    const label = said(dictionary, 'scoring.cricket.entry.record');
    expect(linesOf(label, column(width) - 2 * space.xl, capsOf('action')), label).toBe(1);
  });

  // The ▲▼ names and the tally are read, never drawn: they carry their fill in the dictionary's own place.
  it.each(LANGUAGES)('%s: the spoken labels carry their fill', (_, dictionary) => {
    for (const key of ['up', 'down']) expect(read(dictionary, key)).toContain('{name}');
    expect(said(dictionary, 'scoring.cricket.tallySaid')).toContain('{score}');
    expect(said(dictionary, 'scoring.cricket.tallyNone')).not.toBe('');
  });
});

// Anti-vacuity: at 320 a ghost button and "Start innings" do not share a row in any language, so the wrap above is real.
it.each(LANGUAGES)(
  '%s: Back beside Start innings would not fit one row at 320',
  (_, dictionary) => {
    const pair =
      ghostBox(said(dictionary, 'scoring.cricket.setup.back')) +
      space.sm +
      buttonBox(said(dictionary, 'scoring.cricket.setup.startInnings'));
    expect(pair).toBeGreaterThan(column(320));
  },
);

it('the order step’s hint takes a second line in some language at 320 (anti-vacuity: two lines are used)', () => {
  const most = Math.max(
    ...LANGUAGES.map(([, dictionary]) =>
      linesOf(said(dictionary, 'scoring.cricket.setup.orderHint'), column(320), bodyOf),
    ),
  );
  expect(most).toBe(2);
});

// Match details' rules table (`MatchCard`, in the sheet): a label column, at most `padRuleLabelMax`, then the value in
// what is left, both at `body`, wrapping. Every word must fit; the label column is the widest label's.
const RULE_ROWS = [
  ['overs', { overs: '50' }, 'value'],
  ['over', { balls: '8' }, 'value'],
  ['players', { players: '11' }, 'value'],
  ['bowler', { count: '10' }, 'value.other'],
  ['superOver', {}, 'on'],
  ['followOn', { lead: '999' }, 'value'],
  ['reviews', { reviews: '3' }, 'value'],
] as const;

describe.each(WIDTHS)('Match details’ rules at %i dp', (width) => {
  const valueKeys = (dictionary: Dictionary) => [
    ...RULE_ROWS.map(([row, vars, value]) =>
      fill(said(dictionary, `scoring.cricket.rules.${row}.${value}`), vars),
    ),
    fill(said(dictionary, 'scoring.cricket.rules.bowler.value.one'), { count: '1' }),
    said(dictionary, 'scoring.cricket.rules.overs.unlimited'),
    said(dictionary, 'scoring.cricket.rules.bowler.none'),
    said(dictionary, 'scoring.cricket.rules.superOver.off'),
  ];
  const labelsOf = (dictionary: Dictionary) =>
    RULE_ROWS.map(([row]) => said(dictionary, `scoring.cricket.rules.${row}.label`));

  it.each(LANGUAGES)(
    '%s: every label and value keeps its words whole in the card’s columns',
    (_, dictionary) => {
      const labels = labelsOf(dictionary);
      const labelColumn = Math.min(
        Math.ceil(Math.max(...labels.map(bodyOf))),
        layout.padRuleLabelMax,
      );
      const valueRoom = column(width) - labelColumn - space.md;
      for (const label of labels) {
        expect(wordsFit(label, labelColumn, bodyOf), label).toBe(true);
        expect(linesOf(label, labelColumn, bodyOf), label).toBeLessThanOrEqual(2);
      }
      for (const value of valueKeys(dictionary)) {
        expect(wordsFit(value, valueRoom, bodyOf), value).toBe(true);
        expect(linesOf(value, valueRoom, bodyOf), value).toBeLessThanOrEqual(2);
      }
    },
  );
});

// The last-tap line (three lines of `control` beside Undo) and a History row's sentence (what the right column leaves).
// The last-tap line is cut with an ellipsis, the head kept (the pattern of padFit's last-tap case), so each sentence is
// measured at its widest realistic fill: a club of thirty characters at the toss, short names for the rest and a ball with
// every part. A History row is not cut (controller's ruling, 2026-11-09, S2-4 Task 18 fix round): cricket's rows wrap with
// no line cap (`MatchHistory` `uncapped`), so the tests below hold that every word of every sentence fits the room, whole,
// and pin what the kit's two-line cap would have cut, as anti-vacuity. A name of 26 characters is held to its own test.
describe('the last-tap line and History sentences', () => {
  const lineRoom = (width: number, dictionary: Dictionary) =>
    column(width) - ghostBox(said(dictionary, 'scoring.pad.undo')) - space.sm;
  const historyRoom = (width: number) => column(width) - space.sm - layout.padHistorySide;
  const BALL_KINDS = ['wide', 'noball', 'bye', 'legbye', 'penalty'] as const;

  type Who = {
    readonly batter: string;
    readonly person: string;
    readonly assist: string;
    readonly fielder: string;
  };
  /** The widest a roster usually goes: initial and surname. */
  const USUAL: Who = {
    batter: 'A. Sharma',
    person: 'A. Sharma',
    assist: 'R. Iyer',
    fielder: 'A. Sharma',
  };
  /** The longest name a team sheet can hold, as the batter and the one the sentence is about (the fielders stay usual). */
  const LONGEST: Who = { ...USUAL, batter: PERSON, person: PERSON };

  /** One text per key, each at its widest fill, keyed by what the sentence is. */
  const sentences = (dictionary: Dictionary, who: Who): readonly (readonly [string, string])[] => {
    const at = (key: string, vars: Readonly<Record<string, string | number>> = {}) =>
      fill(said(dictionary, key), vars);
    const how = said(dictionary, 'scoring.cricket.out.kind.runout');
    const caught = at('scoring.cricket.out.fielder', {
      how: said(dictionary, 'scoring.cricket.out.kind.caught'),
      fielder: who.fielder,
    });
    const runout = at('scoring.cricket.out.fielders', {
      how,
      assist: who.assist,
      fielder: who.fielder,
    });
    const dismissal = at('scoring.cricket.out', { batter: who.batter, how: runout });
    const extra = at('scoring.cricket.ball.noball.other', { count: 5 });
    const runs = at('scoring.cricket.ball.runs.other', { count: 6 });
    const and = (first: string, second: string) =>
      at('scoring.cricket.ball.and', { first, second });
    const ball = and(and(extra, runs), dismissal);
    return [
      ['toss bat', at('scoring.cricket.last.toss.bat', { name: THIRTY })],
      ['toss bowl', at('scoring.cricket.last.toss.bowl', { name: THIRTY })],
      ['start', at('scoring.cricket.last.start')],
      ['summary', at('scoring.cricket.last.summary', { runs: 999, wickets: 10, overs: '189.5' })],
      ['retire hurt', at('scoring.cricket.last.retire.hurt', { name: who.person })],
      ['retire out', at('scoring.cricket.last.retire.out', { name: who.person })],
      ['retire', at('scoring.cricket.last.retire.plain', { name: who.person })],
      ['bowler', at('scoring.cricket.last.bowlerChange', { name: who.person })],
      ['dot', at('scoring.cricket.ball.dot')],
      ['four', at('scoring.cricket.ball.four')],
      ['six', at('scoring.cricket.ball.six')],
      ['one run', at('scoring.cricket.ball.runs.one', { count: 1 })],
      ...BALL_KINDS.flatMap((kind): (readonly [string, string])[] => [
        [`${kind} one`, at(`scoring.cricket.ball.${kind}.one`, { count: 1 })],
        [`${kind} many`, at(`scoring.cricket.ball.${kind}.other`, { count: 5 })],
      ]),
      ['caught', at('scoring.cricket.out', { batter: who.batter, how: caught })],
      ['run out', dismissal],
      ['a whole ball', ball],
      ['undone ball', at('scoring.cricket.last.undone', { what: ball })],
      ...Object.keys(dictionary)
        .filter((key) => key.startsWith('scoring.cricket.event.'))
        .map((key): readonly [string, string] => [key, at(key)]),
    ];
  };

  // Eight at the toss, a retirement and a bowler's change, four runs-or-dot words, ten extras (five kinds, one and many),
  // four ball sentences and twenty-six events (`scoring.cricket.event.*`).
  it('reads fifty-two sentences in each language (anti-vacuity)', () => {
    for (const [, dictionary] of LANGUAGES) expect(sentences(dictionary, USUAL)).toHaveLength(52);
  });

  /** The two sentences that join every part of a ball; every other sentence is one clause. */
  const COMPOSITE = ['a whole ball', 'undone ball'];
  /** History shows a tap's own sentence; "Undone" is a word in the row's right column, so the undone wrapper is the last-tap line's alone. */
  const IN_HISTORY = (name: string) => name !== 'undone ball';

  const over = (
    limit: number,
    room: (width: number, dictionary: Dictionary) => number,
    width: number,
    only: (name: string) => boolean,
  ) =>
    LANGUAGES.flatMap(([lang, dictionary]) =>
      sentences(dictionary, USUAL)
        .filter(
          ([name, text]) =>
            only(name) && linesOf(text, room(width, dictionary), controlWidth) > limit,
        )
        .map(([name]) => `${lang} ${name}`),
    );
  const single = (name: string) => !COMPOSITE.includes(name);
  const composite = (name: string) => COMPOSITE.includes(name);

  it('the last-tap line holds every one-clause sentence in its three lines at 360 and 320', () => {
    expect(over(layout.padLineLines, lineRoom, 360, single)).toEqual([]);
    expect(over(layout.padLineLines, lineRoom, 320, single)).toEqual([]);
  });

  // What the kit's two-line cap (`layout.padHistoryLines`, still the other sports' rule) would have cut in a History row.
  // Cricket's rows have no cap, so none of these is cut; the list says what the wrapping is doing. The toss with a club of
  // thirty characters: at 320 the English and Spanish sentences run to a third line (the row gives 192 dp beside the
  // score). Spanish and English are the owner's words and are not shortened here; French and Dutch were (Task 18).
  it('a History row would have cut, under the kit’s two-line cap, the toss at 320 and nothing else of one clause', () => {
    expect(over(layout.padHistoryLines, historyRoom, 360, single)).toEqual([]);
    expect(over(layout.padHistoryLines, historyRoom, 320, single)).toEqual([
      'en toss bat',
      'en toss bowl',
      'es toss bat',
      'es toss bowl',
    ]);
  });

  it('shows the whole club in a History row: the toss takes a third line at 320 rather than losing it', () => {
    for (const [, dictionary] of [LANGUAGES[0], LANGUAGES[1]]) {
      for (const [name, text] of sentences(dictionary, USUAL).filter(([n]) =>
        n.startsWith('toss'),
      )) {
        const lines = linesIn(text, historyRoom(320), controlWidth);
        expect(lines.length, name).toBeGreaterThan(layout.padHistoryLines);
        expect(lines.join(' '), name).toContain(THIRTY);
      }
    }
  });

  it('cuts only these ball sentences in the last-tap line: one at 360, three at 320', () => {
    expect(over(layout.padLineLines, lineRoom, 360, composite)).toEqual(['nl undone ball']);
    expect(over(layout.padLineLines, lineRoom, 320, composite)).toEqual([
      'es undone ball',
      'nl a whole ball',
      'nl undone ball',
    ]);
  });

  it('would have cut only the whole ball in a History row under the cap: two languages at 360, all four at 320', () => {
    const inHistory = (name: string) => composite(name) && IN_HISTORY(name);
    expect(over(layout.padHistoryLines, historyRoom, 360, inHistory)).toEqual([
      'es a whole ball',
      'fr a whole ball',
    ]);
    expect(over(layout.padHistoryLines, historyRoom, 320, inHistory)).toEqual([
      'en a whole ball',
      'es a whole ball',
      'fr a whole ball',
      'nl a whole ball',
    ]);
  });

  // What the ellipsis cuts is the end, and only in the last-tap line (a History row is not cut). The head of a cut ball
  // sentence is kept: "Undone" (or its word) and the extra, "5 no-balls". The dismissal is not always kept: where the kept
  // lines stop before the batter's " · " (the mark after "<batter> out") the wicket is cut too, and this pins where, so a
  // copy change that moves it is seen.
  type Cut = { readonly where: string; readonly kept: string; readonly head: string };
  const cuts = (): readonly Cut[] =>
    WIDTHS.flatMap((width) =>
      LANGUAGES.flatMap(([lang, dictionary]) =>
        sentences(dictionary, USUAL)
          .filter(([name]) => composite(name))
          .flatMap(([name, text]): Cut[] => {
            const lines = linesIn(text, lineRoom(width, dictionary), controlWidth);
            if (lines.length <= layout.padLineLines) return [];
            const undone = said(dictionary, 'scoring.cricket.last.undone').split('{what}')[0];
            const noBalls = fill(said(dictionary, 'scoring.cricket.ball.noball.other'), {
              count: 5,
            });
            return [
              {
                where: `line ${width} ${lang} ${name}`,
                kept: lines.slice(0, layout.padLineLines).join(' '),
                head: (name === 'undone ball' ? (undone ?? '') : '') + noBalls,
              },
            ];
          }),
      ),
    );

  it('keeps the head of every cut ball sentence in the last-tap line, and names where the wicket goes too', () => {
    const all = cuts();
    // One at 360 and three at 320 (the list above). A History row cuts none.
    expect(all).toHaveLength(4);
    expect(all.filter(({ kept, head }) => !kept.startsWith(head))).toEqual([]);
    expect(all.filter(({ kept }) => !kept.includes(' · ')).map(({ where }) => where)).toEqual([
      'line 320 nl undone ball',
    ]);
  });

  // Not cut at all in History: every word of every sentence (not only the one-clause ones) is no wider than the row's
  // room, so wrapping at the spaces shows the whole sentence, whatever the language, at 320 and 360. This and the
  // component's own check that the sentence carries no line limit (`HistoryCover.test.tsx`) are the two halves of it.
  it('shows every History sentence whole: no word is wider than the row’s room, whatever the name', () => {
    for (const who of [USUAL, LONGEST])
      for (const width of WIDTHS)
        for (const [lang, dictionary] of LANGUAGES)
          for (const [name, text] of sentences(dictionary, who).filter(([n]) => IN_HISTORY(n)))
            expect(
              wordsFit(text, historyRoom(width), controlWidth),
              `${lang} ${name} ${width}`,
            ).toBe(true);
  });

  it('keeps every word whole in both rooms, with the longest name as the batter and the one the sentence is about', () => {
    for (const width of WIDTHS)
      for (const [, dictionary] of LANGUAGES)
        for (const [name, text] of sentences(dictionary, LONGEST)) {
          expect(wordsFit(text, lineRoom(width, dictionary), controlWidth), name).toBe(true);
          expect(wordsFit(text, historyRoom(width), controlWidth), name).toBe(true);
        }
  });

  // T19 device run D2/D3: a pick's line (the last-tap line only; a pick is never a History row), measured as the ball
  // sentences are: three lines at most with the usual names, every word whole with the longest. The longest is the next
  // bowler and a hand swap together.
  const picksSaid = (dictionary: Dictionary, name: string): readonly string[] => {
    const at = (key: string, vars: Readonly<Record<string, string | number>>) =>
      fill(said(dictionary, key), vars);
    const bowler = at('scoring.cricket.last.bowlerChange', { name });
    const swap = at('scoring.cricket.last.swap', { name });
    return [
      swap,
      at('scoring.cricket.ball.and', { first: bowler, second: swap }),
      at('scoring.cricket.last.begin.innings', { number: 4 }),
      at('scoring.cricket.last.begin.superOver', { number: 12 }),
    ];
  };

  it.each(LANGUAGES)(
    '%s: a pick’s line holds its three lines, every word whole',
    (lang, dictionary) => {
      for (const width of WIDTHS) {
        const room = lineRoom(width, dictionary);
        for (const text of picksSaid(dictionary, USUAL.person))
          expect(linesOf(text, room, controlWidth), `${lang} ${width} ${text}`).toBeLessThanOrEqual(
            layout.padLineLines,
          );
        for (const text of picksSaid(dictionary, PERSON))
          expect(wordsFit(text, room, controlWidth), `${lang} ${width} ${text}`).toBe(true);
      }
      // Anti-vacuity: the joined line wraps at 320, so the cap is measured.
      const joined = picksSaid(dictionary, USUAL.person)[1] ?? '';
      expect(linesOf(joined, lineRoom(320, dictionary), controlWidth)).toBeGreaterThan(1);
    },
  );

  // Anti-vacuity: the whole ball is long enough to take more than one line at 320, so the limits above are measured.
  it('the whole ball takes more than one line at 320', () => {
    const [, ball] = sentences(en, USUAL).find(([name]) => name === 'a whole ball') ?? ['', ''];
    expect(linesOf(ball, historyRoom(320), controlWidth)).toBeGreaterThan(1);
  });

  it.each(LANGUAGES)(
    '%s: the heading Before play is one line in the column, in caps',
    (_, dictionary) => {
      const heading = said(dictionary, 'scoring.cricket.history.before');
      for (const width of WIDTHS)
        expect(linesOf(heading, column(width), capsOf('state')), heading).toBe(1);
    },
  );
});

// The result in the strip (`PadStripItem.lines`, Task 18): two lines of `metricUnit` in the whole column, so a club's
// whole name wraps rather than being cut (T16 concern 2). Every wording, in the singular as well, with a thirty-character
// club and the widest figures.
describe.each(WIDTHS)('the result and the break’s lines at %i dp', (width) => {
  const SINGULAR_RESULTS = ['runs.one', 'wickets.one', 'innings_and_runs.one'].map(
    (key) => `scoring.cricket.result.${key}`,
  );

  it.each(LANGUAGES)(
    '%s: every result takes two lines at most with a thirty-character club',
    (_, dictionary) => {
      for (const key of [...RESULT_KEYS, ...SINGULAR_RESULTS]) {
        const words = fill(said(dictionary, key), { name: THIRTY, count: CHASE.runs });
        expect(wordsFit(words, column(width), unitWidth), words).toBe(true);
        expect(linesOf(words, column(width), unitWidth), words).toBeLessThanOrEqual(2);
      }
    },
  );

  // The break's line: the closed innings and what the next needs, the lead or level scores, in `body`, no line limit.
  it.each(LANGUAGES)('%s: the other break lines keep every word whole', (_, dictionary) => {
    for (const key of [
      'scoring.cricket.break.chase.one',
      'scoring.cricket.break.need',
      'scoring.cricket.break.lead.one',
      'scoring.cricket.break.lead.other',
      'scoring.cricket.break.level',
      'scoring.cricket.board.chase.one',
    ]) {
      const words = fill(said(dictionary, key), {
        team: THIRTY,
        target: 999,
        count: 120,
        runs: 999,
      });
      expect(wordsFit(words, column(width), bodyOf), words).toBe(true);
    }
  });
});

// The scorecard under Match details (`CricketScorecard`): an innings' title and total, a batter's name and how out beside
// the figures, who has not batted, the extras, the bowling, the fall of wickets. Rooms as the component sets them: the
// sheet's text (the screen less `space.md` a side), a row's name column less the figures and a gap.
describe.each(WIDTHS)('the scorecard at %i dp', (width) => {
  const BAT = '199 (120)';
  /** A row's name column: the sheet's text less the figures (never cut) and the gap. */
  const nameColumn = (figures: string) => column(width) - figuresWidth(figures) - space.md;

  it.each(LANGUAGES)(
    '%s: title and total keep their words whole, the total in two lines',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.history.innings', 'scoring.cricket.history.superOver']) {
        const title = fill(said(dictionary, key), { number: 12, side: THIRTY });
        expect(wordsFit(title, column(width), labelWidth), title).toBe(true);
      }
      for (const key of ['total', 'declared']) {
        const total = fill(said(dictionary, `scoring.cricket.card.${key}`), {
          runs: 999,
          wickets: 10,
          overs: OVERS,
        });
        expect(wordsFit(total, column(width), figuresWidth), total).toBe(true);
        expect(linesOf(total, column(width), figuresWidth), total).toBeLessThanOrEqual(2);
      }
    },
  );

  it.each(LANGUAGES)(
    '%s: how a batter is out keeps every word whole beside the figures, four lines at most',
    (_, dictionary) => {
      const how = said(dictionary, 'scoring.cricket.out.kind.hitballtwice');
      const fielders = fill(said(dictionary, 'scoring.cricket.out.fielders'), {
        how,
        assist: PERSON,
        fielder: PERSON,
      });
      const hows = [
        said(dictionary, 'scoring.cricket.card.notOut'),
        said(dictionary, 'scoring.cricket.card.out'),
        fill(said(dictionary, 'scoring.cricket.card.bowledBy'), { how: fielders, bowler: PERSON }),
      ];
      for (const text of hows) {
        expect(wordsFit(text, nameColumn(BAT), statusOf), text).toBe(true);
        expect(linesOf(text, nameColumn(BAT), statusOf), text).toBeLessThanOrEqual(4);
      }
      const score = fill(said(dictionary, 'scoring.cricket.card.score'), { runs: 199, balls: 120 });
      expect(figuresWidth(score), score).toBeLessThanOrEqual(figuresWidth(BAT));
    },
  );

  // A name is a `NameText`: one with gaps wraps at them, one without is one line, shrunk to `nameFloor` and cut beyond.
  it('a batter’s name keeps room for its first word beside the figures, a bowler’s beside the spell', () => {
    expect(nameColumn(BAT)).toBeGreaterThanOrEqual(
      bodyOf('Wolstenholme-Fitzgerald') * layout.nameFloor,
    );
    expect(nameColumn(SPELL)).toBeGreaterThanOrEqual(bodyOf('Fitzgerald'));
  });

  it.each(LANGUAGES)(
    '%s: the notes and the fall of wickets keep every word whole in the sheet’s column',
    (_, dictionary) => {
      const texts = [
        fill(said(dictionary, 'scoring.cricket.card.didNotBat'), {
          names: [PERSON, PERSON, PERSON].join(', '),
        }),
        fill(said(dictionary, 'scoring.cricket.card.extras'), {
          total: 999,
          wides: 99,
          noBalls: 99,
          byes: 99,
          legByes: 99,
        }),
        fill(said(dictionary, 'scoring.cricket.card.extrasPen'), {
          total: 999,
          wides: 99,
          noBalls: 99,
          byes: 99,
          legByes: 99,
          penalties: 25,
        }),
        fill(said(dictionary, 'scoring.cricket.card.fall'), {
          wicket: 10,
          runs: 999,
          batter: PERSON,
          over: OVERS,
        }),
      ];
      for (const text of texts) expect(wordsFit(text, column(width), bodyOf), text).toBe(true);
    },
  );

  it.each(LANGUAGES)('%s: the section heading is one line in caps', (_, dictionary) => {
    const title = said(dictionary, 'scoring.cricket.card.fallTitle');
    expect(linesOf(title, column(width), capsOf('state')), title).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T19 fix 5, Part 2: the result board. The card's title is the result in `panelTitle` caps (two lines at most), its
// sentence is `body`; below it two score rows (a name that shrinks, the figures), then the not-out pair. No keys stand at
// a result, so the height is not the constraint: the words are.
// ---------------------------------------------------------------------------------------------------------------
const RESULT_TITLE_LINES = 2;
const RESULT_BODIES = [
  'scoring.card.resultRecorded.namedBodyOpen',
  'scoring.card.resultRecorded.namedBodyClosed',
];

describe.each(WIDTHS)('the result board at %i dp', (width) => {
  /** The card's text room: the column less the card's padding and the edge bar. */
  const cardRoom = column(width) - 2 * space.md - layout.padSideBar;
  const capsTitle = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.panelTitle.fontSize) +
    typeScale.panelTitle.letterSpacing * [...text].length;

  it.each(LANGUAGES)(
    '%s: every result is two lines as the card’s title (three for a thirty-character club), every word whole',
    (_, dictionary) => {
      for (const key of RESULT_KEYS) {
        for (const [name, lines] of [
          [TWELVE, RESULT_TITLE_LINES],
          [THIRTY, RESULT_TITLE_LINES + 1],
        ] as const) {
          const title = fill(said(dictionary, key), { name, count: CHASE.runs });
          expect(linesOf(title, cardRoom, capsTitle), title).toBeLessThanOrEqual(lines);
          for (const word of title.split(' ')) {
            expect(capsTitle(word), word).toBeLessThanOrEqual(cardRoom);
          }
        }
      }
    },
  );

  it.each(LANGUAGES)('%s: the card’s sentence keeps every word whole', (_, dictionary) => {
    for (const key of RESULT_BODIES) {
      const sentence = said(dictionary, key);
      for (const word of sentence.split(' '))
        expect(bodyOf(word), word).toBeLessThanOrEqual(cardRoom);
    }
  });

  it.each(LANGUAGES)(
    '%s: a score row holds the longest figures and a name’s first word',
    (_, dictionary) => {
      const figures = `${SCORE} ${fill(said(dictionary, 'scoring.cricket.board.overs'), { overs: OVERS })}`;
      const room = column(width) - space.sm - figuresWidth(figures);
      // At the floor, the first word of the longest name is still whole beside the longest figures.
      expect(labelWidth('Southern') * layout.boardTeamMinScale).toBeLessThanOrEqual(room);
      // A usual name is whole at full size beside a usual score.
      const usual = `${'188/9'} ${fill(said(dictionary, 'scoring.cricket.board.overs'), { overs: '19.4' })}`;
      expect(labelWidth(TEAM_TWELVE)).toBeLessThanOrEqual(
        column(width) - space.sm - figuresWidth(usual),
      );
    },
  );

  it('two score rows and the not-out pair stand in the board’s height under the card, and the card’s lines', () => {
    const rows = layout.resultPanel + 3 * layout.creaseRow + layout.overStrip + 2 * space.sm;
    expect(rows).toBeLessThan(285 + space.sm + 256);
  });
});

// The sweep (plan Task 18): every key this file owns (`OWNED.lines` in the kit) was read by a fit case above, through `said`.
// A key added to the dictionaries with no fit case is a red test, listed by name. It runs last and relies on the file's
// order, so a run filtered by name (`-t`) fails it: run the file whole.
describe('the sweep', () => {
  it('every scoring.cricket key this file owns has a fit case', () => {
    const owned = cricketKeys().filter((key) => ownsKey('lines', key));
    expect(owned.length).toBeGreaterThan(0);
    expect(unmeasured(owned, swept)).toEqual([]);
  });
});
