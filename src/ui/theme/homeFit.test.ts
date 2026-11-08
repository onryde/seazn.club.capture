import { describe, expect, it } from 'vitest';
import type { ScreenLayout } from '@/domain/mode/homeLayout';
import { LANGS, type Lang } from '@/i18n/language';
import { MODES as HOME_MODES } from '@/ui/modeCopy';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { type TileTitleRole, tileTitleRole } from '@/ui/theme/tileTitle';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import app from '../../../app.json';
import { loadFont } from '../../../test/fontMetrics';
import { linesIn, linesOf } from '../../../test/textFit';

// Spec §7 and F15: landscape Home is one top row (logo, status, version, the Settings gear), then the ended card as one
// row, then Continue as one row, then the three tiles side by side. Spec §1's smallest landscape phone is
// 640 × 360 dp. This adds the rows up from the board (Home-landscape, After-you-stopped-landscape), the token and
// type declarations, the fonts the app ships and the dictionaries, the way viewfinderFit and settingsFit do. None
// of it is read from HomeScreen.
//
// What it finds, which the brief's ruling did not expect: with the fatal end's two cards (the ended card AND
// Continue) there is NOT room for the tiles' copy at 640 × 360, nor at the board's own 844 × 390. So landscape Home
// is a scroller that only scrolls when its rows outgrow the window, and the table below says where that is. Fix round
// 1 (coordinator ruling) tightened the tiles' landscape padding to 12 so that ONE card, the common state, fits at
// 640 × 360, 800 × 360 (with at least 4 dp to spare in every language), 844 × 390 and 915 × 412. It does not on the
// owner's phone sideways, which lays Home out 728 × 328 behind ShellFrame's insets: one card there leaves 141 or 149
// for tiles that need 166, and Home scrolls, by design (N31; the controller's ruling, 2026-10-12). The widths are
// Home's own, as laid out behind the insets. Whether real text stays inside the card rows' single lines is Task 9's,
// on the phone.

type Dictionary = Readonly<Record<string, string>>;
const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => {
  const text = DICTIONARIES[lang][key];
  // A key the dictionaries no longer have must fail here, not measure as an empty string and pass every fit.
  if (text === undefined) throw new Error(`no dictionary entry ${key} in ${lang}`);
  return text;
};

/**
 * viewfinderFit's four shapes (spec §1's smallest, the least strip room, the board's own, and a large phone), and the
 * owner's phone sideways as Home is laid out on it: 728 × 328, the 804 × 360 display less ShellFrame's insets with
 * 3-button navigation, a 32 dp status bar among them (N31, N35; the controller's rulings, 2026-10-12).
 */
const GEOMETRIES = [
  [640, 360],
  [728, 328],
  [800, 360],
  [844, 390],
  [915, 412],
] as const;

const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
const barlow700 = loadFont('barlow-condensed-700');
/** A tile's title, as drawn at a role (N31): Barlow Condensed 700 in caps at the role's size, letterspaced. */
const measureAs =
  (role: TileTitleRole) =>
  (text: string): number =>
    barlow700.width(text, typeScale[role].fontSize) + typeScale[role].letterSpacing * text.length;
/** A tile's title at full size, the `title` role. */
const measureTitle = measureAs('title');

// Component literals the layout test pins on the rendered tree (HomeScreen.layout.test.tsx).
/** GhostButton's `minHeight`: OK and Forget. */
const GHOST = 48;
/** The Settings gear in Home's corner (owner, 2026-11-02): an `IconButton`, a `layout.iconButton` square. */
const GEAR = layout.iconButton;
/** Button's `minHeight`: Continue's plate. */
const PLATE = 56;
/**
 * The tile's left edge is 4 thick (the rendered tile pins it). Its padding in landscape is `layout.tileLandscapePad`
 * (fix round 1), the icon is `layout.modeIcon` square and the status reserves `layout.homeStatusLines` lines: the
 * components read those tokens and HomeScreen.layout.test.tsx / ModeIcon.test.tsx pin the rendered values, so this
 * fit reads the declarations rather than a copy of them.
 */
const TILE_EDGE = 4;
const TILE_PAD = layout.tileLandscapePad;
const ICON = layout.modeIcon;
/** The cards' hairline border, top and bottom. */
const BORDER = 2;
const STATUS_LINES = layout.homeStatusLines;
/** Fix round 1 (coordinator): Continue-only and ended-only must leave the tallest tile this much to spare at 800 × 360. */
const SLACK = 4;

