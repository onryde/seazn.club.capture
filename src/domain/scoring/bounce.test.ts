import { describe, expect, it } from 'vitest';
import { isBounce } from '@/domain/scoring/bounce';

/**
 * The web pad's window (`DOUBLE_SUBMIT_WINDOW_MS`, 250 ms; R7-42): a scorer cannot deliberately repeat a tap that
 * fast, and two real rallies are seconds apart. Written out here, not read from the rule.
 */
describe('isBounce', () => {
  it.each([
    [0, true],
    [1, true],
    [249, true],
    [250, false],
    [3000, false],
  ])('a repeat %i ms after the last is a bounce: %s', (gap, bounce) => {
    expect(isBounce(gap)).toBe(bounce);
  });

  // The wall clock can step back (a network time fix, the operator changing the time): a repeat "before" the last tap
  // is no evidence of one tap read twice, so it counts.
  it.each([-1, -250, -60_000])(
    'a repeat at %i ms, the clock having stepped back, is not a bounce',
    (gap) => {
      expect(isBounce(gap)).toBe(false);
    },
  );
});
