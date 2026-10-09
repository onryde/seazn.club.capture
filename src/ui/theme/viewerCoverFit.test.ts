import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

/**
 * D2 §4.3: the cover's lines fit the camera box. The narrowest box any window gets is 316.4 dp wide (804 × 332 before
 * the label is measured, C2's worst case: 178 × 16/9, Task 10); 640 × 360's is 330. The honest line and the countdown
 * are one line of `metricUnit` each, inside `space.sm` either side; the loading and not-ready lines are `body`, at most
 * three lines, inside `space.md` either side. Widths are the shipped fonts' (no kerning).
 */
const BOX = 316.4;
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
const unit = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
const body = (text: string) => geist400.width(text, typeScale.body.fontSize);
const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
const fill = (text: string) => text.replace('{seconds}', '20');

describe('the viewer cover’s lines fit the narrowest camera box (D2 §4.3)', () => {
  it.each(LANGUAGES)('%s: the honest line and the countdown are one line each', (_lang, d) => {
    const room = BOX - 2 * space.sm;
    expect(unit(d['stream.peek.honest'])).toBeLessThanOrEqual(room);
    expect(unit(fill(d['stream.peek.closesIn']))).toBeLessThanOrEqual(room);
  });

  it.each(LANGUAGES)(
    '%s: the loading and not-ready lines are at most 3 lines of body',
    (_lang, d) => {
      const room = BOX - 2 * space.md;
      expect(linesOf(fill(d['stream.peek.loading']), room, body)).toBeLessThanOrEqual(3);
      expect(linesOf(d['stream.peek.notReady'], room, body)).toBeLessThanOrEqual(3);
    },
  );

  it('the widest honest line is the French, 238.5 dp, inside 300.4 (anti-vacuity)', () => {
    const widths = LANGUAGES.map(([, d]) => Math.round(unit(d['stream.peek.honest']) * 10) / 10);
    expect(widths).toEqual([213.1, 219.3, 238.5, 214.2]);
  });
});