const TOP = Math.max(layout.logoLandscape.height, STATUS_LINES * typeScale.status.lineHeight, GEAR);
/** The ended card's row: the board's 10 above and below, the tallest part (OK) between. */
const ENDED_HEAD = typeScale.state.lineHeight + typeScale.metricValue.lineHeight;
const ENDED_LINES = typeScale.control.lineHeight + typeScale.metricUnit.lineHeight;
const ENDED = 2 * layout.rowCardPadV + BORDER + Math.max(GHOST, ENDED_HEAD, ENDED_LINES);
/** Continue's row: the same paddings, the plate between, and one title line over one detail line. */
const CONTINUE_TEXT = typeScale.state.lineHeight + space.xs + typeScale.control.lineHeight;
const CONTINUE = 2 * layout.rowCardPadV + BORDER + Math.max(PLATE, CONTINUE_TEXT);

describe('the landscape rows, at their least (one line of text each)', () => {
  it('the top row is 57: three lines of status, which holds the 56 logo and the 48 gear', () => {
    expect(STATUS_LINES * typeScale.status.lineHeight).toBe(57);
    expect(layout.logoLandscape.height).toBe(56);
    expect(TOP).toBe(57);
  });

  it('the ended card’s row is 70: 2 × 10 + 2 + the 48 OK (the board’s card is 70)', () => {
    expect([ENDED_HEAD, ENDED_LINES]).toEqual([37, 34]);
    expect(ENDED).toBe(70);
  });

  it('Continue’s row is 78: 2 × 10 + 2 + the 56 plate', () => {
    expect(CONTINUE_TEXT).toBe(39);
    expect(CONTINUE).toBe(78);
  });

  it('the screen’s own spend is 28 above and below, and 12 between rows (the board)', () => {
    expect([layout.homePadTop, layout.homePadBottom, layout.homeGap]).toEqual([12, 16, 12]);
  });

  it('the tile is padded 12 in landscape (portrait’s 16 is `space.md`), the icon is 28 and the status holds 3 lines', () => {
    expect([TILE_PAD, ICON, STATUS_LINES]).toEqual([12, 28, 3]);
    expect(space.md).toBe(16);
  });
});

/** Home's three tiles, in the order it draws them, written out here (Home's own list is pinned to it below). */
const TILE_MODES = ['stream', 'scoring', 'matchday'] as const;
type TileMode = (typeof TILE_MODES)[number];

/**
 * The line under each tile's purpose, written out here: Remote Scoring says which link opens it (plan S2-1 Task 10),
 * and Match Day which code (MD-2 Task 1).
 */
const TILE_HINT = {
  stream: 'home.tile.stream.hint',
  scoring: 'home.tile.scoring.hint',
  matchday: 'home.tile.matchday.hint',
} as const satisfies Readonly<Record<TileMode, string>>;

// MD-2 Task 1: the third mode is Match Day (S4 design §8), and its title is in every fit below. This pins the order the
// fits measure and the words, so a change to either is a decision.
describe('Match Day is the third tile (MD-2 Task 1)', () => {
  it('Home draws stream, scoring, matchday, in that order: the order every fit here measures', () => {
    expect([...HOME_MODES]).toEqual([...TILE_MODES]);
  });

  // es and fr are the web's own words for its Match Day desk (`matchDay.title`). nl is not: the web's _Wedstrijddag_ is
  // one word too wide for a title sideways at 592 and 640 (154.4 dp at `title`, 142.1 at `action`, for rooms of 117.3
  // and 133.3), and a title never breaks inside a word (N31). _Speeldag_ fits (100.9 dp).
  it.each([
    ['en', 'Match Day'],
    ['es', 'Día de partidos'],
    ['fr', 'Jour de match'],
    ['nl', 'Speeldag'],
  ] as const)('in %s its title is %s', (lang, title) => {
    expect(word(lang, 'mode.matchday')).toBe(title);
  });

  it('the web’s Dutch word would be cut sideways, and the one the app uses is not', () => {
    const room = (width: number) =>
      (width - 2 * space.md - 2 * space.sm) / 3 - TILE_EDGE - 2 * TILE_PAD - ICON - space.sm;
    expect(measureAs('action')('WEDSTRIJDDAG')).toBeGreaterThan(room(640));
    expect(measureTitle(word('nl', 'mode.matchday').toUpperCase())).toBeLessThan(room(592));
  });
});

/**
 * The tallest tile at a window width, per language, over the three modes, from the fonts. `titleLines`, when given,
 * stands in for every title's measured lines: the clamp's bound (N31, below).
 */
