import { describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '@/i18n/language';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { maxFontScale, typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// The reconnect question (owner ruling 43, 2026-11-02) and Discard's confirm over it, upright, at the two narrow widths
// the scoring screens are designed for (320 and 360 dp), in four languages: built from the fonts the app ships and the
// dictionaries, as padFit and scoringStateFit are, and not read from a component. The facts it takes from the
// components are the sheet's padding and gap (`padSheet.ts`: `space.md`, `space.sm`), the lime plate's side padding
// (`Button`: `space.xl`) and the outline's (`GhostButton`: `space.md` and its border). Whether the real text stays inside
// on a phone is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return text;
};
const plural = (lang: Lang, key: string, count: number): string =>
  word(lang, `${key}.${count === 1 ? 'one' : 'other'}`).replaceAll('{count}', String(count));

const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');

/** `title`: Barlow Condensed 700 at 26, uppercase, letter-spaced. The question's title. */
const title = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
/** `body`: Geist 400 at 15. The sentence under the score. */
const body = (text: string): number => geist400.width(text, typeScale.body.fontSize);
/** `status`: Geist 400 at 13.5. The score's caption. */
const status = (text: string): number => geist400.width(text, typeScale.status.fontSize);
/** `action`: Barlow Condensed 700 at 24, uppercase, letter-spaced. The lime plate's label. */
const action = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.action.fontSize) +
  typeScale.action.letterSpacing * [...text].length;
/** `control`: Geist 500 at 14. The outline button's label. */
const control = (text: string): number => geist500.width(text, typeScale.control.fontSize);
/** `label`: Barlow Condensed 600 at 20, as typed. A side's name. */
const name = (text: string): number => barlow600.width(text, typeScale.label.fontSize);

const WIDTHS = [320, 360] as const;
/** The sheet's text: the screen less the sheet's padding. */
const room = (width: number): number => width - 2 * space.md;
/** The lime plate's text: the sheet's text less the plate's side padding. */
const plateText = (width: number): number => room(width) - 2 * space.xl;
/** The outline's text: the sheet's text less its side padding and its border. */
const ghostText = (width: number): number => room(width) - 2 * space.md - 2 * layout.iconBorder;

/** A count of 1, the plural's first, 2, and a big one: the words that change with it. */
const COUNTS = [1, 2, 99] as const;

/** The most lines any of `texts` takes at each width, per language: what the sheet's height is made of. */
function mostLines(
  texts: (lang: Lang) => readonly string[],
  measure: (text: string) => number,
): Record<string, number> {
  const lines: Record<string, number> = {};
  for (const width of WIDTHS)
    for (const lang of LANGS) {
      lines[`${width} ${lang}`] = Math.max(
        ...texts(lang).map((text) => linesOf(text, room(width), measure)),
      );
    }
  return lines;
}

describe('the question’s rooms at 320 and 360', () => {
  it('the sheet’s text is 288 and 328, the lime plate’s 208 and 248, the outline’s 254 and 294', () => {
    expect(WIDTHS.map(room)).toEqual([288, 328]);
    expect(WIDTHS.map(plateText)).toEqual([208, 248]);
    expect(WIDTHS.map(ghostText)).toEqual([254, 294]);
  });
});

describe('the question’s buttons fit on one line at 320 and 360 in four languages', () => {
  it('Send my taps and the confirm’s Keep fit the lime plate', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of ['scoring.ask.send', 'scoring.ask.confirm.keep'])
          expect(action(word(lang, key)), `${width} ${lang} ${key}`).toBeLessThanOrEqual(
            plateText(width),
          );
  });

  it('Discard them and the confirm’s Discard fit the outline', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        for (const key of ['scoring.ask.discard', 'scoring.ask.confirm.discard'])
          expect(control(word(lang, key)), `${width} ${lang} ${key}`).toBeLessThanOrEqual(
            ghostText(width),
          );
  });

  // Anti-vacuity: the first copy of two labels was too wide for the plate at 320, which is what this measure is for.
  it('would have caught the first Spanish Keep and Dutch Send, 221.1 and 210.4 dp of 208', () => {
    expect(action('Conservar mis toques')).toBeGreaterThan(plateText(320));
    expect(action('Mijn taps versturen')).toBeGreaterThan(plateText(320));
  });

  it('leaves the widest label, French Send, 6 dp or more at 320, for a width the fonts read slightly differently', () => {
    const widest = Math.max(
      ...LANGS.flatMap((lang) =>
        ['scoring.ask.send', 'scoring.ask.confirm.keep'].map((key) => action(word(lang, key))),
      ),
    );
    expect(widest.toFixed(1)).toBe('201.4');
    expect(plateText(320) - widest).toBeGreaterThanOrEqual(6);
  });
});

