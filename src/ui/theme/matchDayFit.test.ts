import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { LANGS, type Lang } from '@/i18n/language';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// Match Day's list (MD-2 Task 4; S4 design §5, layout B), measured from the shipped fonts and the four dictionaries at
// 320 and 360 dp upright, as scoringHomeFit.test.ts measures Home's cards. The layout facts are the list's own tokens
// (the screen's 16 each side, the card's border and `matchDayCardPad`, the row's `matchDayRowLabel` column and 8 dp
// gaps, the chip's 8 + 1 each side, Home's 48 dp icon button and the header's 16 gap). A line that is cut is pinned as
// cut: the names of a row are one line with an ellipsis (the dispatch's ruling 6), and the pins say which are.

const OUT = process.env.FIT_OUT;
/** For re-pinning only: FIT_OUT=<dir> writes what each test measured. */
const dump = (name: string, measured: unknown) => {
  if (OUT !== undefined) writeFileSync(`${OUT}/${name}.json`, JSON.stringify(measured, null, 1));
};

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const said = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce(
    (all, [name, word]) => all.replaceAll(`{${name}}`, word),
    text,
  );
};

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
const mono = loadFont('geist-mono-400');

type CapsRole = 'diagSection' | 'diagTitle' | 'state' | 'action' | 'title';
/** A caps role as drawn: Barlow Condensed in caps at the role's size, letterspaced. */
const caps =
  (role: CapsRole) =>
  (text: string): number => {
    const face = role === 'diagSection' ? barlow600 : barlow700;
    const style = typeScale[role];
    return face.width(text.toUpperCase(), style.fontSize) + style.letterSpacing * text.length;
  };
const geist =
  (role: 'control' | 'controlInk' | 'controlSmall') =>
  (text: string): number =>
    geist500.width(text, typeScale[role].fontSize);
const body = (text: string): number => geist400.width(text, typeScale.body.fontSize);
/** `diagValue`: Geist Mono at 13, so a width is its code points x 0.6 x 13. */
const detail = (text: string): number => mono.width(text, typeScale.diagValue.fontSize);

const WIDTHS = [320, 360] as const;
const GAP = space.sm;
/** The list's column: the screen less 16 each side. */
const column = (width: number) => width - 2 * space.md;
/** Inside a court card (and the sections' cards): the column less the card's border and its padding. */
const cardInner = (width: number) =>
  column(width) - 2 * layout.cardBorder - 2 * layout.matchDayCardPad;
/** What a row's names and detail share: the card less the label column (when it has one) and the gaps. */
const rowRoom = (width: number, labelled: boolean) =>
  cardInner(width) - (labelled ? layout.matchDayRowLabel + GAP : 0) - GAP;
/** The most the detail is given (review I2): whatever leaves the names `matchDayNamesMin`. Beyond it, an ellipsis. */
const detailCap = (width: number, labelled: boolean) =>
  rowRoom(width, labelled) - layout.matchDayNamesMin;
/** The names take what the detail, as drawn (whole, or cut at its cap), leaves. */
const namesRoom = (width: number, labelled: boolean, shown: string | null) =>
  rowRoom(width, labelled) +
  (shown === null ? GAP : -Math.min(detail(shown), detailCap(width, labelled)));
/** `rowNames`: the house face for player names (AGENTS §5), Barlow Condensed 600 at 16, mixed case. */
const names = (text: string): number => barlow600.width(text, typeScale.rowNames.fontSize);
const fits = (width: number, room: number): 'fits' | 'cut' => (width <= room ? 'fits' : 'cut');

/** The day header's day word as each language's `Intl` writes Saturday 3 October (formatDay). */
const DAY_WORD: Readonly<Record<Lang, string>> = {
  en: 'Sat 3 Oct',
  es: 'sáb, 3 oct',
  fr: 'sam. 3 oct.',
  nl: 'za 3 okt',
};

const NAMES = {
  singles: 'Ng v Brown',
  doubles: 'Lee / Tan v Ashok / Ravi',
  long: 'Christopher Fairweather-Smith v Maximilian Oyelaran-Brooks',
} as const;
/**
 * A row's detail: a planned time, the venue's time named from a phone in another zone, the short score the web will
 * send (the desk's), and the scoreboard headlines it sends today (the engine's `summary().headline`: set-based with a
 * game in play, mid-match and finished; cricket's), the longest kinds a row can be handed.
 */