let tilesMeasured = 0;
function tileNeedBy(width: number, titleLines?: number): Readonly<Record<Lang, number>> {
  const inner = (width - 2 * space.md - 2 * space.sm) / 3 - TILE_EDGE - 2 * TILE_PAD;
  const need: Record<Lang, number> = { en: 0, es: 0, fr: 0, nl: 0 };
  for (const lang of LANGS) {
    for (const mode of TILE_MODES) {
      const title = word(lang, `mode.${mode}`).toUpperCase();
      const hint = TILE_HINT[mode];
      const lines = titleLines ?? linesOf(title, inner - ICON - space.sm, measureTitle);
      const purposeLines = linesOf(word(lang, `home.tile.${mode}.purpose`), inner, (text) =>
        geist400.width(text, typeScale.body.fontSize),
      );
      const hintLines = linesOf(word(lang, hint), inner, (text) =>
        geist500.width(text, typeScale.metricUnit.fontSize),
      );
      const height =
        2 * TILE_PAD +
        Math.max(ICON, lines * typeScale.title.lineHeight) +
        space.xs +
        purposeLines * typeScale.body.lineHeight +
        space.xs +
        hintLines * typeScale.metricUnit.lineHeight;
      need[lang] = Math.max(need[lang], height);
      tilesMeasured += 1;
    }
  }
  return need;
}
/** The tallest over the four languages. */
const tileNeed = (width: number): number => Math.max(...Object.values(tileNeedBy(width)));

describe('the tiles need this much, side by side (the tallest, in four languages)', () => {
  // The inner width is a third of the window, less the screen pads, the two 8 gaps, the 4 edge and the 16 padding.
  it.each([
    [640, 172],
    [728, 166],
    [800, 150],
    [844, 150],
    [915, 121],
  ] as const)('at %i wide the tallest tile is %i', (width, need) => {
    expect(tileNeed(width)).toBe(need);
  });

  // Order-dependent on purpose: it follows the five widths above, and the table below has not run yet.
  it('measured every tile: 5 widths × 4 languages × 3 modes (anti-vacuity)', () => {
    expect(tilesMeasured).toBe(5 * LANGS.length * 3);
  });
});

type Cards = 'no cards' | 'Continue only' | 'ended only' | 'both cards';
const CARDS: readonly (readonly [Cards, number, number])[] = [
  ['no cards', 0, 0],
  ['Continue only', 0, 1],
  ['ended only', 1, 0],
  ['both cards', 1, 1],
];

/**
 * [width, height, cards, what is left for the tiles, whether the tallest tile fits it at best]. At best: a card's
 * text that wraps only takes more, so a `true` here is the most the layout can promise and a `false` is certain.
 * A `false` row is where landscape Home scrolls (it is a scroller for exactly these).
 */
const TABLE = [
  [640, 360, 'no cards', 263, true],
  [640, 360, 'Continue only', 173, true],
  [640, 360, 'ended only', 181, true],
  [640, 360, 'both cards', 91, false],
  [728, 328, 'no cards', 231, true],
  [728, 328, 'Continue only', 141, false],
  [728, 328, 'ended only', 149, false],
  [728, 328, 'both cards', 59, false],
  [800, 360, 'no cards', 263, true],
  [800, 360, 'Continue only', 173, true],
  [800, 360, 'ended only', 181, true],
  [800, 360, 'both cards', 91, false],
  [844, 390, 'no cards', 293, true],
  [844, 390, 'Continue only', 203, true],
  [844, 390, 'ended only', 211, true],
  [844, 390, 'both cards', 121, false],
  [915, 412, 'no cards', 315, true],
  [915, 412, 'Continue only', 225, true],
  [915, 412, 'ended only', 233, true],
  [915, 412, 'both cards', 143, true],
] as const satisfies readonly (readonly [number, number, Cards, number, boolean])[];

