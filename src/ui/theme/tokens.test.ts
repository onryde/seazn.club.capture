import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colour } from '@/ui/theme/tokens';

/** The web's cream (`--mk-cream`, AGENTS §5), written out: a test that read it from the tokens would prove them equal to themselves. */
const CREAM = '#f5f0e8';

/** The alpha byte of a cream-with-alpha token, as `rule` is written: the cream's hex, then one alpha byte in hex. */
function creamAlphaByte(token: string): string {
  expect(token).toHaveLength(9);
  expect(token.slice(0, 7)).toBe(CREAM);
  return token.slice(7);
}

/** That byte as a fraction, to two places: how the tokens' comments state it. */
const percent = (byte: string) => Math.round((parseInt(byte, 16) / 255) * 100) / 100;

describe('colour.pressFill: the controller’s press-fill ruling (2026-10-13)', () => {
  it('is derived as rule is: the cream with an alpha byte (rule is the cream at 8%)', () => {
    expect(colour.ink).toBe(CREAM);
    expect(percent(creamAlphaByte(colour.rule))).toBe(0.08); // anti-vacuity: the reading gives rule's documented 8%
  });

  // The byte exactly, not its rounding: 0x32 and 0x34 also read as 20% to two places (the Batch 17 review's minor).
  it('is the cream at 20% alpha, the byte 0x33', () => {
    expect(creamAlphaByte(colour.pressFill)).toBe('33');
    expect(percent(creamAlphaByte(colour.pressFill))).toBe(0.2);
  });
});

describe('the card tokens: owner ruling 56 (2026-11-04)', () => {
  // The web's `--sport-caution` and `--sport-dismissal` (seazn.club apps/web/src/app/globals.css:1180-1181), written out.
  it('are the web’s card palette: an amber for the caution, a red for the dismissal', () => {
    expect(colour.cardCaution).toBe('#d97706');
    expect(colour.cardDismissal).toBe('#dc2626');
  });

  it('are not the ON AIR red, the app’s caution orange, or each other (AGENTS §5: red means ON AIR)', () => {
    const others = [colour.live, colour.caution, colour.lime, colour.ink3];
    expect(others).not.toContain(colour.cardCaution);
    expect(others).not.toContain(colour.cardDismissal);
    expect(colour.cardCaution).not.toBe(colour.cardDismissal);
  });

  /** Every source file under `dir`, tests and the token file itself left out. */
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      const test = /\.test\.tsx?$/.test(entry.name);
      return !test && /\.tsx?$/.test(entry.name) && entry.name !== 'tokens.ts' ? [path] : [];
    });

  // "Used only by the card icon": one component draws a card, and nothing else reaches for these two colours.
  it('are used by the half’s card icon alone', () => {
    const users = sources(join(__dirname, '..', '..'))
      .filter((path) => /cardCaution|cardDismissal/.test(readFileSync(path, 'utf8')))
      .map((path) => path.split('/').pop());
    expect(users).toEqual(['ScoreHalf.tsx']);
  });
});
