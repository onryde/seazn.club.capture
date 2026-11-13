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

// MD-2 Task 8e: calling a match to a court (S4 design §7a), the words at 320 and 360 dp upright in all four languages,
// from the shipped fonts and the dictionaries (as approvalFit.test.ts measures the review). What is asserted is the room
// a word has: plates and buttons are one line, and the sentences that wrap stay within the lines the sheet has room
// for, with the worst fills (a long court, a doubles pair). Where each line goes on a phone is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const said = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce((all, [k, v]) => all.replaceAll(`{${k}}`, v), text);
};
const barlow700 = loadFont('barlow-condensed-700');
const geist500 = loadFont('geist-500');

const WIDTHS = [320, 360] as const;
const column = (width: number) => width - 2 * space.md;
const action = (text: string): number =>
  barlow700.width(text.toUpperCase(), typeScale.action.fontSize) +
  typeScale.action.letterSpacing * text.length;
const control = (text: string): number => geist500.width(text, typeScale.control.fontSize);

const COURT = 'Court 12';
const PAIR = 'Ashok Kumar / Ravi Menon';

describe('the call sheet’s words fit (320 and 360 dp, four languages)', () => {
  it.each(WIDTHS)('the plate "Hold to call" is one line in its plate at %i', (width) => {
    const room = column(width) - 2 * space.sm - 2 * 2;
    for (const lang of LANGS)
      expect(linesOf(said(lang, 'matchday.call.hold'), room, action), lang).toBe(1);
    expect(linesOf('Hold to call '.repeat(8).trim(), room, action)).toBeGreaterThan(1);
  });

  it.each(WIDTHS)('"Calling…", the plate’s reason, is one line at %i', (width) => {
    for (const lang of LANGS)
      expect(linesOf(said(lang, 'matchday.call.calling'), column(width), control), lang).toBe(1);
  });

  it.each(WIDTHS)('the buttons’ labels are one line in their ghost at %i', (width) => {
    const room = column(width) - 2 * space.md - 2 * layout.iconBorder;
    for (const lang of LANGS)
      for (const key of [
        'matchday.call.action',
        'matchday.call.other',
        'matchday.call.undo',
        'matchday.call.keep',
        'matchday.call.close',
      ])
        expect(linesOf(said(lang, key), room, control), `${lang} ${key}`).toBe(1);
    expect(linesOf('Wedstrijd oproepen '.repeat(8).trim(), room, control)).toBeGreaterThan(1);
  });

  it.each(WIDTHS)('the title "Call to {court}" is at most 2 lines beside Back at %i', (width) => {
    const room = width - 2 * space.md - layout.iconButton - space.md;
    for (const lang of LANGS)
      expect(
        linesOf(said(lang, 'matchday.call.title', { court: COURT }), room, action),
        lang,
      ).toBeLessThanOrEqual(2);
  });

  it.each(WIDTHS)(
    'Undo call’s question is at most 2 lines and its body at most 4 at %i',
    (width) => {
      const room = column(width);
      for (const lang of LANGS) {
        expect(
          linesOf(said(lang, 'matchday.call.undoTitle'), room, action),
          `${lang} title`,
        ).toBeLessThanOrEqual(2);
        const body = said(lang, 'matchday.call.undoBody', { match: `${PAIR} v ${PAIR}` });
        expect(linesOf(body, room, control), `${lang} body`).toBeLessThanOrEqual(4);
      }
    },
  );

  it('Undo call’s spoken name carries its court in all four languages, and is not drawn (final review m3)', () => {
    for (const lang of LANGS) {
      const named = said(lang, 'matchday.call.undoNamed', { court: COURT });
      expect(named, lang).toContain(COURT);
      expect(named, lang).toContain(said(lang, 'matchday.call.undo'));
    }
  });

  it.each(WIDTHS)('every sentence the sheet says stays within 3 lines at %i', (width) => {
    for (const lang of LANGS)
      for (const key of [
        'matchday.call.loading',
        'matchday.call.none',
        'matchday.call.checking',
        'matchday.call.quiet',
        'matchday.call.pushes.one',
        'matchday.call.pushes.other',
        'matchday.call.pastEnd',
        'matchday.call.closure',
        'matchday.call.rest',
        'matchday.call.closed',
        'matchday.call.notFree',
        'matchday.call.undoGone',
        'matchday.call.noPower',
        'matchday.call.courtOutOfScope',
        'matchday.call.started',
        'matchday.call.moved',
        'matchday.call.courtBusy',
        'matchday.call.notReady',
        'matchday.call.frozen',
        'matchday.call.notCandidate',
        'matchday.call.notCodeCall',
        'matchday.call.busy',
        'matchday.call.busyNoCourt',
      ])
        expect(
          linesOf(
            said(lang, key, { court: COURT, name: PAIR, count: '12', match: PAIR }),
            column(width),
            control,
          ),
          `${lang} ${key}`,
        ).toBeLessThanOrEqual(3);
    expect(linesOf('palabra '.repeat(60).trim(), column(width), control)).toBeGreaterThan(3);
  });

  it.each(WIDTHS)(
    'a candidate’s place and reason are at most 3 lines under its names at %i',
    (width) => {
      // The card's padding and border both sides, then the label column and its gap that the lines sit past.
      const room =
        column(width) -
        2 * layout.matchDayCardPad -
        2 * layout.cardBorder -
        layout.matchDayRowLabel -
        space.sm;
      for (const lang of LANGS)
        for (const key of ['matchday.call.nextOn', 'matchday.noCourt', 'matchday.call.busy'])
          expect(
            linesOf(said(lang, key, { court: COURT, name: PAIR }), room, control),
            `${lang} ${key}`,
          ).toBeLessThanOrEqual(3);
    },
  );
});
