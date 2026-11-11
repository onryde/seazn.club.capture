import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { DEVICE_ADVANCE, smallLabelFit, SMALL_WORD_WIDTH } from '@/ui/theme/columnBoard';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

// Build 1060 (NE2211, 412 dp): "YELLOW" read "YELLO" in a 54 dp square (room 46 inside the outline and the inset), with
// the runtime shrink not taking effect. The size is now computed from the measured square and the word's width. The
// widths below are literal, Barlow Condensed 600 at 14, upper case, no letterspacing (read from the font file in the last
// test); on the device RED and SUB drew 7 to 9 % wider than those advances, which `DEVICE_ADVANCE` carries.
const SIDE = { 320: 38.7, 360: 45.3, 412: 54 } as const;
const WORDS = {
  en: { sub: 'Sub' },
  es: { sub: 'Cambio' },
  fr: { sub: 'Rempl.' },
  nl: { sub: 'Wissel' },
} as const;
const BASE = typeScale.diagSection.fontSize;

describe('smallLabelFit', () => {
  it('the device factor is 1.1 and the inset and floor are the tokens', () => {
    expect(DEVICE_ADVANCE).toBe(1.1);
    expect(layout.padSquareLabelInset).toBe(3);
    expect(layout.cardLabelFloor).toBe(0.75);
    expect(BASE).toBe(14);
  });

  // Owner ruling 163 took the Yellow and Red words off; Sub's remain, and Cambio (es, 36.5 dp) is the widest.
  it('CAMBIO at 412: 54 dp square, room 46, the word 36.5 x 1.1 = 40.2 fits at full size with its inset', () => {
    expect(smallLabelFit(SIDE[412], 'Cambio')).toEqual({ fontSize: 14, inset: 3 });
  });

  it('CAMBIO at 360 shrinks to 13 dp (room 37.3 of 40.2 is 0.93, 13.0 floored), inset kept', () => {
    expect(smallLabelFit(SIDE[360], 'Cambio')).toEqual({ fontSize: 13, inset: 3 });
  });

  it('CAMBIO at 320 shrinks to 10 dp (room 30.7 of 40.2 is 0.76, 10.7 floored), inset kept', () => {
    expect(smallLabelFit(SIDE[320], 'Cambio')).toEqual({ fontSize: 10, inset: 3 });
  });

  it('a word that fits is never grown, and an unmeasured square (width 0) keeps the token size', () => {
    expect(smallLabelFit(SIDE[412], 'Sub').fontSize).toBe(14);
    expect(smallLabelFit(0, 'Cambio')).toEqual({ fontSize: 14, inset: 3 });
  });

  it.each(Object.entries(WORDS))(
    '%s: every word fits inside its square at 320, 360 and 412, never under the floor',
    (_lang, words) => {
      for (const word of Object.values(words))
        for (const side of Object.values(SIDE)) {
          const fit = smallLabelFit(side, word);
          const drawn =
            SMALL_WORD_WIDTH[word.toUpperCase()]! * DEVICE_ADVANCE * (fit.fontSize / BASE);
          expect(fit.fontSize, `${word} @${side}`).toBeGreaterThanOrEqual(
            Math.floor(BASE * layout.cardLabelFloor),
          );
          expect(drawn + 2 * fit.inset, `${word} @${side}`).toBeLessThanOrEqual(
            side - 2 * layout.iconBorder + 0.001,
          );
          expect(fit.inset, `${word} @${side}`).toBeGreaterThanOrEqual(1);
        }
    },
  );

  it('the table is the font file’s measure, and holds every Sub word of the four dictionaries', () => {
    const font = loadFont('barlow-condensed-600');
    for (const dictionary of [en, es, fr, nl] as const)
      for (const key of ['sub'] as const) {
        const word = (dictionary as Record<string, string>)[
          `scoring.football.column.${key}`
        ]!.toUpperCase();
        expect(SMALL_WORD_WIDTH[word], word).toBeDefined();
        expect(SMALL_WORD_WIDTH[word]!, word).toBeCloseTo(font.width(word, BASE), 1);
      }
    expect(space.xs).toBe(4);
  });
});
