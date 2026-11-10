import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { linesOf } from '../../../test/textFit';
import {
  LANGUAGES,
  WIDTHS,
  barlow700,
  column,
  cricketKeys,
  fill,
  geist400,
  labelWidth,
  nameRoom,
  ownsKey,
  reader,
  unmeasured,
} from './cricketFit.testkit';

// S2-4 fit tests, over totals (plan Task 17), the entry in the keys' place.

const { said, swept } = reader();

// S2-4 plan Task 17: over totals (the entry in the keys' place) at 320 and 360 dp in four languages. The
// note is `body` text and may take three lines; the heading is one line (`panelTitle`);
// each field's name is one line in what a row leaves it beside two steppers and the figure; Record over is one line in its
// plate. The steppers' spoken labels are never drawn: they carry the field's name in the dictionary's own place for it.
const TOTALS_NOTES = ['noPlayers', 'stays', 'tied'].map((key) => `scoring.cricket.totals.${key}`);
const TOTALS_FIELDS = ['runs', 'wickets', 'balls'].map((key) => `scoring.cricket.totals.${key}`);
const TOTALS_SPOKEN = ['less', 'more'].map((key) => `scoring.cricket.totals.${key}`);
/** The longest over a format can number: two digits do for any overs but an unlimited match's, whose numbers stay small. */
const OVER_NUMBER = 99;

describe.each(WIDTHS)('over totals at %i dp', (width) => {
  const caps = (role: 'panelTitle' | 'action') => (text: string) =>
    barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
    typeScale[role].letterSpacing * [...text].length;
  const bodyWidth = (text: string) => geist400.width(text, typeScale.body.fontSize);
  /** A field's row: its name, then − (a touch wide), the figure (a touch wide) and +, `space.sm` apart. */
  const nameRoom = column(width) - 3 * layout.touch - 3 * space.sm;

  it.each(LANGUAGES)(
    '%s: each note keeps its words whole, three lines at most',
    (_, dictionary) => {
      for (const key of TOTALS_NOTES) {
        const note = said(dictionary, key);
        for (const word of note.split(' ')) {
          expect(bodyWidth(word), word).toBeLessThanOrEqual(column(width));
        }
        expect(linesOf(note, column(width), bodyWidth), note).toBeLessThanOrEqual(3);
      }
    },
  );

  it.each(LANGUAGES)('%s: the heading is one line on the pad', (_, dictionary) => {
    const heading = fill(said(dictionary, 'scoring.cricket.totals.title'), {
      number: OVER_NUMBER,
    });
    expect(linesOf(heading, column(width), caps('panelTitle')), heading).toBe(1);
  });

  it.each(LANGUAGES)('%s: each field’s name is one line beside the steppers', (_, dictionary) => {
    for (const key of TOTALS_FIELDS) {
      const name = said(dictionary, key);
      expect(labelWidth(name), name).toBeLessThanOrEqual(nameRoom);
    }
  });

  it.each(LANGUAGES)('%s: Record over is one line in its button', (_, dictionary) => {
    const label = said(dictionary, 'scoring.cricket.totals.record');
    const room = column(width) - 2 * space.xl;
    expect(linesOf(label, room, caps('action')), label).toBe(1);
  });

  it.each(LANGUAGES)('%s: a stepper’s spoken label names its field', (_, dictionary) => {
    for (const key of TOTALS_SPOKEN) expect(said(dictionary, key), key).toContain('{field}');
  });
});

describe('over totals on the pad', () => {
  /**
   * The totals body is the score panel, the note (three lines at most), the heading, three rows of a touch and Record over
   * (a plate of 56), `space.sm` apart. The keys' body is the board and the keys: 285 and 256. It fits wherever those fit.
   */
  it('the score, the note, the entry and Record over are shorter than the board and the keys', () => {
    const rows = 3 * layout.touch + 2 * space.sm;
    const totals =
      layout.scorePanel +
      space.sm +
      3 * typeScale.body.lineHeight +
      space.sm +
      typeScale.panelTitle.lineHeight +
      space.sm +
      rows +
      space.sm +
      56;
    const keysBody = 285 + space.sm + 256;
    expect(totals).toBe(134 + 8 + 66 + 8 + 24 + 8 + 160 + 8 + 56);
    expect(totals).toBeLessThan(keysBody);
  });

  it('the longest note takes two lines at 320 in some language (anti-vacuity: it is measured)', () => {
    const most = Math.max(
      ...LANGUAGES.flatMap(([, dictionary]) =>
        TOTALS_NOTES.map((key) =>
          linesOf(said(dictionary, key), column(320), (text) =>
            geist400.width(text, typeScale.body.fontSize),
          ),
        ),
      ),
    );
    expect(most).toBeGreaterThanOrEqual(2);
  });
});

// The sweep (plan Task 18): every key this file owns (`OWNED.totals` in the kit) was read by a fit case above, through `said`.
// A key added to the dictionaries with no fit case is a red test, listed by name. It runs last and relies on the file's
// order, so a run filtered by name (`-t`) fails it: run the file whole.
describe('the sweep', () => {
  it('every scoring.cricket key this file owns has a fit case', () => {
    const owned = cricketKeys().filter((key) => ownsKey('totals', key));
    expect(owned.length).toBeGreaterThan(0);
    expect(unmeasured(owned, swept)).toEqual([]);
  });
});
