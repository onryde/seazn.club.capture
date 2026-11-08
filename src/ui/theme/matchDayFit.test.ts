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
/** A row's names take what the label column, the detail and their gaps leave. */
const namesRoom = (width: number, labelled: boolean, shown: string | null) =>
  cardInner(width) -
  (labelled ? layout.matchDayRowLabel + GAP : 0) -
  (shown === null ? 0 : GAP + detail(shown));
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
/** A row's detail: a planned time, the venue's time named from a phone in another zone, a game, two, three. */
const DETAILS = ['14:40', '14:40 BST', '14-9', '21-15 21-18', '21-19 18-21 14-9'] as const;

describe('a match row: names one line with an ellipsis, the detail never cut', () => {
  it('every Now / Next / Then label fits its column, the widest within 2 dp of it (no slack to hide a longer word)', () => {
    const widths = LANGS.flatMap((lang) =>
      ['matchday.row.now', 'matchday.row.next', 'matchday.row.then'].map((key) =>
        caps('diagSection')(said(lang, key)),
      ),
    );
    expect(Math.max(...widths)).toBeLessThanOrEqual(layout.matchDayRowLabel);
    expect(Math.max(...widths)).toBeGreaterThan(layout.matchDayRowLabel - 2);
  });

  it('under a label: which names fit beside which detail at 320 and 360 (the rest are cut)', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const [name, names] of Object.entries(NAMES))
        for (const shown of DETAILS)
          measured[`${width} ${name} | ${shown}`] = fits(
            geist('controlInk')(names),
            namesRoom(width, true, shown),
          );
    dump('labelled', measured);
    expect(measured).toEqual({
      '320 singles | 14:40': 'fits',
      '320 singles | 14:40 BST': 'fits',
      '320 singles | 14-9': 'fits',
      '320 singles | 21-15 21-18': 'fits',
      '320 singles | 21-19 18-21 14-9': 'cut',
      '320 doubles | 14:40': 'cut',
      '320 doubles | 14:40 BST': 'cut',
      '320 doubles | 14-9': 'cut',
      '320 doubles | 21-15 21-18': 'cut',
      '320 doubles | 21-19 18-21 14-9': 'cut',
      '320 long | 14:40': 'cut',
      '320 long | 14:40 BST': 'cut',
      '320 long | 14-9': 'cut',
      '320 long | 21-15 21-18': 'cut',
      '320 long | 21-19 18-21 14-9': 'cut',
      '360 singles | 14:40': 'fits',
      '360 singles | 14:40 BST': 'fits',
      '360 singles | 14-9': 'fits',
      '360 singles | 21-15 21-18': 'fits',
      '360 singles | 21-19 18-21 14-9': 'fits',
      '360 doubles | 14:40': 'fits',
      '360 doubles | 14:40 BST': 'cut',
      '360 doubles | 14-9': 'fits',
      '360 doubles | 21-15 21-18': 'cut',
      '360 doubles | 21-19 18-21 14-9': 'cut',
      '360 long | 14:40': 'cut',
      '360 long | 14:40 BST': 'cut',
      '360 long | 14-9': 'cut',
      '360 long | 21-15 21-18': 'cut',
      '360 long | 21-19 18-21 14-9': 'cut',
    });
  });

  it('the names keep room beside the widest detail at 320: the detail never pushes them out', () => {
    const room = namesRoom(320, true, '21-19 18-21 14-9');
    expect(room).toBeGreaterThan(48);
    expect(Math.round(room)).toBe(63);
  });

  it('two seats not decided yet, beside a time: cut in every language at 320, whole in Spanish and French at 360', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const lang of LANGS) {
        const open = said(lang, 'matchday.seat.tbd');
        const names = said(lang, 'matchday.row.match', { home: open, away: open });
        measured[`${width} ${lang}`] = fits(
          geist('controlInk')(names),
          namesRoom(width, true, '14:40'),
        );
      }
    dump('tbd', measured);
    expect(measured).toEqual({
      '320 en': 'cut',
      '320 es': 'cut',
      '320 fr': 'cut',
      '320 nl': 'cut',
      '360 en': 'cut',
      '360 es': 'fits',
      '360 fr': 'fits',
      '360 nl': 'cut',
    });
  });

  it('with no label (finished, no court, online): doubles fit beside every detail at 360, and all but three games at 320', () => {
    const measured: Record<string, string> = {};
    for (const width of WIDTHS)
      for (const shown of DETAILS)
        measured[`${width} | ${shown}`] = fits(
          geist('controlInk')(NAMES.doubles),
          namesRoom(width, false, shown),
        );
    dump('unlabelled', measured);
    expect(measured).toEqual({
      '320 | 14:40': 'fits',
      '320 | 14:40 BST': 'fits',
      '320 | 14-9': 'fits',
      '320 | 21-15 21-18': 'fits',
      '320 | 21-19 18-21 14-9': 'cut',
      '360 | 14:40': 'fits',
      '360 | 14:40 BST': 'fits',
      '360 | 14-9': 'fits',
      '360 | 21-15 21-18': 'fits',
      '360 | 21-19 18-21 14-9': 'fits',
    });
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
  it('every pressable on the list is 48 dp: Home’s button, a venue chip, Try again, a match row', () => {
    expect(layout.touch).toBe(48);
    expect(layout.iconButton).toBe(48);
  });
});
