import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { isOneWord } from '@/ui/components/nameFit';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesIn, linesOf } from '../../../test/textFit';

// S2-4 plan Task 8: what the cricket board draws fits at 320 and 360 dp in four languages (the pattern of padFit.test.ts,
// whose rooms are copied here from the token and type declarations and the board's styles, never read from the
// components): the score line, the innings line's words before the side's name, the chase line, a crease row with the
// longest names and figures, and a full over of chips. Cricket names are long: a name gives way to an ellipsis, the
// numbers never do (spec §5). Whether real text stays inside on a phone is the device check's.

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
const mono = loadFont('geist-mono-400');

const said = (dictionary: Dictionary, key: string): string => {
  const text = dictionary[key] ?? '';
  expect(text, key).not.toBe('');
  return text;
};
const fill = (text: string, vars: Readonly<Record<string, string | number>>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );

/** `scoreCompact`: Barlow Condensed 700 at 64, tabular digits (`zero.tf`); the slash at its own advance. */
const scoreWidth = (text: string) =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        typeScale.scoreCompact.fontSize,
    0,
  );
/** `label`: Barlow Condensed 600 at 20, as typed. The overs beside the score, a batter's and the bowler's names. */
const labelWidth = (text: string) => barlow600.width(text, typeScale.label.fontSize);
/** `control`: Geist 500 at 14. The innings line and the chase line. */
const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `metricValue`: Geist Mono 400 at 16. A batter's runs (balls) and the bowler's O-M-R-W. */
const figuresWidth = (text: string) => mono.width(text, typeScale.metricValue.fontSize);
/** `metricUnit`: Geist 500 at 12. The over's label and a free hit beside it. */
const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
/** `controlSmall`: Geist 500 at 12. A chip's word. */
const chipWidth = (text: string) => geist500.width(text, typeScale.controlSmall.fontSize);

/** The pad's column: the screen less its padding (space.md a side). */
const column = (width: number) => width - 2 * space.md;
/** A crease row: the striker's mark, then the name, then the figures, `space.xs` apart. */
const nameRoom = (width: number, figures: string) =>
  column(width) - space.md - 2 * space.xs - figuresWidth(figures);

/** The longest numbers a board can show: an unlimited innings' score and overs, a long chase, a long spell. */
const SCORE = '999/10';
const OVERS = '189.5';
const CHASE = { runs: 999, count: 120 };
const BATTER = '199 (120)';
const SPELL = '35.4-10-120-10';
/** The longest name a crease row must show at least a part of: the room must hold its first word. */
const LONG_NAME = 'Wolstenholme-Fitzgerald';

describe.each(WIDTHS)('the cricket board at %i dp', (width) => {
  it.each(LANGUAGES)(
    'the score line holds the longest score and its overs: %s',
    (_, dictionary) => {
      const overs = fill(said(dictionary, 'scoring.cricket.board.overs'), { overs: OVERS });
      expect(scoreWidth(SCORE) + space.sm + labelWidth(overs)).toBeLessThanOrEqual(column(width));
    },
  );

  it.each(LANGUAGES)(
    'the innings line holds its words and number before the side’s name: %s',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.history.innings', 'scoring.cricket.history.superOver']) {
        const before = fill(said(dictionary, key), { number: 12, side: '' });
        expect(controlWidth(before), key).toBeLessThanOrEqual(column(width));
      }
    },
  );

  it.each(LANGUAGES)('the chase line holds the longest chase on one line: %s', (_, dictionary) => {
    for (const key of ['scoring.cricket.board.chase.other', 'scoring.cricket.board.need']) {
      const chase = fill(said(dictionary, key), CHASE);
      expect(controlWidth(chase), key).toBeLessThanOrEqual(column(width));
    }
  });

  it('a crease row keeps the figures whole and room for a long name’s first word', () => {
    expect(nameRoom(width, BATTER)).toBeGreaterThanOrEqual(labelWidth(LONG_NAME));
    expect(nameRoom(width, SPELL)).toBeGreaterThanOrEqual(labelWidth('W. Fitzgerald'));
  });

  it('eight chips (six balls and two extras) fit the column on one row', () => {
    expect(8 * layout.overChip + 7 * space.xs).toBeLessThanOrEqual(column(width));
  });

  it.each(LANGUAGES)(
    'the over’s label and a free hit share the strip’s head: %s',
    (_, dictionary) => {
      const label = fill(said(dictionary, 'scoring.cricket.board.over'), { number: 50 });
      const status = said(dictionary, 'scoring.cricket.board.freeHit');
      expect(unitWidth(label) + space.sm + unitWidth(status)).toBeLessThanOrEqual(column(width));
    },
  );
});

describe('a chip', () => {
  // At `control`'s 14, "5wd" was 29.1 dp: the chip's word is `controlSmall`'s 12 (24.9, 3.5 dp a side in 32). Eight chips
  // must still fit 320's column, so the chip cannot grow (above).
  it('holds the widest delivery a chip can say, with room each side', () => {
    for (const text of ['7nb', '11p', '5wd', '4lb', 'W', '·']) {
      expect(chipWidth(text), text).toBeLessThanOrEqual(layout.overChip - space.xs);
    }
  });
});

describe('the board’s regions', () => {
  it('the score panel holds the score, the innings line and the chase line', () => {
    expect(
      typeScale.scoreCompact.lineHeight + 2 * typeScale.control.lineHeight + 2 * space.xs,
    ).toBeLessThanOrEqual(layout.scorePanel);
  });

  it('a crease row holds a line of names and of figures', () => {
    expect(typeScale.label.lineHeight).toBeLessThanOrEqual(layout.creaseRow);
    expect(typeScale.metricValue.lineHeight).toBeLessThanOrEqual(layout.creaseRow);
  });

  it('the over strip holds its label and a chip of usable height', () => {
    const chip = layout.overStrip - typeScale.metricUnit.lineHeight - space.xs;
    expect(chip).toBeGreaterThanOrEqual(typeScale.controlSmall.lineHeight + 2 * space.xs);
  });
});