const DETAILS = [
  '14:40',
  '14:40 BST',
  '0–1 · 12–10',
  '1 — 0 · 21–15 (14–11)',
  '1 — 1 · 21–15, 18–21 (14–9)',
  '2 — 1 · 21–15, 18–21, 21–19',
  '187/6 (20) — 154/9 (18.3)',
] as const;

/** The details cut at their cap: every scoreboard headline but a game in play with no label at 360. */
const CUT_DETAILS = [
  '320 label | 1 — 0 · 21–15 (14–11)',
  '320 label | 1 — 1 · 21–15, 18–21 (14–9)',
  '320 label | 2 — 1 · 21–15, 18–21, 21–19',
  '320 label | 187/6 (20) — 154/9 (18.3)',
  '320 none | 1 — 0 · 21–15 (14–11)',
  '320 none | 1 — 1 · 21–15, 18–21 (14–9)',
  '320 none | 2 — 1 · 21–15, 18–21, 21–19',
  '320 none | 187/6 (20) — 154/9 (18.3)',
  '360 label | 1 — 0 · 21–15 (14–11)',
  '360 label | 1 — 1 · 21–15, 18–21 (14–9)',
  '360 label | 2 — 1 · 21–15, 18–21, 21–19',
  '360 label | 187/6 (20) — 154/9 (18.3)',
  '360 none | 1 — 1 · 21–15, 18–21 (14–9)',
  '360 none | 2 — 1 · 21–15, 18–21, 21–19',
  '360 none | 187/6 (20) — 154/9 (18.3)',
];
/** Under a label, the names cut: a doubles pair at 320 beside all but a local time, at 360 beside a headline; the long
 * pair everywhere. */
const CUT_LABELLED = [
  '320 doubles | 14:40 BST',
  '320 doubles | 0–1 · 12–10',
  '320 doubles | 1 — 0 · 21–15 (14–11)',
  '320 doubles | 1 — 1 · 21–15, 18–21 (14–9)',
  '320 doubles | 2 — 1 · 21–15, 18–21, 21–19',
  '320 doubles | 187/6 (20) — 154/9 (18.3)',
  '320 long | 14:40',
  '320 long | 14:40 BST',
  '320 long | 0–1 · 12–10',
  '320 long | 1 — 0 · 21–15 (14–11)',
  '320 long | 1 — 1 · 21–15, 18–21 (14–9)',
  '320 long | 2 — 1 · 21–15, 18–21, 21–19',
  '320 long | 187/6 (20) — 154/9 (18.3)',
  '360 doubles | 1 — 0 · 21–15 (14–11)',
  '360 doubles | 1 — 1 · 21–15, 18–21 (14–9)',
  '360 doubles | 2 — 1 · 21–15, 18–21, 21–19',
  '360 doubles | 187/6 (20) — 154/9 (18.3)',
  '360 long | 14:40',
  '360 long | 14:40 BST',
  '360 long | 0–1 · 12–10',
  '360 long | 1 — 0 · 21–15 (14–11)',
  '360 long | 1 — 1 · 21–15, 18–21 (14–9)',
  '360 long | 2 — 1 · 21–15, 18–21, 21–19',
  '360 long | 187/6 (20) — 154/9 (18.3)',
];
/** With no label, the doubles pair is cut only beside a scoreboard headline. */
const CUT_UNLABELLED = [
  '320 | 1 — 0 · 21–15 (14–11)',
  '320 | 1 — 1 · 21–15, 18–21 (14–9)',
  '320 | 2 — 1 · 21–15, 18–21, 21–19',
  '320 | 187/6 (20) — 154/9 (18.3)',
  '360 | 1 — 0 · 21–15 (14–11)',
  '360 | 1 — 1 · 21–15, 18–21 (14–9)',
  '360 | 2 — 1 · 21–15, 18–21, 21–19',
  '360 | 187/6 (20) — 154/9 (18.3)',
];
/** Two open seats beside a time, under a label: whole at 360; at 320 only in Spanish. */
const TBD: Readonly<Record<string, string>> = {
  '320 en': 'cut',
  '320 es': 'fits',
  '320 fr': 'cut',
  '320 nl': 'cut',
  '360 en': 'fits',
  '360 es': 'fits',
  '360 fr': 'fits',
  '360 nl': 'fits',
};

