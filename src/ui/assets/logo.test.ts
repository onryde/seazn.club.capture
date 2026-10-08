import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { LANGS } from '@/i18n/language';
import { layout } from '@/ui/theme/tokens';

const png = readFileSync(new URL('./logo-wide-night.png', import.meta.url));

describe('the Seazn Club night logo (spec §7)', () => {
  it("is the web repo's file, byte for byte", () => {
    // sha256 of seazn.club apps/web/public/logo-wide-night.png, read 2026-10-06 (800 × 280, 19.9 KB)
    expect(createHash('sha256').update(png).digest('hex')).toBe(
      'bee2648f76fa2590ac81d2c1e14050fe4c62687b8630437b0d6e6b080c2f90e8',
    );
  });

  it("is drawn at spec §7's 200 × 70 in portrait and Q2's 160 × 56 in landscape, its own aspect", () => {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20); // the PNG IHDR
    expect([width, height]).toEqual([800, 280]);
    expect(layout.logo).toEqual({ width: 200, height: 70 });
    expect(layout.logoLandscape).toEqual({ width: 160, height: 56 });
    for (const drawn of [layout.logo, layout.logoLandscape]) {
      expect(width / height).toBeCloseTo(drawn.width / drawn.height, 6);
    }
  });

  it('is named "Seazn Club" in all four languages: a brand is never translated', () => {
    const brands = { en, es, fr, nl };
    expect(LANGS).toHaveLength(4);
    for (const lang of LANGS)
      expect({ lang, brand: brands[lang].brand }).toEqual({ lang, brand: 'Seazn Club' });
  });
});