// S2-4 plan Task 10 (owner ruling 83): the two-half toss and the setup in the pad's column. The toss's question is
// `title` caps (Batch 3 fix round 1, M7: the preview's size), kept to `padTossAskLines` lines in its half whatever it
// says, so a long team's name must still fit in them; a side's button holds a team name at `label` wrapped at its gaps,
// and Bat and Bowl at `tally` on one line, a word too wide shrunk (`NameText`, never broken). The order row's name keeps
// the room left by its place and the two ▲▼ targets, and the Opener plate under it.
describe.each(WIDTHS)('the toss and the setup at %i dp', (width) => {
  /** `state`: Barlow Condensed 700 at 15, uppercase, letterspaced. The Opener plate. */
  const stateWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
    typeScale.state.letterSpacing * [...text].length;
  /** `title`: Barlow Condensed 700 at 26, uppercase, letterspaced. The toss's two questions. */
  const titleWidth = (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
    typeScale.title.letterSpacing * [...text].length;
  /** `tally`: Barlow Condensed 700 at 46, as typed. Bat and Bowl. */
  const tallyWidth = (text: string) => barlow700.width(text, typeScale.tally.fontSize);
  /** A side's button: half the row less its gap, less its padding (`space.sm` a side) and its border (TossPicker). */
  const tossText = (column(width) - space.sm) / 2 - 2 * space.sm - 2 * layout.iconBorder;
  /** An order row: the place (`space.lg`), the name, two 48 dp targets, `space.sm` between each (CricketOrderList). */
  const orderName = column(width) - space.lg - 2 * layout.touch - 3 * space.sm;
  /** A thirty-character club's name, and a name with one long word. */
  const LONG_TEAM = 'Bishops Stortford Cricket Club';
  const ONE_WORD_TEAM = 'Wolverhampton CC';

  it('the thirty-character name is thirty characters (anti-vacuity)', () => {
    expect(LONG_TEAM).toHaveLength(30);
  });

  it.each(LANGUAGES)(
    '%s: both questions keep to their lines with a thirty-character name',
    (_, dictionary) => {
      const ask = said(dictionary, 'scoring.cricket.toss.ask');
      const chose = said(dictionary, 'scoring.cricket.toss.chose');
      const team = said(dictionary, 'scoring.cricket.toss.team');
      for (const text of [ask, fill(chose, { team }), fill(chose, { team: LONG_TEAM })]) {
        expect(linesOf(text, column(width), titleWidth), text).toBeLessThanOrEqual(
          layout.padTossAskLines,
        );
        for (const line of linesIn(text, column(width), titleWidth)) {
          expect(titleWidth(line), line).toBeLessThanOrEqual(column(width));
        }
      }
    },
  );

  it('a thirty-character name takes the question’s second line, the short question one (anti-vacuity)', () => {
    const chose = fill(said(en, 'scoring.cricket.toss.chose'), { team: LONG_TEAM });
    expect(linesOf(chose, column(width), titleWidth)).toBe(2);
    expect(linesOf(said(en, 'scoring.cricket.toss.ask'), column(width), titleWidth)).toBe(1);
  });

  it.each(LANGUAGES)(
    '%s: Bat and Bowl are one word each, on one line in a side’s button, shrunk no further than the name floor',
    (_, dictionary) => {
      for (const key of ['scoring.cricket.toss.bat', 'scoring.cricket.toss.bowl']) {
        const word = said(dictionary, key);
        expect(isOneWord(word), word).toBe(true);
        expect(tallyWidth(word) * layout.nameFloor, word).toBeLessThanOrEqual(tossText);
      }
    },
  );

  it('the words shrunk to fit at tally are French Frapper at 320, and none at 360 (anti-vacuity)', () => {
    const words = LANGUAGES.flatMap(([, dictionary]) =>
      ['scoring.cricket.toss.bat', 'scoring.cricket.toss.bowl'].map((key) => said(dictionary, key)),
    );
    expect(words.filter((word) => tallyWidth(word) > tossText)).toEqual(
      width === 320 ? ['Frapper'] : [],
    );
  });

  it('a club’s word is wider than a side’s button at tally, so the names stay at label (M7)', () => {
    expect(tallyWidth('Riverside')).toBeGreaterThan(tossText);
    expect(labelWidth('Riverside')).toBeLessThanOrEqual(tossText);
  });

  it('a team’s name wraps at its gaps in a side’s button, every word whole', () => {
    for (const name of [LONG_TEAM, ONE_WORD_TEAM]) {
      for (const word of name.split(' ')) {
        expect(labelWidth(word), word).toBeLessThanOrEqual(tossText);
      }
    }
    // Anti-vacuity: the long name needs more than one line, and the button (filling its half) grows for it.
    expect(linesOf(LONG_TEAM, tossText, labelWidth)).toBeGreaterThan(1);
  });

  it.each(LANGUAGES)('%s: an order row holds a long name and the Opener plate', (_, dictionary) => {
    const opener = said(dictionary, 'scoring.cricket.setup.opener');
    expect(stateWidth(opener) + 2 * space.sm).toBeLessThanOrEqual(orderName);
    expect(labelWidth('M. Wolstenholme')).toBeLessThanOrEqual(orderName);
  });
});
