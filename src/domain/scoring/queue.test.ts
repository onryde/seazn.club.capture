import { describe, expect, it } from 'vitest';
import { KEPT_OWN_MS, keptStillMine } from '@/domain/scoring/queue';

// How long a phone keeps the ids of its own taps in a match it left (owner ruling 46, 2026-11-03). Literal numbers:
// the expectations are not worked out from the constant.

const HOUR = 3_600_000;
const LEFT = 1_700_000_000_000;

describe('how long the ids of a left match’s own taps are kept', () => {
  it('is a day', () => {
    expect(KEPT_OWN_MS).toBe(86_400_000);
  });

  it('keeps them the moment the match was left, and an hour later', () => {
    expect(keptStillMine(LEFT, LEFT)).toBe(true);
    expect(keptStillMine(LEFT, LEFT + HOUR)).toBe(true);
  });

  it('keeps them for the whole of the day: exactly 24 h later is not older than 24 h', () => {
    expect(keptStillMine(LEFT, LEFT + 24 * HOUR)).toBe(true);
  });

  it('lets them go once they are older than 24 h, by a millisecond', () => {
    expect(keptStillMine(LEFT, LEFT + 24 * HOUR + 1)).toBe(false);
    expect(keptStillMine(LEFT, LEFT + 30 * 24 * HOUR)).toBe(false);
  });

  it('keeps them across a clock set back a little, and lets a stamp from far in the future go', () => {
    expect(keptStillMine(LEFT, LEFT - HOUR)).toBe(true);
    expect(keptStillMine(LEFT, LEFT - 24 * HOUR)).toBe(true);
    expect(keptStillMine(LEFT, LEFT - 24 * HOUR - 1)).toBe(false);
    expect(keptStillMine(LEFT + 10 ** 12, LEFT)).toBe(false);
  });
});