describe('which landscape windows hold the tiles without scrolling (spec §1, F15)', () => {
  let rowsChecked = 0;

  it.each(TABLE)(
    '%i × %i, %s: %i left for the tiles, fits at best: %s',
    (width, height, cards, left, fits) => {
      const shown = CARDS.find(([name]) => name === cards);
      expect(shown).toBeDefined();
      const [, ended, saved] = shown ?? ['no cards', 0, 0];
      const rows = 2 + ended + saved; // the top row, the cards, the tiles
      const spend =
        layout.homePadTop +
        layout.homePadBottom +
        (rows - 1) * layout.homeGap +
        TOP +
        ended * ENDED +
        saved * CONTINUE;
      expect(height - spend).toBe(left);
      expect(left >= tileNeed(width)).toBe(fits);
      rowsChecked += 1;
    },
  );

  it('the ruling’s worst case, both cards at 640 × 360, has 91 for tiles that need 172: it scrolls', () => {
    const worst = TABLE.find(
      ([width, height, cards]) => width === 640 && height === 360 && cards === 'both cards',
    );
    expect(worst).toEqual([640, 360, 'both cards', 91, false]);
    expect(tileNeed(640) - 91).toBe(81);
  });

  it('fourteen of the twenty fit at best and six scroll: both cards but on the largest phone, and any card at 728 × 328', () => {
    // Pinned so a table edit that flips a row is a decision, not an accident. Every no-cards window fits. Every
    // one-card window fits but the owner's phone sideways, 728 × 328 behind its insets, where Home scrolls with a card
    // (fix round 1: the tiles' landscape padding is 12, not 16; N31, the controller's ruling, 2026-10-12).
    expect(TABLE.filter(([, , , , fits]) => fits)).toHaveLength(14);
    expect(TABLE.filter(([, , , , fits]) => !fits)).toHaveLength(6);
    expect(TABLE.filter(([, , cards, , fits]) => cards === 'no cards' && fits)).toHaveLength(5);
    expect(TABLE.filter(([, , cards, , fits]) => cards !== 'both cards' && fits)).toHaveLength(13);
    expect(TABLE.filter(([, , cards, , fits]) => cards === 'both cards' && !fits)).toHaveLength(4);
    expect(
      TABLE.filter(
        ([, , cards, , fits]) => cards !== 'both cards' && cards !== 'no cards' && !fits,
      ),
    ).toEqual([
      [728, 328, 'Continue only', 141, false],
      [728, 328, 'ended only', 149, false],
    ]);
  });

  it('the owner’s phone sideways, 728 × 328 behind its insets, scrolls with Continue: 141 for tiles that need 166 (N31)', () => {
    const row = TABLE.find(
      ([width, height, cards]) => width === 728 && height === 328 && cards === 'Continue only',
    );
    expect(row).toEqual([728, 328, 'Continue only', 141, false]);
    expect(tileNeed(728) - 141).toBe(25);
  });

  it('checked every row of the table, and there were twenty (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(GEOMETRIES.length * CARDS.length);
    expect(rowsChecked).toBe(TABLE.length);
  });
});

