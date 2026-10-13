import { describe, expect, it } from 'vitest';
import { colour } from '@/ui/theme/tokens';

/** The web's cream (`--mk-cream`, AGENTS §5), written out: a test that read it from the tokens would prove them equal to themselves. */
const CREAM = '#f5f0e8';

/** The alpha of a cream-with-alpha token, as `rule` is written: the cream's hex and one alpha byte, to two places. */
function creamAlpha(token: string): number {
  expect(token).toHaveLength(9);
  expect(token.slice(0, 7)).toBe(CREAM);
  return Math.round((parseInt(token.slice(7), 16) / 255) * 100) / 100;
}

describe('colour.pressFill (the controller’s ruling P8, Batch 17)', () => {
  it('is derived as rule is: the cream with an alpha byte (rule is the cream at 8%)', () => {
    expect(colour.ink).toBe(CREAM);
    expect(creamAlpha(colour.rule)).toBe(0.08); // anti-vacuity: the reading gives rule's documented 8%
  });

  it('is the cream at 20% alpha', () => {
    expect(creamAlpha(colour.pressFill)).toBe(0.2);
  });
});
