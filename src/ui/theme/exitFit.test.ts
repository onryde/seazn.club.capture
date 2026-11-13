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

// MD-2 Task 7: the words ⋯ adds fit at 320 and 360 dp upright in all four languages, from the shipped fonts and the
// dictionaries (as approvalFit.test.ts and matchDayFit.test.ts measure the rest of Match Day). What is asserted is the
// room a word has: the title still reads on one line between Back and ⋯, Exit's title and body stay within the lines a
// sheet has room for, and the Sending card is at most two lines for a court's name and three for a long one. Where each
// line goes on a phone is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const said = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce((all, [k, v]) => all.replaceAll(`{${k}}`, v), text);
};
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');

const WIDTHS = [320, 360] as const;
const caps = (role: 'action' | 'title') => (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
  typeScale[role].letterSpacing * text.length;
const body = (text: string): number => geist400.width(text, typeScale.body.fontSize);
const control = (text: string): number => geist500.width(text, typeScale.control.fontSize);

describe('⋯ and Exit’s question fit (320 and 360 dp, four languages)', () => {
  it.each(WIDTHS)('the title is one line between Back and ⋯ at %i', (width) => {
    // The bar's padding both sides, then Back, a gap, the title, a gap and ⋯.
    const room = width - 2 * space.md - 2 * layout.iconButton - 2 * space.md;
    for (const lang of LANGS)
      expect(linesOf(said(lang, 'mode.matchday'), room, caps('action')), lang).toBe(1);
    // Anti-vacuity: the measurer does break a title that is too long for the room.
    expect(linesOf('Día de partidos de la competición', room, caps('action'))).toBeGreaterThan(1);
  });

  it.each(WIDTHS)('the question’s title is at most 2 lines at %i', (width) => {
    const room = width - 2 * space.md;
    for (const lang of LANGS)
      expect(
        linesOf(said(lang, 'matchday.exit.title'), room, caps('title')),
        lang,
      ).toBeLessThanOrEqual(2);
  });

  it.each(WIDTHS)('every body is at most 5 lines at %i, with a worst count of 99', (width) => {
    const room = width - 2 * space.md;
    for (const lang of LANGS)
      for (const key of [
        'matchday.exit.body',
        'matchday.exit.bodySending.one',
        'matchday.exit.bodySending.other',
        'matchday.exit.bodyAtRisk',
      ])
        expect(
          linesOf(said(lang, key, { count: '99' }), room, body),
          `${lang} ${key}`,
        ).toBeLessThanOrEqual(5);
    expect(linesOf('palabra '.repeat(60).trim(), room, body)).toBeGreaterThan(5);
  });

  it('the plates are one word each, in every language', () => {
    for (const lang of LANGS)
      for (const key of ['matchday.exit.stay', 'matchday.exit.confirm'])
        expect(said(lang, key).includes(' '), `${lang} ${key}`).toBe(false);
  });
});

describe('the Sending card’s words fit (320 and 360 dp, four languages)', () => {
  // Home's padding both sides, then the card's padding and its 1 dp border.
  const room = (width: number) => width - 2 * space.md - 2 * space.md - 2;

  it.each(WIDTHS)('a court’s name is at most 2 lines at %i', (width) => {
    for (const lang of LANGS)
      for (const key of ['matchday.sendingCard.one', 'matchday.sendingCard.other'])
        expect(
          linesOf(said(lang, key, { count: '99', name: 'Court 12' }), room(width), control),
          `${lang} ${key}`,
        ).toBeLessThanOrEqual(2);
  });

  it.each(WIDTHS)('a long name (a match, 30 characters) is at most 3 lines at %i', (width) => {
    const name = 'Ashok / Ravi v Lee / Tan R16';
    for (const lang of LANGS)
      expect(
        linesOf(
          said(lang, 'matchday.sendingCard.other', { count: '99', name }),
          room(width),
          control,
        ),
        lang,
      ).toBeLessThanOrEqual(3);
  });
});