describe('portrait with the gear in the logo’s row: do three equal tiles fit? (R11 of the D3 findings design, re-measured)', () => {
  // The controller's R11 (2026-10-12) let a portrait tile grow from its own content because the Stream settings link
  // made equal thirds need a 748–796 dp window at 360 wide. Settings is now the gear in the logo's row (owner,
  // 2026-11-02), which is no taller than the 70 dp logo, and the footer lost Language, so the column is 56 dp shorter and
  // no tile has a gear on it. This measures equal thirds again, in every state the tiles share the column with, on two windows: 360 × 720 (a 360 × 800 phone less
  // its status and navigation bars) and 412 × 800 (a 412 × 915 one), both after ShellFrame's insets, an assumption.
  // The 412 window is a deliberately pessimistic bound: it allows the bars 115 dp, the 360 one 80 (finding 3 of the
  // Batch 10 review). With the same 80, 412 × 835, equal thirds fit with one card in every language (the needs below
  // are 807 at most), so R11 rests on 360 wide.
  // Equal thirds (a zero basis) cannot grow past a third, so they must fit in every state or a tile is squeezed below
  // its words (N31's class). The cards are at their least (one line of text each): more lines only take more.
  const inner = (width: number) => width - 2 * space.md - TILE_EDGE - 2 * space.md;
  /** The column's own spend, no card: the 16 pads, the 70 logo row, the status's 57, the footer and three 8 gaps. */
  const FOOTER = typeScale.metricUnit.lineHeight;
  const SPEND =
    2 * space.md +
    layout.logo.height +
    STATUS_LINES * typeScale.status.lineHeight +
    FOOTER +
    3 * space.sm;
  /** Continue, stacked: its padding and hairline, the title, the detail and the plate, 8 apart. */
  const CONTINUE_STACKED =
    2 * space.md +
    BORDER +
    typeScale.state.lineHeight +
    space.sm +
    typeScale.control.lineHeight +
    space.sm +
    PLATE;
  /** The ended card, stacked: the title and the time on one row, how it ended, then OK, 8 apart. */
  const ENDED_STACKED =
    2 * space.md +
    BORDER +
    Math.max(typeScale.state.lineHeight, typeScale.metricValue.lineHeight) +
    space.sm +
    typeScale.control.lineHeight +
    space.sm +
    GHOST;
  /** A tile upright, from the fonts. */
  const tileAt = (width: number, lang: Lang, mode: TileMode): number => {
    const hint = TILE_HINT[mode];
    const titleLines = linesOf(
      word(lang, `mode.${mode}`).toUpperCase(),
      inner(width) - ICON - space.sm,
      measureTitle,
    );
    const purposeLines = linesOf(word(lang, `home.tile.${mode}.purpose`), inner(width), (text) =>
      geist400.width(text, typeScale.body.fontSize),
    );
    const hintLines = linesOf(word(lang, hint), inner(width), (text) =>
      geist500.width(text, typeScale.metricUnit.fontSize),
    );
    return (
      2 * space.md +
      Math.max(ICON, titleLines * typeScale.title.lineHeight) +
      space.xs +
      purposeLines * typeScale.body.lineHeight +
      space.xs +
      hintLines * typeScale.metricUnit.lineHeight
    );
  };
  const STATES = [
    ['no card', 0],
    ['Continue', CONTINUE_STACKED + space.sm],
    ['ended', ENDED_STACKED + space.sm],
    ['both', CONTINUE_STACKED + ENDED_STACKED + 2 * space.sm],
  ] as const;
  let measured = 0;

  it('the column spends 199 besides the tiles; Continue takes 141 at least and the ended card 136', () => {
    expect(FOOTER).toBe(16);
    expect(SPEND).toBe(199);
    expect([CONTINUE_STACKED, ENDED_STACKED]).toEqual([141, 136]);
  });

  // [width, lang, the three tiles, what equal thirds need with no card, Continue, the
  // ended card, both]. Equal thirds need the spend, the card, three of the tallest tile and the two 8 gaps.
  it.each([
    [360, 'en', [107, 107, 107], [536, 685, 680, 829]],
    [360, 'es', [123, 129, 107], [602, 751, 746, 895]],
    [360, 'fr', [107, 129, 107], [602, 751, 746, 895]],
    [360, 'nl', [107, 129, 107], [602, 751, 746, 895]],
    [412, 'en', [107, 107, 107], [536, 685, 680, 829]],
    [412, 'es', [107, 107, 107], [536, 685, 680, 829]],
    [412, 'fr', [107, 129, 107], [602, 751, 746, 895]],
    [412, 'nl', [107, 129, 107], [602, 751, 746, 895]],
  ] as const)(
    '%i wide in %s: tiles %j; equal thirds need %j (no card, Continue, ended, both)',
    (width, lang, tiles, needs) => {
      const drawn = TILE_MODES.map((mode) => tileAt(width, lang, mode));
      expect(drawn).toEqual(tiles);
      const tallest = Math.max(...drawn);
      expect(STATES.map(([, card]) => SPEND + card + 3 * tallest + 2 * space.sm)).toEqual(needs);
      measured += 1;
    },
  );

  it('measured 2 widths × 4 languages (anti-vacuity)', () => {
    expect(measured).toBe(2 * LANGS.length);
  });

  // The verdict, from the table above, and what Language leaving Home changed (owner, 2026-11-02; the footer is the
  // version line alone, 56 dp less). With no card equal thirds fit both windows in every language (602 at most). A card
  // still squeezes them on 360 × 720 in Spanish, French and Dutch (Continue 751, the ended card 746), by 31 and 26 dp,
  // but no longer in English (685 and 680 fit), and on 412 × 800 no card squeezes them in any language (the tightest is
  // 49 dp to spare, in French and Dutch). R11's ruling stands, since 360 × 720 in three languages still squeezes: a tile
  // grows from its own content and Home scrolls. Whether to revisit R11 with 56 dp back is the controller's.
  it('equal thirds fit with no card; a card still squeezes them on 360 × 720 in es, fr and nl: R11 stands', () => {
    const shortfall = (width: number, window: number, state: (typeof STATES)[number][0]) =>
      LANGS.map((lang) => {
        const tallest = Math.max(...TILE_MODES.map((mode) => tileAt(width, lang, mode)));
        const card = STATES.find(([name]) => name === state)?.[1] ?? 0;
        return SPEND + card + 3 * tallest + 2 * space.sm - window;
      });
    expect(shortfall(360, 720, 'no card')).toEqual([-184, -118, -118, -118]);
    expect(shortfall(412, 800, 'no card')).toEqual([-264, -264, -198, -198]);
    expect(shortfall(360, 720, 'Continue')).toEqual([-35, 31, 31, 31]);
    expect(shortfall(360, 720, 'ended')).toEqual([-40, 26, 26, 26]);
    expect(shortfall(412, 800, 'Continue')).toEqual([-115, -115, -49, -49]);
    expect(shortfall(412, 800, 'ended')).toEqual([-120, -120, -54, -54]);
  });

  // The gear shares the logo's row upright: the row is the logo's 70, and the logo and the 48 gear fit the column at the
  // narrowest phone (HomeScreen.layout.test.tsx pins the row's own box).
  it('the logo and the gear share the logo row without making it taller, at 320 and 360 wide', () => {
    expect(GEAR).toBeLessThanOrEqual(layout.logo.height);
    for (const width of [320, 360]) {
      expect(layout.logo.width - layout.logoInset + GEAR).toBeLessThanOrEqual(width - 2 * space.md);
    }
  });
});

