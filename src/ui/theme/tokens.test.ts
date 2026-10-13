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

describe('colour.pressFill (the controller’s ruling P8, Batch 17)', () => {
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