describe('a match row: names one line with an ellipsis, the detail whole up to its cap (review I2)', () => {
  it('every Now / Next / Then label fits its column, the widest within 2 dp of it (no slack to hide a longer word)', () => {
    const widths = LANGS.flatMap((lang) =>
      ['matchday.row.now', 'matchday.row.next', 'matchday.row.then'].map((key) =>
        caps('diagSection')(said(lang, key)),
      ),
    );
    expect(Math.max(...widths)).toBeLessThanOrEqual(layout.matchDayRowLabel);
    expect(Math.max(...widths)).toBeGreaterThan(layout.matchDayRowLabel - 2);
  });

  it('the detail’s cap: 88 dp under a label at 320, so the short score and a zoned time stand whole', () => {
    expect(Math.round(detailCap(320, true))).toBe(88);
    expect(detail('0–1 · 12–10')).toBeLessThanOrEqual(detailCap(320, true));
    expect(detail('14:40 BST')).toBeLessThanOrEqual(detailCap(320, true));
    // Anti-vacuity: 3 dp more names floor would cut the short score at 320.
    expect(detail('0–1 · 12–10')).toBeGreaterThan(detailCap(320, true) - 3);
  });

  it('which details are cut with an ellipsis, under a label and not, at 320 and 360 (the rest are whole)', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const labelled of [true, false])
        for (const shown of DETAILS)
          measured[`${width} ${labelled ? 'label' : 'none'} | ${shown}`] = fits(
            detail(shown),
            detailCap(width, labelled),
          );
    dump('details', measured);
    const cut = Object.entries(measured)
      .filter(([, verdict]) => verdict === 'cut')
      .map(([at]) => at);
    expect(cut).toEqual(CUT_DETAILS);
  });

  it('the names floor holds a singles pair whole, beside the longest headline', () => {
    expect(names(NAMES.singles)).toBeLessThanOrEqual(layout.matchDayNamesMin);
    expect(namesRoom(320, true, '2 — 1 · 21–15, 18–21, 21–19')).toBe(layout.matchDayNamesMin);
  });

  it('two seats not decided yet, beside a time, under a label: which languages fit at 320 and 360', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        const open = said(lang, 'matchday.seat.tbd');
        const seats = said(lang, 'matchday.row.match', { home: open, away: open });
        measured[`${width} ${lang}`] = fits(names(seats), namesRoom(width, true, '14:40'));
      }
    dump('tbd', measured);
    expect(measured).toEqual(TBD);
  });

  it('under a label: which names fit beside which detail at 320 and 360 (the rest are cut)', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const [name, text] of Object.entries(NAMES))
        for (const shown of DETAILS)
          measured[`${width} ${name} | ${shown}`] = fits(
            names(text),
            namesRoom(width, true, shown),
          );
    dump('labelled', measured);
    const cut = Object.entries(measured)
      .filter(([, verdict]) => verdict === 'cut')
      .map(([at]) => at);
    expect(cut).toEqual(CUT_LABELLED);
  });

  it('a doubles pair beside a time fits under a label at 320 (review M1)', () => {
    expect(names(NAMES.doubles)).toBeLessThanOrEqual(namesRoom(320, true, '14:40'));
  });

  it('with no label (finished, no court, online): which details cut the doubles pair, at 320 and 360', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const shown of DETAILS)
        measured[`${width} | ${shown}`] = fits(
          names(NAMES.doubles),
          namesRoom(width, false, shown),
        );
    dump('unlabelled', measured);
    const cut = Object.entries(measured)
      .filter(([, verdict]) => verdict === 'cut')
      .map(([at]) => at);
    expect(cut).toEqual(CUT_UNLABELLED);
  });
});

