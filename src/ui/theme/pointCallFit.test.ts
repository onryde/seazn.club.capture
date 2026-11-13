import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

// The call plate in a half's bottom row (owner, 2026-11-13: game point and match point, "inside the box"). The
// row is the finished games' boxes (never cut, owner ruling 16), a gap, the plate and "Tap", which gives way. The rooms are
// written out from the tokens and the type scale, the widths measured from the fonts the app ships, the copy read from the
// dictionaries; nothing is read from the components. Whether it looks right on a phone is the device check's.

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
const CALLS = ['gamePoint', 'matchPoint'] as const;
const WIDTHS = [320, 360] as const;

const barlow700 = loadFont('barlow-condensed-700');
/** `state`: the plate's word, Barlow Condensed 700 at 15, uppercase, letter-spaced (as the serving plate's). */
const wordWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * [...text].length;

/** Inside a half: the column less the side bar and the half's padding (space.md a side). */
const halfInner = (width: number) => width - 2 * space.md - layout.padSideBar - 2 * space.md;
/** `n` boxes, `space.xs` apart. */
const boxes = (n: number) => n * layout.padPeriodBox + (n - 1) * space.xs;

/** The share of its own width the word keeps beside `n` boxes: 1 when the plate is whole. */
const kept = (width: number, n: number, word: string) =>
  Math.min(1, (halfInner(width) - boxes(n) - space.sm - 2 * space.sm) / wordWidth(word));

const word = (dictionary: Readonly<Record<string, string>>, call: (typeof CALLS)[number]) =>
  dictionary[`scoring.pad.call.${call}`] ?? '';

/** Every language and call whose word is cut below `floor` (the kit's `CALL_MIN_SCALE`) beside `n` boxes, at `width`. */
const below = (floor: number, width: number, n: number) =>
  LANGUAGES.flatMap(([lang, dictionary]) =>
    CALLS.filter((call) => kept(width, n, word(dictionary, call)) < floor).map(
      (call) => `${lang} ${call}`,
    ),
  );
/** Those that are not whole at all. */
const shrunk = (width: number, n: number) => below(1, width, n);

describe('the call plate in the bottom row', () => {
  it('lets the word shrink to 0.7 of its size, the floor the rows below are judged against', () => {
    expect(layout.padCallMinScale).toBe(0.7);
  });

  it('has 252 and 292 dp inside a half at 320 and 360', () => {
    expect(WIDTHS.map(halfInner)).toEqual([252, 292]);
  });

  it('costs no height: a plate is the state line, no taller than the row’s own control line', () => {
    expect(typeScale.state.lineHeight).toBeLessThanOrEqual(typeScale.control.lineHeight);
  });

  it('says it in all four languages (anti-vacuity: the three calls have words)', () => {
    for (const [, dictionary] of LANGUAGES)
      for (const call of CALLS) expect(word(dictionary, call).length).toBeGreaterThan(0);
  });

  // Badminton's best of 3 has two boxes at most beside a call; table tennis's best of 5 four; its best of 7 six.
  it('holds every call whole beside up to three boxes, at 320 and 360, in four languages', () => {
    for (const n of [1, 2, 3])
      for (const width of WIDTHS) expect(shrunk(width, n), `${n} boxes at ${width}`).toEqual([]);
  });

  // The kit's rule: the boxes are never cut; the hint goes first, then the doubles server, then the plate's word shrinks
  // (Android's `adjustsFontSizeToFit`, one line, to `CALL_MIN_SCALE` 0.7), and past that it is cut with an ellipsis.
  it('shrinks only Spanish “Punto de partido” beside four boxes (a table tennis best of 5 at 2-2), at 320 alone', () => {
    expect(shrunk(320, 4)).toEqual(['es matchPoint']);
    expect(shrunk(360, 4)).toEqual([]);
    expect(kept(320, 4, word(es, 'matchPoint'))).toBeGreaterThan(0.9);
  });

  it('holds five boxes (the best of 7 after five games) whole at 360, and at 320 shrinks five words, none below 0.7 but one', () => {
    expect(shrunk(360, 5)).toEqual([]);
    expect(shrunk(320, 5)).toEqual([
      'en matchPoint',
      'es gamePoint',
      'es matchPoint',
      'fr gamePoint',
      'fr matchPoint',
    ]);
    expect(below(0.7, 320, 5)).toEqual(['es matchPoint']);
  });

  // Six boxes is table tennis's best of 7 in its deciding game, the widest row there is.
  it('shrinks Spanish and French “match” beside six boxes at 360, cutting none; at 320 it cannot fit the words (a device check)', () => {
    expect(shrunk(360, 6)).toEqual(['es gamePoint', 'es matchPoint', 'fr matchPoint']);
    expect(below(0.7, 360, 6)).toEqual([]);
    expect(below(0.7, 320, 6)).toHaveLength(7);
    expect(below(0.7, 320, 6)).not.toContain('nl gamePoint');
  });

  it('is cut only where table tennis plays seven games, since no other row has more than four boxes', () => {
    // Badminton: a best of 5 has at most four games over beside a call; table tennis: a best of 5 four, a best of 7 six.
    const fourOrFewer = [1, 2, 3, 4].flatMap((n) => below(0.7, 320, n));
    expect(fourOrFewer).toEqual([]);
  });
});
