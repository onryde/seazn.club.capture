import { describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '@/i18n/language';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
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
// 1 (coordinator ruling) tightened the tiles' landscape padding to 12 so that ONE card, the common state, fits from
// 640 × 360 up, with at least 4 dp to spare at 800 × 360 in every language. Whether real text stays inside the card
// rows' single lines is Task 9's, on the phone.

type Dictionary = Readonly<Record<string, string>>;
const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => DICTIONARIES[lang][key] ?? '';

/** viewfinderFit's four shapes: spec §1's smallest, the least strip room, the board's own, and a large phone. */
const GEOMETRIES = [
  [640, 360],
  [800, 360],
  [844, 390],
  [915, 412],
] as const;

const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
const barlow700 = loadFont('barlow-condensed-700');

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

/** The tallest tile at a window width, per language, over the three modes, from the fonts. */
let tilesMeasured = 0;
function tileNeedBy(width: number): Readonly<Record<Lang, number>> {
  const inner = (width - 2 * space.md - 2 * space.sm) / 3 - TILE_EDGE - 2 * TILE_PAD;
  const need: Record<Lang, number> = { en: 0, es: 0, fr: 0, nl: 0 };
  for (const lang of LANGS) {
    for (const mode of ['stream', 'scoring', 'dashboard'] as const) {
      const title = word(lang, `mode.${mode}`).toUpperCase();
      const hint = mode === 'stream' ? 'home.tile.stream.hint' : 'home.tile.comingSoon';
      const titleLines = linesOf(
        title,
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
      const height =
        2 * TILE_PAD +
        Math.max(ICON, titleLines * typeScale.title.lineHeight) +
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
    [800, 150],
    [844, 150],
    [915, 121],
  ] as const)('at %i wide the tallest tile is %i', (width, need) => {
    expect(tileNeed(width)).toBe(need);
  });

  // Order-dependent on purpose: it follows the four widths above, and the table below has not run yet.
  it('measured every tile: 4 widths × 4 languages × 3 modes (anti-vacuity)', () => {
    expect(tilesMeasured).toBe(4 * LANGS.length * 3);
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

  it('thirteen of the sixteen fit at best and three scroll: both cards, except on the largest phone', () => {
    // Pinned so a table edit that flips a row is a decision, not an accident. Every no-cards window fits, and so
    // does every one-card window (fix round 1: the tiles' landscape padding is 12, not 16).
    expect(TABLE.filter(([, , , , fits]) => fits)).toHaveLength(13);
    expect(TABLE.filter(([, , , , fits]) => !fits)).toHaveLength(3);
    expect(TABLE.filter(([, , cards, , fits]) => cards === 'no cards' && fits)).toHaveLength(4);
    expect(TABLE.filter(([, , cards, , fits]) => cards !== 'both cards' && fits)).toHaveLength(12);
    expect(TABLE.filter(([, , cards, , fits]) => cards === 'both cards' && !fits)).toHaveLength(3);
  });

  it('checked every row of the table, and there were sixteen (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(GEOMETRIES.length * CARDS.length);
    expect(rowsChecked).toBe(TABLE.length);
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
