import { describe, expect, it } from 'vitest';
import type { ScreenLayout } from '@/domain/mode/homeLayout';
import { LANGS, type Lang } from '@/i18n/language';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { type TileTitleRole, tileTitleRole } from '@/ui/theme/tileTitle';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import app from '../../../app.json';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// Spec §7 and F15: landscape Home is one top row (logo, status, Language, version), then the ended card as one
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
// owner's phone sideways, which lays Home out 728 × 332 behind ShellFrame's insets: one card there leaves 145 or 153
// for tiles that need 166, and Home scrolls, by design (N31; the controller's ruling, 2026-10-12). The widths are
// Home's own, as laid out behind the insets. Whether real text stays inside the card rows' single lines is Task 9's,
// on the phone.

type Dictionary = Readonly<Record<string, string>>;
const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => DICTIONARIES[lang][key] ?? '';

/**
 * viewfinderFit's four shapes (spec §1's smallest, the least strip room, the board's own, and a large phone), and the
 * owner's phone sideways as Home is laid out on it: 728 × 332, the 804 × 360 display less ShellFrame's insets with
 * 3-button navigation (N31; the controller's ruling, 2026-10-12).
 */
const GEOMETRIES = [
  [640, 360],
  [728, 332],
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
/** GhostButton's `minHeight`: Language, OK and Forget. */
const GHOST = 48;
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

const TOP = Math.max(
  layout.logoLandscape.height,
  STATUS_LINES * typeScale.status.lineHeight,
  GHOST,
);
/** The ended card's row: the board's 10 above and below, the tallest part (OK) between. */
const ENDED_HEAD = typeScale.state.lineHeight + typeScale.metricValue.lineHeight;
const ENDED_LINES = typeScale.control.lineHeight + typeScale.metricUnit.lineHeight;
const ENDED = 2 * layout.rowCardPadV + BORDER + Math.max(GHOST, ENDED_HEAD, ENDED_LINES);
/** Continue's row: the same paddings, the plate between, and one title line over one detail line. */
const CONTINUE_TEXT = typeScale.state.lineHeight + space.xs + typeScale.control.lineHeight;
const CONTINUE = 2 * layout.rowCardPadV + BORDER + Math.max(PLATE, CONTINUE_TEXT);

describe('the landscape rows, at their least (one line of text each)', () => {
  it('the top row is 57: three lines of status, which holds the 56 logo and the 48 Language', () => {
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

/**
 * The tallest tile at a window width, per language, over the three modes, from the fonts. `titleLines`, when given,
 * stands in for every title's measured lines: the clamp's bound (N31, below).
 */
let tilesMeasured = 0;
function tileNeedBy(width: number, titleLines?: number): Readonly<Record<Lang, number>> {
  const inner = (width - 2 * space.md - 2 * space.sm) / 3 - TILE_EDGE - 2 * TILE_PAD;
  const need: Record<Lang, number> = { en: 0, es: 0, fr: 0, nl: 0 };
  for (const lang of LANGS) {
    for (const mode of ['stream', 'scoring', 'dashboard'] as const) {
      const title = word(lang, `mode.${mode}`).toUpperCase();
      const hint = mode === 'stream' ? 'home.tile.stream.hint' : 'home.tile.comingSoon';
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
  [728, 332, 'no cards', 235, true],
  [728, 332, 'Continue only', 145, false],
  [728, 332, 'ended only', 153, false],
  [728, 332, 'both cards', 63, false],
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

  it('fourteen of the twenty fit at best and six scroll: both cards but on the largest phone, and any card at 728 × 332', () => {
    // Pinned so a table edit that flips a row is a decision, not an accident. Every no-cards window fits. Every
    // one-card window fits but the owner's phone sideways, 728 × 332 behind its insets, where Home scrolls with a card
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
      [728, 332, 'Continue only', 145, false],
      [728, 332, 'ended only', 153, false],
    ]);
  });

  it('the owner’s phone sideways, 728 × 332 behind its insets, scrolls with Continue: 145 for tiles that need 166 (N31)', () => {
    const row = TABLE.find(
      ([width, height, cards]) => width === 728 && height === 332 && cards === 'Continue only',
    );
    expect(row).toEqual([728, 332, 'Continue only', 145, false]);
    expect(tileNeed(728) - 145).toBe(21);
  });

  it('checked every row of the table, and there were twenty (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(GEOMETRIES.length * CARDS.length);
    expect(rowsChecked).toBe(TABLE.length);
  });
});

describe('the Stream settings link in the Live Stream tile (R2, P6)', () => {
  /** TextLink's 48 dp target under the hint, `space.xs` apart (the tile's gap). */
  const LINK = space.xs + layout.touch;
  /** The tile's inner width at a window width: a third, less the pads, the two gaps, the edge and the padding. */
  const innerAt = (width: number) =>
    (width - 2 * space.md - 2 * space.sm) / 3 - TILE_EDGE - 2 * TILE_PAD;
  /** The Live Stream tile with its link; `titleLines`, when given, stands in for the title's measured lines (N31). */
  const streamNeed = (width: number, titleLines?: number): number => {
    const inner = innerAt(width);
    let need = 0;
    for (const lang of LANGS) {
      const lines =
        titleLines ??
        linesOf(word(lang, 'mode.stream').toUpperCase(), inner - ICON - space.sm, measureTitle);
      const purposeLines = linesOf(word(lang, 'home.tile.stream.purpose'), inner, (text) =>
        geist400.width(text, typeScale.body.fontSize),
      );
      const hintLines = linesOf(word(lang, 'home.tile.stream.hint'), inner, (text) =>
        geist500.width(text, typeScale.metricUnit.fontSize),
      );
      need = Math.max(
        need,
        2 * TILE_PAD +
          Math.max(ICON, lines * typeScale.title.lineHeight) +
          space.xs +
          purposeLines * typeScale.body.lineHeight +
          space.xs +
          hintLines * typeScale.metricUnit.lineHeight +
          LINK,
      );
    }
    return need;
  };
  /** What a window leaves the tiles with no card (the top row, the pads, no gaps for cards): 97 dp of spend. */
  const noCards = (height: number) =>
    height - layout.homePadTop - layout.homePadBottom - layout.homeGap - TOP;

  it('the link takes 52: the 48 dp target and the 4 dp gap above it', () => {
    expect(LINK).toBe(52);
  });

  // 728 × 332 is the owner's phone sideways as Home is laid out behind its insets (N31); 804 × 332 is its display.
  it.each([
    [640, 360, 218, 263],
    [728, 332, 218, 235],
    [804, 332, 196, 235],
    [915, 412, 167, 315],
  ] as const)(
    '%i × %i: the Live Stream tile with its link needs %i of the %i left with no card',
    (width, height, need, left) => {
      expect(streamNeed(width)).toBe(need);
      expect(noCards(height)).toBe(left);
      expect(need).toBeLessThanOrEqual(left);
    },
  );

  it('with Continue or the ended card it would not fit at 800 × 360, which is why it hides then (P6)', () => {
    const leftAt800 = (cards: Cards) =>
      TABLE.find(([width, height, name]) => width === 800 && height === 360 && name === cards)?.[3];
    expect(streamNeed(800)).toBe(196);
    expect([leftAt800('ended only'), leftAt800('Continue only')]).toEqual([181, 173]);
    expect(streamNeed(800)).toBeGreaterThan(leftAt800('ended only') ?? Infinity);
    expect(streamNeed(800)).toBeGreaterThan(leftAt800('Continue only') ?? Infinity);
  });

  // N31: a title takes two lines at most, never three (`layout.tileTitleLines`), whatever width Home gets behind its
  // insets. With the Live Stream title at two lines, the tile and its link still fit with no card, on the owner's phone
  // sideways (728 × 332) included.
  it.each([
    [640, 360, 218, 263],
    [728, 332, 218, 235],
    [804, 332, 218, 235],
    [915, 412, 196, 315],
  ] as const)(
    '%i × %i: with its title at two lines it needs %i of the %i left with no card (N31)',
    (width, height, need, left) => {
      expect(streamNeed(width, layout.tileTitleLines)).toBe(need);
      expect(noCards(height)).toBe(left);
      expect(need).toBeLessThanOrEqual(left);
    },
  );

  // N31's class: a label wider than its tile runs past the edge. The link's words are one line at the narrowest
  // tile, in every language, so no word is cut and the 48 dp target holds them.
  it.each(LANGS)('its label is one line at 640 wide in %s', (lang) => {
    const label = word(lang, 'home.streamSettings');
    expect(label).not.toBe('');
    expect(
      linesOf(label, innerAt(640), (text) => geist500.width(text, typeScale.metricUnit.fontSize)),
    ).toBe(1);
  });
});

describe('portrait with the link: why a tile grows from its content (P7)', () => {
  // Portrait pads its tiles 16 (`space.md`). Spec §1's narrowest phone is 360 wide. The column's own spend, with no
  // card and no development tools: the 16 pads above and below, the 70 logo, the status's 57, the footer (the 48
  // Language, 8, the 16 version line) and three 8 gaps between the four rows.
  const LINK = space.xs + layout.touch;
  const inner = 360 - 2 * space.md - TILE_EDGE - 2 * space.md;
  const FOOTER = GHOST + space.sm + typeScale.metricUnit.lineHeight;
  const SPEND =
    2 * space.md +
    layout.logo.height +
    STATUS_LINES * typeScale.status.lineHeight +
    FOOTER +
    3 * space.sm;
  const tileAt360 = (lang: Lang, mode: 'stream' | 'scoring' | 'dashboard'): number => {
    const hint = mode === 'stream' ? 'home.tile.stream.hint' : 'home.tile.comingSoon';
    const titleLines = linesOf(
      word(lang, `mode.${mode}`).toUpperCase(),
      inner - ICON - space.sm,
      (text) =>
        barlow700.width(text, typeScale.title.fontSize) +
        typeScale.title.letterSpacing * text.length,
    );
    const purposeLines = linesOf(word(lang, `home.tile.${mode}.purpose`), inner, (text) =>
      geist400.width(text, typeScale.body.fontSize),
    );
    const hintLines = linesOf(word(lang, hint), inner, (text) =>
      geist500.width(text, typeScale.metricUnit.fontSize),
    );
    return (
      2 * space.md +
      Math.max(ICON, titleLines * typeScale.title.lineHeight) +
      space.xs +
      purposeLines * typeScale.body.lineHeight +
      space.xs +
      hintLines * typeScale.metricUnit.lineHeight +
      (mode === 'stream' ? LINK : 0)
    );
  };

  it('the column spends 255 besides the tiles', () => {
    expect(FOOTER).toBe(72);
    expect(SPEND).toBe(255);
  });

  // [lang, the three tiles at 360 wide (Live Stream with its link), the window an equal third needs, the window the
  // tiles grown from their content need before the column scrolls].
  it.each([
    ['en', [159, 107, 107], 748, 644],
    ['es', [175, 129, 107], 796, 682],
    ['fr', [159, 129, 107], 748, 666],
    ['nl', [159, 129, 129], 748, 688],
  ] as const)(
    '%s at 360 wide: tiles %j; equal thirds need a %i dp window, tiles grown from their content %i',
    (lang, needs, equalThirds, grown) => {
      const measured = (['stream', 'scoring', 'dashboard'] as const).map((mode) =>
        tileAt360(lang, mode),
      );
      expect(measured).toEqual(needs);
      // A zero basis gives each tile a third: the tallest must fit a third, or its words run under the link.
      expect(SPEND + 3 * Math.max(...measured) + 2 * space.sm).toBe(equalThirds);
      // An auto basis gives each tile its own need first; the column scrolls only past their sum.
      expect(SPEND + measured.reduce((a, b) => a + b, 0) + 2 * space.sm).toBe(grown);
      // A window 740 dp tall sits below every equal-thirds need and above every grown one: the reason.
      expect(equalThirds).toBeGreaterThan(740);
      expect(grown).toBeLessThan(740);
    },
  );
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
  ] as const;
  let checked = 0;

  it.each(GEOMETRIES)('at %i × %i: what the logo, Language and the version leave', (width) => {
    for (const lang of LANGS) {
      const label = `${word(lang, 'home.footer.language')} · ${word(lang, `language.${lang}`)}`;
      const language =
        2 * space.md + 2 * layout.iconBorder + geist500.width(label, typeScale.control.fontSize);
      const version = geist500.width(
        word(lang, 'home.footer.version').replace('{version}', app.expo.version),
        typeScale.metricUnit.fontSize,
      );
      const footer = language + layout.homeGap + version;
      // The logo hangs its empty left edge outside the column, so it takes 160 less 12; two gaps of 16 and the pads.
      const logo = layout.logoLandscape.width - layout.logoInsetLandscape;
      const status = width - 2 * space.md - logo - footer - 2 * space.md;
      const longest = ['mode.stream', 'mode.scoring', 'mode.dashboard']
        .map((key) => word(lang, key))
        .reduce((a, b) => (b.length > a.length ? b : a));
      for (const key of keys) {
        const text = word(lang, key).replace('{mode}', longest).replace('{time}', '18:40 CEST');
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
    expect(keys).toHaveLength(7);
    expect(checked).toBe(GEOMETRIES.length * LANGS.length * keys.length);
  });
});

describe('every tile title fits its tile, wrapping within two lines, never inside a word (N31)', () => {
  // Item A2 of the D3 findings design (§10) and its fix round 1 (the controller's ruling, 2026-10-12). The widths are
  // Home's own, as laid out behind ShellFrame's insets, never the phone's. The title shrinks to its row's room beside the
  // icon and wraps at spaces. A word wider than that room would be cut inside it, so where the widest word does not
  // fit, the title steps down a size (`tileTitleRole`). It fits when, at the size the rule picks, no word is wider than
  // the room and the words take no more lines than the clamp allows.
  const MODES = ['stream', 'scoring', 'dashboard'] as const;
  const TITLE_LINES = layout.tileTitleLines;
  /**
   * The title's row (Tile's `head`, which `tileTitleRole` reads): the tile's inner width. Sideways, a tile is a third of
   * HomeScreen's row (`contentLandscape` pads `space.md` a side and `tilesRow` has two `space.sm` gaps), less the 4 edge
   * and `tileLandscapePad` a side. Upright, each tile is the column's whole width (R11 of the D3 findings design): the
   * window less HomeScreen's `screen` padding (`space.md` a side), the edge and the tile's `space.md` a side.
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
  // dp less ShellFrame's insets with 3-button navigation, a 31 dp cutout and a 45 dp bar: the tiles measured 226.7 dp in
  // r12-home-fr-landscape.png), 804 that phone's display, which Home never gets with the bar, and 915 the largest.
  // Upright: 360 the narrowest and 412 the largest.
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

  it('at 592, the step leaves LIVESTREAM 3.9 dp inside the 117.3; at full size it would be cut, as would both DASHBOARDs', () => {
    const room = titleBudget('landscape', 592);
    expect(room).toBeCloseTo(117.3, 1);
    expect(room - measureAs('action')('LIVESTREAM')).toBeCloseTo(3.9, 1);
    expect(words().filter((part) => measureTitle(part) > room)).toEqual([
      'DASHBOARD',
      'LIVESTREAM',
      'DASHBOARD',
    ]);
  });

  it('the step holds Home down to 581 wide: at 580, LIVESTREAM is wider than its room even at `action`', () => {
    expect(titleBudget('landscape', 581) - measureAs('action')('LIVESTREAM')).toBeGreaterThan(0);
    expect(titleBudget('landscape', 580) - measureAs('action')('LIVESTREAM')).toBeLessThan(0);
  });

  it('the owner’s phone sideways lays Home out 728 wide: both French titles overrun the title’s room by more than the tile’s padding (N31)', () => {
    // The D3 shot (r12-home-fr-landscape.png): tiles of 226.7 dp, so Home was 728 wide, not the display's 804. The fit
    // measures the French titles as the phone drew them (TABLEAU DE BORD's ink: 176.0 measured, 177.3 by the font).
    expect((728 - 2 * space.md - 2 * space.sm) / 3).toBeCloseTo(226.7, 1);
    const room = titleBudget('landscape', 728);
    expect(room).toBeCloseTo(162.7, 1);
    for (const key of ['mode.scoring', 'mode.dashboard']) {
      const title = word('fr', key).toUpperCase();
      expect(measureTitle(title) - room, title).toBeGreaterThan(TILE_PAD);
    }
    expect(['mode.scoring', 'mode.dashboard'].map((key) => word('fr', key).toUpperCase())).toEqual([
      'SCORE À DISTANCE',
      'TABLEAU DE BORD',
    ]);
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
