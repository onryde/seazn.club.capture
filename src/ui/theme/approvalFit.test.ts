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

// MD-2 Task 6: the approval review's words at 320 and 360 dp upright in all four languages, from the shipped fonts and
// the dictionaries (as matchDayFit.test.ts measures the list). What is asserted is the room a word has, not a count
// measured from the same code: the plate, the banner's Review button and a row's label are one line, and the lines
// that wrap stay within the lines the layout has room for. Where each line goes on a phone is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const said = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce((all, [k, v]) => all.replaceAll(`{${k}}`, v), text);
};
const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist500 = loadFont('geist-500');

const WIDTHS = [320, 360] as const;
const column = (width: number) => width - 2 * space.md;
/** `action` caps: Barlow Condensed 700, uppercase, letterspaced (the plate's and the header's role). */
const action = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.action.fontSize) +
  typeScale.action.letterSpacing * text.length;
const label = (text: string): number =>
  barlow600.width(text.toUpperCase(), typeScale.diagSection.fontSize) +
  typeScale.diagSection.letterSpacing * text.length;
const control = (text: string): number => geist500.width(text, typeScale.control.fontSize);
const controlInk = (text: string): number => geist500.width(text, typeScale.controlInk.fontSize);

describe('the approval screen’s words fit (320 and 360 dp, four languages)', () => {
  it.each(WIDTHS)('the plate "Hold 3 s" is one line in its plate at %i', (width) => {
    const room = column(width) - 2 * space.sm - 2 * 2;
    for (const lang of LANGS) {
      expect(linesOf(said(lang, 'matchday.approve.hold'), room, action), lang).toBe(1);
    }
    // Anti-vacuity: the measurer does break a line that is too long for the room.
    expect(linesOf('Hold 3 s '.repeat(12).trim(), room, action)).toBeGreaterThan(1);
  });

  it.each(WIDTHS)('the banner’s Review button and Review again are one line at %i', (width) => {
    const room = column(width) - layout.labelBar - 2 * layout.matchDayCardPad - 2 * space.md;
    for (const lang of LANGS)
      for (const key of ['matchday.approve.review', 'matchday.approve.reviewAgain']) {
        expect(linesOf(said(lang, key), room, control), `${lang} ${key}`).toBe(1);
      }
  });

  it('a row’s label ("R10 12", "QF 2") is one line in its column', () => {
    for (const text of ['R10 12', 'QF 2', 'SF 1', 'F'])
      expect(label(text), text).toBeLessThanOrEqual(layout.matchDayRowLabel);
    expect(label('Round 10 board 12')).toBeGreaterThan(layout.matchDayRowLabel);
  });

  it.each(WIDTHS)('the heading takes at most the 2 lines it is given at %i', (width) => {
    const division = 'Mixed doubles · Under 15s · Hall A pool';
    for (const lang of LANGS) {
      const swiss = said(lang, 'matchday.approve.heading.swiss', { division, round: '12' });
      const draw = said(lang, 'matchday.approve.heading.draw', { division });
      expect(linesOf(swiss, column(width), controlInk), `${lang} swiss`).toBeLessThanOrEqual(2);
      expect(linesOf(draw, column(width), controlInk), `${lang} draw`).toBeLessThanOrEqual(2);
    }
  });

  it.each(WIDTHS)('the lines that wrap stay within 3 lines at %i', (width) => {
    for (const lang of LANGS)
      for (const key of [
        'matchday.approve.change',
        'matchday.approve.ties',
        'matchday.approve.already',
        'matchday.approve.stale',
        'matchday.approve.onWeb',
        'matchday.approve.loading',
      ]) {
        const room =
          key === 'matchday.approve.change'
            ? column(width) - 2 * layout.matchDayCardPad
            : column(width);
        expect(linesOf(said(lang, key), room, control), `${lang} ${key}`).toBeLessThanOrEqual(3);
      }
  });
});