describe('a court card’s head: the name one line, the state chip whole', () => {
  const chipOf = (word: string) => caps('state')(word) + 2 * space.sm + 2 * layout.cardBorder;
  const STATES = [
    'matchday.court.playing',
    'matchday.court.called',
    'matchday.court.free',
    'matchday.court.inUseElsewhere',
  ];
  const COURTS = ['Court 12', 'Centre Court', 'Main Hall Court 14', 'Sports Centre Hall B Court 3'];

  it('beside the widest chip in each language, which court names fit at 320 and 360', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        const chip = Math.max(...STATES.map((key) => chipOf(said(lang, key))));
        for (const name of COURTS)
          measured[`${width} ${lang} ${name}`] = fits(
            caps('diagTitle')(name),
            cardInner(width) - GAP - chip,
          );
      }
    dump('courts', measured);
    const cut = Object.entries(measured)
      .filter(([, verdict]) => verdict === 'cut')
      .map(([at]) => at);
    expect(cut).toEqual([
      '320 en Sports Centre Hall B Court 3',
      '320 es Sports Centre Hall B Court 3',
      '320 fr Sports Centre Hall B Court 3',
      '320 nl Sports Centre Hall B Court 3',
      '360 en Sports Centre Hall B Court 3',
      '360 es Sports Centre Hall B Court 3',
      '360 nl Sports Centre Hall B Court 3',
    ]);
  });

  it('the widest chip is Dutch Called, and leaves the name over half the card at 320', () => {
    const chips = LANGS.flatMap((lang) => STATES.map((key) => chipOf(said(lang, key))));
    expect(Math.max(...chips)).toBe(chipOf(said('nl', 'matchday.court.called')));
    expect(cardInner(320) - GAP - Math.max(...chips)).toBeGreaterThan(cardInner(320) / 2);
  });

  it('"Sending N" is one line in the card in every language, at 320', () => {
    for (const lang of LANGS)
      for (const count of ['1', '128'])
        expect(
          linesOf(
            said(lang, count === '1' ? 'matchday.sending.one' : 'matchday.sending.other', {
              count,
            }),
            cardInner(320),
            geist('controlSmall'),
          ),
        ).toBe(1);
  });

  it('"Taps at risk" is one line in the card in every language, at 320 (review I1)', () => {
    const measured: Record<string, number> = {};
    for (const lang of LANGS)
      measured[lang] = linesOf(
        said(lang, 'matchday.sending.atRisk'),
        cardInner(320),
        geist('controlSmall'),
      );
    expect(measured).toEqual({ en: 1, es: 1, fr: 1, nl: 1 });
    // Anti-vacuity: an empty word is one line too, so each must measure as words.
    expect(
      Math.min(
        ...LANGS.map((lang) => geist('controlSmall')(said(lang, 'matchday.sending.atRisk'))),
      ),
    ).toBeGreaterThan(50);
  });

  it('"Finished" is one line in the card in every language, at 320', () => {
    for (const lang of LANGS)
      expect(
        linesOf(said(lang, 'matchday.row.finished'), cardInner(320), caps('diagSection')),
      ).toBe(1);
  });
});

