import { describe, expect, it } from 'vitest';
import { formatBitrate, formatElapsed, formatRtt } from '@/ui/format';

describe('formatElapsed', () => {
  // Five characters rather than eight, so the clock can be set at 28px in a
  // 150px column instead of 24px. See the note on formatElapsed.
  it('shows minutes and seconds for the first hour', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(59_000)).toBe('00:59');
    expect(formatElapsed(60_000)).toBe('01:00');
    expect(formatElapsed(3_599_000)).toBe('59:59');
  });

  it('grows an hours field exactly once, at the hour', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(2_832_000 + 3_600_000)).toBe('1:47:12');
  });

  it('counts past a long cricket match without padding hours', () => {
    expect(formatElapsed(10 * 3_600_000)).toBe('10:00:00');
  });

  it('clamps a negative clock rather than rendering a minus sign', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
  });
});

describe('formatBitrate', () => {
  it('rounds to whole kilobits', () => {
    expect(formatBitrate(2999.6)).toBe('3000');
  });

  it('never renders a negative rate', () => {
    expect(formatBitrate(-10)).toBe('0');
  });
});

describe('formatRtt', () => {
  it('shows an em dash when there is nothing to measure', () => {
    expect(formatRtt(null)).toBe('—');
  });

  it('rounds a measured round trip', () => {
    expect(formatRtt(47.6)).toBe('48');
  });
});
