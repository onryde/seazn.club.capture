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

// Court stream (spec 2026-11-14 §6.4), on exitFit.test.ts's model: the Leave question is measured from the shipped
// fonts and the dictionaries at the geometry Live Stream is laid out at, 728 × 328 (the owner's phone as laid out, N35;
// Live Stream is landscape only). What is asserted is the room: the title (which wraps for a long court name) and the
// body stay in the lines the sheet has, and the sheet, its two plates in a row under them, is shorter than the screen
// with room for the camera to show above it. Where each line goes on a phone is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const said = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce((all, [k, v]) => all.replaceAll(`{${k}}`, v), text);
};
const barlow700 = loadFont('barlow-condensed-700');
const geist400 = loadFont('geist-400');

const WIDTH = 728;
const HEIGHT = 328;
// The sheet is the pad sheet's shape (padSheet): `space.md` padding all round and `space.sm` between its lines.
const ROOM = WIDTH - 2 * space.md;
/** The longest a court's name is (capture-descriptor.v1 `court.name`, 80 code points), of the widest capital. */
const LONGEST = 'W'.repeat(80);
const title = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.title.fontSize) +
  typeScale.title.letterSpacing * [...text].length;
const body = (text: string) => geist400.width(text, typeScale.body.fontSize);
/** A plate: the lime Button's own height, and the outlined one's, which is a touch target. */
const PLATE = 56;

function sheetHeight(lang: Lang, court: string): { title: number; body: number; height: number } {
  const titleLines = linesOf(said(lang, 'stream.court.leaveTitle', { court }), ROOM, title);
  const bodyLines = linesOf(said(lang, 'stream.court.leaveBody'), ROOM, body);
  const height =
    2 * space.md +
    titleLines * typeScale.title.lineHeight +
    space.sm +
    bodyLines * typeScale.body.lineHeight +
    space.sm +
    PLATE;
  return { title: titleLines, body: bodyLines, height };
}

describe('the Leave question fits at 728 × 328 in four languages', () => {
  it('holds an 80-character court name of the widest capital, wrapped, with the body and both plates', () => {
    for (const lang of LANGS) {
      const { title: titleLines, body: bodyLines, height } = sheetHeight(lang, LONGEST);
      // The name is long enough to wrap in every language (anti-vacuity: the measurer really breaks it).
      expect(titleLines, lang).toBeGreaterThan(1);
      expect(bodyLines, lang).toBeLessThanOrEqual(2);
      // The sheet leaves the camera's top third showing above it.
      expect({ lang, fits: height <= HEIGHT * 0.75 }).toEqual({ lang, fits: true });
    }
  });

  it('is two lines of title at most for a realistic court name (24 characters)', () => {
    for (const lang of LANGS)
      expect(sheetHeight(lang, 'Centre Court, Show Arena').title, lang).toBeLessThanOrEqual(2);
  });

  it('is one line of title for “Court 12”', () => {
    for (const lang of LANGS) expect(sheetHeight(lang, 'Court 12').title, lang).toBe(1);
  });

  it('the plates are one word each, in every language, and the row of two fits the width', () => {
    for (const lang of LANGS)
      for (const key of ['stream.court.stay', 'stream.court.leave'])
        expect(said(lang, key).includes(' '), `${lang} ${key}`).toBe(false);
    // Two plates in a row: Stay's minimum (200) and the outline Leave at the same, a gap between.
    expect(2 * 200 + space.sm).toBeLessThanOrEqual(ROOM);
  });

  it('is shorter than the screen it covers, in every language, with the longest court name and the plates a touch target', () => {
    // The first test holds the sheet to three quarters of the screen; this is the bound the sheet must never pass.
    for (const lang of LANGS) expect(sheetHeight(lang, LONGEST).height, lang).toBeLessThan(HEIGHT);
    // A plate is at least the touch size the layout asks for (the lime Button's 56 and the outline's, one row).
    expect(PLATE).toBeGreaterThanOrEqual(layout.touch);
    expect(HEIGHT).toBe(328);
  });
});