describe('Continue alone, or the ended card alone, leaves the tiles room at 800 × 360 (fix round 1)', () => {
  // The common state is ONE card, and 800 × 360 is the phone with the least height after 640 × 360. The ruling: both
  // single-card states fit it with at least SLACK dp to spare in every language (the tallest tile is per language).
  let checked = 0;

  it.each([
    ['Continue only', 23],
    ['ended only', 31],
  ] as const)('%s: every language has %i dp to spare or more', (cards, tightest) => {
    const row = TABLE.find(
      ([width, height, name]) => width === 800 && height === 360 && name === cards,
    );
    expect(row).toBeDefined();
    const left = row?.[3] ?? 0;
    const need = tileNeedBy(800);
    const spare = LANGS.map((lang) => left - need[lang]);
    for (const [index, lang] of LANGS.entries()) {
      expect({ cards, lang, enough: (spare[index] ?? 0) >= SLACK }).toEqual({
        cards,
        lang,
        enough: true,
      });
      checked += 1;
    }
    // The tightest language is the one the table's need comes from.
    expect(Math.min(...spare)).toBe(tightest);
    expect(tightest).toBeGreaterThanOrEqual(SLACK);
  });

  it('checked both states in all four languages (anti-vacuity)', () => {
    expect(checked).toBe(2 * LANGS.length);
  });
});

/**
 * A long day as `formatDay` writes it in each language (Node's ICU for 30 September 2026), by hand: a two-digit day in
 * September, among the longest short months in all four. The line holds three lines with room to spare.
 */
const WIDEST_DAY: Readonly<Record<Lang, string>> = {
  en: 'Wed 30 Sept',
  es: 'mié, 30 sept',
  fr: 'mer. 30 sept.',
  nl: 'wo 30 sep',
};

describe('the top row’s status holds its three lines, in four languages (spec §7)', () => {
  /** Every sentence Home's status line can say (useHome's `statusText`): the idle one, the store's, the scanner's, the expiry's. */
  const keys = [
    'home.status.idle',
    'store.unreadable',
    'store.saveFailed',
    'scanner.noPlayServices',
    'scanner.installing',
    'scanner.failed',
    'reopen.expired',
    // MD-2 Task 3 (S4 design §3, §4): why a Match Day code went, and when its day opens.
    'matchday.ended',
    'matchday.withdrawn',
    'matchday.unknown',
    'matchday.opens',
    'matchday.notOpen',
  ] as const;
  let checked = 0;

  it.each(GEOMETRIES)('at %i × %i: what the logo, the version and the gear leave', (width) => {
    for (const lang of LANGS) {
      const version = geist500.width(
        word(lang, 'home.footer.version').replace('{version}', app.expo.version),
        typeScale.metricUnit.fontSize,
      );
      // The logo hangs its empty left edge outside the column, so it takes 160 less 12. Four children (the logo, the
      // status, the version, the gear), so three gaps of 16, and the pads.
      const logo = layout.logoLandscape.width - layout.logoInsetLandscape;
      const status = width - 2 * space.md - logo - version - GEAR - 3 * space.md;
      const longest = ['mode.stream', 'mode.scoring', 'mode.matchday']
        .map((key) => word(lang, key))
        .reduce((a, b) => (b.length > a.length ? b : a));
      for (const key of keys) {
        const text = word(lang, key)
          .replace('{mode}', longest)
          .replace('{time}', '18:40 CEST')
          .replace('{date}', WIDEST_DAY[lang]);
        const lines = linesOf(text, status, (line) =>
          geist400.width(line, typeScale.status.fontSize),
        );
        expect({ width, lang, key, fits: lines <= STATUS_LINES }).toEqual({
          width,
          lang,
          key,
          fits: true,
        });
        checked += 1;
      }
    }
  });

  it('checked every sentence in every language at every width (anti-vacuity)', () => {
    expect(keys).toHaveLength(12);
    expect(checked).toBe(GEOMETRIES.length * LANGS.length * keys.length);
  });
});