describe('the list’s head, banner, chips and sections', () => {
  const header = (lang: Lang, competition: string, scope: string) =>
    said(lang, 'matchday.header', { competition, scope, day: DAY_WORD[lang] });

  it('the top bar’s title is one line beside the 48 dp Home button, in every language, at 320', () => {
    for (const lang of LANGS)
      expect(caps('action')(said(lang, 'mode.matchday'))).toBeLessThanOrEqual(
        column(320) - layout.iconButton - space.md,
      );
  });

  it('the day header: the example on one line; a long competition at a long venue takes the 2 lines it has, nothing cut', () => {
    const measured: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        measured[`${width} ${lang} example`] = linesOf(
          header(lang, 'SAFE Open', 'Hall A'),
          column(width),
          geist('controlInk'),
        );
        measured[`${width} ${lang} whole`] = linesOf(
          header(lang, 'SAFE Open', said(lang, 'matchday.scope.competition')),
          column(width),
          geist('controlInk'),
        );
        measured[`${width} ${lang} long`] = linesOf(
          header(lang, 'Kent County Badminton Championships 2026', 'Sports Centre Hall A'),
          column(width),
          geist('controlInk'),
        );
      }
    dump('header', measured);
    expect(measured).toEqual({
      '320 en example': 1,
      '320 en whole': 1,
      '320 en long': 2,
      '320 es example': 1,
      '320 es whole': 1,
      '320 es long': 2,
      '320 fr example': 1,
      '320 fr whole': 1,
      '320 fr long': 2,
      '320 nl example': 1,
      '320 nl whole': 1,
      '320 nl long': 2,
      '360 en example': 1,
      '360 en whole': 1,
      '360 en long': 2,
      '360 es example': 1,
      '360 es whole': 1,
      '360 es long': 2,
      '360 fr example': 1,
      '360 fr whole': 1,
      '360 fr long': 2,
      '360 nl example': 1,
      '360 nl whole': 1,
      '360 nl long': 2,
    });
  });

  it('"Offline · updated 10:42 BST" is one line in every language at 320, the zone named', () => {
    const measured: Record<string, number> = {};
    for (const lang of LANGS)
      measured[lang] = linesOf(
        said(lang, 'matchday.offline', { time: '10:42 BST' }),
        column(320),
        geist('control'),
      );
    expect(measured).toEqual({ en: 1, es: 1, fr: 1, nl: 1 });
  });

  it('"All venues" is one chip on a line, its 16 dp padding either side, in every language at 320', () => {
    for (const lang of LANGS)
      expect(
        geist('control')(said(lang, 'matchday.venues.all')) + 2 * space.md + 2 * layout.cardBorder,
      ).toBeLessThanOrEqual(column(320));
  });

  it('the section headings are one line in every language at 320', () => {
    for (const lang of LANGS) {
      expect(
        linesOf(`${said(lang, 'matchday.noCourt')} · 12`, column(320), caps('diagSection')),
      ).toBe(1);
      expect(linesOf(said(lang, 'matchday.online'), column(320), caps('diagSection'))).toBe(1);
    }
  });

  it('the approval banner wraps (it grows, nothing is cut): its lines at 320 and 360', () => {
    const inner = (width: number) => column(width) - layout.labelBar - 2 * layout.matchDayCardPad;
    const division = "Men's Singles Open";
    const measured: Record<string, number> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        const lines = [
          said(lang, 'matchday.approve.swiss', { done: '3', round: '4' }),
          said(lang, 'matchday.approve.draw', { division }),
          said(lang, 'matchday.approve.webOnly.swiss', { done: '3' }),
          said(lang, 'matchday.approve.webOnly.draw', { division }),
          said(lang, 'matchday.approve.webOnly', { label: 'Swiss' }),
        ].map((line) => linesOf(line, inner(width), geist('controlInk')));
        measured[`${width} ${lang}`] = Math.max(...lines);
      }
    dump('banner', measured);
    expect(measured).toEqual({
      '320 en': 2,
      '320 es': 2,
      '320 fr': 2,
      '320 nl': 2,
      '360 en': 2,
      '360 es': 2,
      '360 fr': 2,
      '360 nl': 2,
    });
  });

  it('an empty day (it wraps: Dutch takes 2 lines) and the offline-empty word, at 320', () => {
    const measured: Record<string, number> = {};
    for (const lang of LANGS) {
      measured[`${lang} empty`] = linesOf(said(lang, 'matchday.empty'), column(320), body);
      measured[`${lang} offline`] = linesOf(
        said(lang, 'matchday.offlineEmpty'),
        column(320),
        caps('title'),
      );
    }
    dump('empty', measured);
    expect(measured).toEqual({
      'en empty': 1,
      'en offline': 1,
      'es empty': 1,
      'es offline': 1,
      'fr empty': 1,
      'fr offline': 1,
      'nl empty': 2,
      'nl offline': 1,
    });
  });
});

describe('what a thumb hits (the dispatch’s ruling 6)', () => {
  it('the tokens the list’s pressables are sized from are 48 dp (the screen test reads each one back)', () => {
    expect(layout.touch).toBe(48);
    expect(layout.iconButton).toBe(48);
  });
});
