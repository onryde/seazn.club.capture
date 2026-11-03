import { describe, expect, it } from 'vitest';
import { POLL_MS, resubscribeWaitMs } from '@/domain/scoring/liveBackoff';

describe('resubscribeWaitMs', () => {
  it('waits 15 s after the first drop, then doubles, to a ceiling of five minutes', () => {
    expect([0, 1, 2, 3, 4].map(resubscribeWaitMs)).toEqual([
      15_000, 30_000, 60_000, 120_000, 300_000,
    ]);
    expect(resubscribeWaitMs(5)).toBe(300_000);
    expect(resubscribeWaitMs(500)).toBe(300_000);
  });

  it('reads a count that is not a whole non-negative number as the first drop or the ceiling, never undefined', () => {
    expect(resubscribeWaitMs(-3)).toBe(15_000);
    expect(resubscribeWaitMs(1.9)).toBe(30_000);
    expect(resubscribeWaitMs(Number.NaN)).toBe(15_000);
  });

  it('polls every 15 s while the channel is down', () => {
    expect(POLL_MS).toBe(15_000);
  });
});