describe('every tile title fits its tile, wrapping within two lines, never inside a word (N31)', () => {
  // Item A2 of the D3 findings design (§10) and its fix round 1 (the controller's ruling, 2026-10-12). The widths are
  // Home's own, as laid out behind ShellFrame's insets, never the phone's. The title shrinks to its row's room beside the
  // icon and wraps at spaces. A word wider than that room would be cut inside it, so where the widest word does not
  // fit, the title steps down a size (`tileTitleRole`). It fits when, at the size the rule picks, no word is wider than
  // the room and the words take no more lines than the clamp allows.
  const MODES = TILE_MODES;
  const TITLE_LINES = layout.tileTitleLines;
  /**
   * The title's row (Tile's `head`, which `tileTitleRole` reads): the tile's inner width. Sideways, a tile is a third of
   * HomeScreen's row (`contentLandscape` pads `space.md` a side and `tilesRow` has two `space.sm` gaps), less the 4 edge
   * and `tileLandscapePad` a side. Upright, each tile is the column's whole width (R11 of the D3 findings design): the
   * window less HomeScreen's `screen` padding (`space.md` a side), the edge and the tile's `space.md` a side. No tile
   * carries a gear since Settings became the gear in Home's corner (owner, 2026-11-02), so the three rows are one width.
   */
  const headWidth = (screen: ScreenLayout, width: number): number =>
    screen === 'landscape'
      ? (width - 2 * space.md - 2 * space.sm) / 3 - TILE_EDGE - 2 * TILE_PAD
      : width - 2 * space.md - TILE_EDGE - 2 * space.md;
  /** The title's room: its row less the icon and the gap after it (`layout.modeIcon`, then `space.sm`). */
  const titleBudget = (screen: ScreenLayout, width: number): number =>
    headWidth(screen, width) - ICON - space.sm;
  /** Every word of every title, in caps. */
  const words = (): readonly string[] =>
    LANGS.flatMap((lang) =>
      MODES.flatMap((mode) => word(lang, `mode.${mode}`).toUpperCase().split(' ')),
    );
  let titlesChecked = 0;

  it('a title takes at most two lines, then an ellipsis (spec §10): the clamp the tile draws', () => {
    expect(TITLE_LINES).toBe(2);
  });

  it('the step is one down the scale, in the same face: `action`, Barlow Condensed 700 in caps at 24 (the title’s 26)', () => {
    // The fit measures both with the one Barlow Condensed 700 file.
    expect(typeScale.action.fontFamily).toBe(typeScale.title.fontFamily);
    expect([typeScale.title.textTransform, typeScale.action.textTransform]).toEqual([
      'uppercase',
      'uppercase',
    ]);
    expect([typeScale.title.fontSize, typeScale.action.fontSize]).toEqual([26, 24]);
  });

  it('the room the title needs at full size is its widest word, nl’s LIVESTREAM, 123.3 dp: 124 to the whole dp', () => {
    const widest = words().reduce((a, b) => (measureTitle(b) > measureTitle(a) ? b : a));
    expect(widest).toBe('LIVESTREAM');
    expect(word('nl', 'mode.stream').toUpperCase()).toBe(widest);
    expect(measureTitle(widest)).toBeCloseTo(123.3, 1);
    expect(layout.tileTitleRoom).toBe(Math.ceil(measureTitle(widest)));
  });

  // [layout, Home's width, the size the rule must pick]. Sideways: 592 is a 640 dp phone behind a 3-button navigation
  // bar (spec §1's narrowest, with the bar), 640 spec §1's narrowest as Home's own, 728 the owner's phone sideways (804
  // dp less ShellFrame's insets with 3-button navigation, a 32 dp cutout and a 44 dp bar: the tiles measured 226.7 dp in
  // r12-home-fr-landscape.png), 804 that phone's display, which Home never gets with the bar, and 915 the largest.
  // Upright: 360 the narrowest and 412 the largest. Every title is measured in the tile's own row.
  it.each([
    ['landscape', 592, 'action'],
    ['landscape', 640, 'title'],
    ['landscape', 728, 'title'],
    ['landscape', 804, 'title'],
    ['landscape', 915, 'title'],
    ['portrait', 360, 'title'],
    ['portrait', 412, 'title'],
  ] as const)(
    '%s at %i wide, at `%s`: no word is wider than the title’s room, and no title takes three lines',
    (screen, width, role) => {
      expect(tileTitleRole(headWidth(screen, width))).toBe(role);
      const room = titleBudget(screen, width);
      const measure = measureAs(role);
      for (const lang of LANGS) {
        for (const mode of MODES) {
          const title = word(lang, `mode.${mode}`).toUpperCase();
          expect(title, `${lang} ${mode}`).not.toBe('');
          for (const part of title.split(' ')) {
            expect(
              measure(part),
              `${lang} ${mode} "${part}" ${screen} at ${width}`,
            ).toBeLessThanOrEqual(room);
          }
          expect(
            linesOf(title, room, measure),
            `${lang} ${mode} ${screen} at ${width}`,
          ).toBeLessThanOrEqual(TITLE_LINES);
          titlesChecked += 1;
        }
      }
      // A step is never for nothing: at `action`, some word would not fit at `title`.
      const tooWide = words().filter((part) => measureTitle(part) > room);
      expect(tooWide.length > 0).toBe(role === 'action');
    },
  );

  // Order-dependent on purpose: it follows the seven widths above.
  it('checked 7 widths × 4 languages × 3 modes (anti-vacuity)', () => {
    expect(titlesChecked).toBe(7 * LANGS.length * MODES.length);
    expect(titlesChecked).toBe(84);
  });

  // No word of Match Day's titles is wider than the room at full size here (MD-2 Task 1).
  it('at 592, the step leaves LIVESTREAM 3.9 dp inside the 117.3; at full size it would be cut, the only word that would be', () => {
    const room = titleBudget('landscape', 592);
    expect(room).toBeCloseTo(117.3, 1);
    expect(room - measureAs('action')('LIVESTREAM')).toBeCloseTo(3.9, 1);
    expect(words().filter((part) => measureTitle(part) > room)).toEqual(['LIVESTREAM']);
  });

  it('the step holds Home down to 581 wide: at 580, LIVESTREAM is wider than its room even at `action`', () => {
    expect(titleBudget('landscape', 581) - measureAs('action')('LIVESTREAM')).toBeGreaterThan(0);
    expect(titleBudget('landscape', 580) - measureAs('action')('LIVESTREAM')).toBeLessThan(0);
  });

  it('the owner’s phone sideways lays Home out 728 wide: the French Remote Scoring title overruns the title’s room by more than the tile’s padding (N31)', () => {
    // The D3 shot (r12-home-fr-landscape.png): tiles of 226.7 dp, so Home was 728 wide, not the display's 804. The fit
    // measures the French titles as the phone drew them (TABLEAU DE BORD's ink: 176.0 measured, 177.3 by the font). Since
    // MD-2 Task 1 the third title is JOUR DE MATCH, which fits the room on one line; SCORE À DISTANCE still wraps.
    expect((728 - 2 * space.md - 2 * space.sm) / 3).toBeCloseTo(226.7, 1);
    const room = titleBudget('landscape', 728);
    expect(room).toBeCloseTo(162.7, 1);
    expect(['mode.scoring', 'mode.matchday'].map((key) => word('fr', key).toUpperCase())).toEqual([
      'SCORE À DISTANCE',
      'JOUR DE MATCH',
    ]);
    expect(measureTitle('SCORE À DISTANCE') - room).toBeGreaterThan(TILE_PAD);
    expect(measureTitle('JOUR DE MATCH')).toBeCloseTo(156.8, 1);
    expect(measureTitle('JOUR DE MATCH')).toBeLessThan(room);
  });
});