describe('the question’s sentences at 320 and 360 in four languages', () => {
  it('the title takes the lines it takes, 3 at most, for 1, 2 and 99 scores', () => {
    expect(
      mostLines((lang) => COUNTS.map((count) => plural(lang, 'scoring.ask.title', count)), title),
    ).toEqual({
      '320 en': 3,
      '320 es': 3,
      '320 fr': 3,
      '320 nl': 3,
      '360 en': 2,
      '360 es': 3,
      '360 fr': 2,
      '360 nl': 3,
    });
  });

  // Round 4, item 1a (the controller's ruling, 2026-11-03): the question is asked online too (a 409, then a fetch with a
  // web event while a tap is queued: two scorers at once double-count just the same), so its title says what happened
  // and not where the phone was. Anti-vacuity: the words each language used before.
  it('the title does not say the phone was offline, in any language, in either number', () => {
    const OFFLINE = /offline|hors ligne|conexión/i;
    for (const lang of LANGS)
      for (const key of ['scoring.ask.title.one', 'scoring.ask.title.other'])
        expect(word(lang, key), `${lang} ${key}`).not.toMatch(OFFLINE);
    for (const old of [
      '{count} score added elsewhere while you were offline',
      '{count} anotación en otro dispositivo mientras no tenías conexión',
      '{count} point marqué ailleurs pendant que vous étiez hors ligne',
      '{count} score elders genoteerd terwijl je offline was',
    ])
      expect(old).toMatch(OFFLINE);
  });

  it('the title says the scores came before the taps were sent, in every language', () => {
    expect(plural('en', 'scoring.ask.title', 1)).toBe(
      '1 score added elsewhere before your taps were sent',
    );
    expect(plural('en', 'scoring.ask.title', 3)).toBe(
      '3 scores added elsewhere before your taps were sent',
    );
    expect(plural('es', 'scoring.ask.title', 3)).toBe(
      '3 anotaciones en otro dispositivo antes de enviar tus toques',
    );
    expect(plural('fr', 'scoring.ask.title', 3)).toBe(
      "3 points marqués ailleurs avant l'envoi de vos saisies",
    );
    expect(plural('nl', 'scoring.ask.title', 3)).toBe(
      '3 scores elders genoteerd voordat je taps zijn verzonden',
    );
  });

  it('the sentence under the score takes 3 lines at most, for 1, 2 and 128 taps', () => {
    expect(
      mostLines(
        (lang) => [1, 2, 128].map((count) => plural(lang, 'scoring.ask.body', count)),
        body,
      ),
    ).toEqual({
      '320 en': 3,
      '320 es': 3,
      '320 fr': 3,
      '320 nl': 3,
      '360 en': 3,
      '360 es': 3,
      '360 fr': 3,
      '360 nl': 3,
    });
  });

  it('the score’s caption is one line', () => {
    for (const width of WIDTHS)
      for (const lang of LANGS)
        expect(
          linesOf(word(lang, 'scoring.ask.score'), room(width), status),
          `${width} ${lang}`,
        ).toBe(1);
  });

  it('the confirm’s title takes 2 lines at most, and its sentence 2', () => {
    expect(
      mostLines(
        (lang) => [1, 2, 128].map((count) => plural(lang, 'scoring.ask.confirm.title', count)),
        title,
      ),
    ).toEqual({
      '320 en': 1,
      '320 es': 2,
      '320 fr': 2,
      '320 nl': 1,
      '360 en': 1,
      '360 es': 1,
      '360 fr': 1,
      '360 nl': 1,
    });
    expect(
      mostLines(
        (lang) => [1, 2, 128].map((count) => plural(lang, 'scoring.ask.confirm.body', count)),
        body,
      ),
    ).toEqual({
      '320 en': 2,
      '320 es': 1,
      '320 fr': 2,
      '320 nl': 2,
      '360 en': 1,
      '360 es': 1,
      '360 fr': 2,
      '360 nl': 1,
    });
  });
});

describe('the score under the question at 320 and 360', () => {
  /** The widest value, "30", in `tally` at its font-scale cap: two tabular digits. */
  const value = (cap: number): number =>
    2 * barlow700.advanceOfName('zero.tf') * typeScale.tally.fontSize * cap;
  const NAMES = ['A. Sharma', 'L. Chen', 'A. Sharma / R. Iyer', 'L. Chen / M. Wong'] as const;
  /** What a side's name has: the row less the gap and the value, which never shrinks. */
  const nameRoom = (width: number): number =>
    room(width) - space.sm - value(maxFontScale.tally ?? 1);

  it('leaves a name 227 dp at 320 and 267 at 360, beside the widest value at the tally’s cap', () => {
    expect(WIDTHS.map((width) => Math.round(nameRoom(width)))).toEqual([227, 267]);
  });

  it('holds the sample names whole at 320, the doubles included', () => {
    NAMES.forEach((text) => expect(name(text), text).toBeLessThanOrEqual(nameRoom(320)));
  });

  it('would not hold a name of three partners (anti-vacuity: the row cuts one with an ellipsis, never the value)', () => {
    expect(name('A. Sharma / R. Iyer / B. Verma / K. Rao')).toBeGreaterThan(nameRoom(320));
  });
});

describe('the sheet’s height, at the narrowest and the longest', () => {
  /**
   * Padding (2 × 16), the title's lines at 29, the score block (a caption of 19, two rows of the capped `tally`'s line, a
   * gap of 4 between each), the sentence's lines at 22, the plate (56) and the outline (48), and four gaps of 8.
   */
  const heightAt = (titleLines: number, bodyLines: number): number => {
    const row = Math.max(
      typeScale.tally.lineHeight * (maxFontScale.tally ?? 1),
      typeScale.label.lineHeight,
    );
    const score = typeScale.status.lineHeight + 2 * 4 + 2 * row;
    return (
      2 * space.md +
      titleLines * typeScale.title.lineHeight +
      score +
      bodyLines * typeScale.body.lineHeight +
      56 +
      layout.touch +
      4 * space.sm
    );
  };

  it('is 458 dp at 320 in Spanish, the tallest (3 lines of title and 3 of sentence), in a screen of 568 or more', () => {
    expect(Math.round(heightAt(3, 3))).toBe(458);
    expect(heightAt(3, 3)).toBeLessThanOrEqual(568);
  });
});
