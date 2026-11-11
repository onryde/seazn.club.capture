import { describe, expect, it } from 'vitest';
import { medianOffset, offsetSampleOf } from '@/domain/scoring/serverOffset';

/**
 * S2-5 design §7.2 (ruling 107) and the controller's ruling X-5: the web's offset rule, exactly, so the phone and the
 * console read one shared clock. A sample is the `Date` header's second + 500 ms, less the request's midpoint on the
 * phone's clock; the offset is the median of the newest five. Every expected value is worked from that rule by hand
 * and written out, never computed by the code under test.
 */
const S = Date.UTC(2026, 10, 7, 12, 0, 0); // the server's whole second
const DATE = 'Sat, 07 Nov 2026 12:00:00 GMT'; // the same second, as the header says it

describe('offsetSampleOf', () => {
  it('one sample at rtt 0 is serverMs − sentAt + 500', () => {
    const sentAt = S - 300_000; // the phone five minutes slow
    expect(offsetSampleOf(DATE, sentAt, sentAt)).toBe(300_500);
    expect(offsetSampleOf(DATE, S, S)).toBe(500);
  });

  it('a sample is taken against the request’s midpoint on the phone’s clock', () => {
    expect(offsetSampleOf(DATE, S - 300_100, S - 299_900)).toBe(300_500); // phone 5 min slow, rtt 200
    expect(offsetSampleOf(DATE, S + 1_400, S + 1_600)).toBe(-1_000); // phone a second fast
    expect(offsetSampleOf(DATE, S - 4_000, S)).toBe(2_500); // midpoint S − 2 000
  });

  it('a round trip over 5 s gives no sample', () => {
    expect(offsetSampleOf(DATE, S, S + 5_001)).toBeUndefined();
    expect(offsetSampleOf(DATE, S, S + 5_000)).toBe(-2_000); // at the cap, a sample: S + 500 − (S + 2 500)
  });

  it('a negative round trip gives no sample', () => {
    expect(offsetSampleOf(DATE, S, S - 1)).toBeUndefined();
  });

  it('no Date header, or one that is no date, gives no sample', () => {
    expect(offsetSampleOf(null, S, S + 100)).toBeUndefined();
    expect(offsetSampleOf('garbage', S, S + 100)).toBeUndefined();
    expect(offsetSampleOf('', S, S + 100)).toBeUndefined();
  });
});

describe('medianOffset', () => {
  it('no samples is null', () => {
    expect(medianOffset([])).toBeNull();
  });

  it('one sample is the offset', () => {
    expect(medianOffset([300_500])).toBe(300_500);
    expect(medianOffset([-250])).toBe(-250);
  });

  // The phone's clock is 300 000 ms behind the server's. Each answer is stamped by the server at the request's midpoint,
  // its sub-second phase 0.1, 0.3, 0.5, 0.7 and 0.9 s, so the header (whole seconds) is 100…900 ms behind the stamp.
  it('the median of five converges', () => {
    const samples = [100, 300, 500, 700, 900].map((phase, i) => {
      const second = S + i * 1_000;
      const midpoint = second + phase - 300_000; // the phone's clock at the server's stamp
      const header = new Date(second).toUTCString();
      return offsetSampleOf(header, midpoint - 50, midpoint + 50);
    });
    expect(samples).not.toContain(undefined);
    const offset = medianOffset(samples as number[]);
    expect(offset).not.toBeNull();
    expect(Math.abs((offset ?? 0) - 300_000)).toBeLessThanOrEqual(300);
  });

  it('a clock jump is followed once three of five samples agree', () => {
    const before = [500, 500, 500];
    expect(medianOffset([...before, 300_500, 300_500])).toBe(500); // only two since the jump
    expect(medianOffset([...before, 300_500, 300_500, 300_500])).toBe(300_500);
  });

  it('only the newest 5 count', () => {
    expect(medianOffset([1_000, 1_000, 1_000, 1_000, 1_000])).toBe(1_000);
    expect(medianOffset([1_000, 1_000, 1_000, 0, 0, 0])).toBe(0); // the first 1 000 is out: [1 000, 1 000, 0, 0, 0]
    expect(medianOffset([9_000_000, 1, 2, 3, 4, 5])).toBe(3);
  });

  it('an even count takes the rounded mean of the middle two', () => {
    expect(medianOffset([1_000, 3_000])).toBe(2_000);
    expect(medianOffset([1, 2])).toBe(2); // 1.5 rounds to 2
    expect(medianOffset([-250, 0, 20, 10])).toBe(5); // sorted −250, 0, 10, 20: the middle two 0 and 10
  });

  it('one outlier cannot move it', () => {
    expect(medianOffset([100, 9_000_000, 200, 300, 400])).toBe(300);
  });

  it('does not reorder the samples it is given', () => {
    const samples = [300, 100, 200];
    medianOffset(samples);
    expect(samples).toEqual([300, 100, 200]);
  });
});