describe('with every title at its two-line clamp, the tiles still fit (N31; spec §10)', () => {
  // N31: the tables' widths are Home's own, and a phone lays Home out narrower than its display, behind its insets (the
  // owner's 804 dp sideways is 728). There more titles wrap: at 728 the fit's tallest tile is already the bound's 166.
  // The clamp means a title takes two lines at most, never three, so the bound on a tile's height, whatever width Home
  // gets, is every title at two lines. The heights above are the fit's at the tables' widths.
  const clamped = (width: number): number =>
    Math.max(...Object.values(tileNeedBy(width, layout.tileTitleLines)));
  const leftAt800 = (cards: Cards): number =>
    TABLE.find(([width, height, name]) => width === 800 && height === 360 && name === cards)?.[3] ??
    0;

  it.each([
    [640, 172],
    [728, 166],
    [800, 166],
    [844, 150],
    [915, 150],
  ] as const)('at %i wide the tallest tile is at most %i', (width, bound) => {
    expect(clamped(width)).toBe(bound);
    expect(bound).toBeGreaterThanOrEqual(tileNeed(width));
  });

  it('at 728, the owner’s phone sideways, the fit’s tallest tile is the bound’s: 166', () => {
    expect(tileNeed(728)).toBe(166);
  });

  it('every window that holds the tiles still holds them, but 915 × 412 with both cards, which then scrolls', () => {
    const fitting = TABLE.filter(([, , , , fits]) => fits);
    expect(fitting).toHaveLength(14);
    expect(fitting.filter(([width, , , left]) => left < clamped(width))).toEqual([
      [915, 412, 'both cards', 143, true],
    ]);
  });

  it('one card at 800 × 360 still leaves the slack: Continue 7 to spare, the ended card 15', () => {
    const spare = [leftAt800('Continue only'), leftAt800('ended only')].map(
      (left) => left - clamped(800),
    );
    expect(spare).toEqual([7, 15]);
    expect(Math.min(...spare)).toBeGreaterThanOrEqual(SLACK);
  });
});
