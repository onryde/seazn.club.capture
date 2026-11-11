import { describe, expect, it } from 'vitest';
import { createLogger } from '@/services/logger';
import { createServerClock } from '@/services/serverClock';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';

/**
 * S2-5 design §7.2: the one offset the phone keeps between its clock and the server's, fed by the scoring port's
 * samples (`offsetSampleOf`). The rule is the domain's (`medianOffset`); this is its state, its listeners and its line
 * in the record: `scoring.clock.offset {ms}` when the estimate first forms, and again when it moves by 2 s or more.
 */
function clockOver() {
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  const clock = createServerClock({ logger });
  const offsetLines = () =>
    record
      .lines()
      .map(parseRecordLine)
      .filter((entry) => entry.event === 'scoring.clock.offset');
  return { clock, offsetLines };
}

describe('createServerClock', () => {
  it('offsetMs is 0 before any sample', () => {
    const { clock, offsetLines } = clockOver();
    expect(clock.offsetMs()).toBe(0);
    expect(offsetLines()).toEqual([]);
  });

  it('offsetMs is the median of the newest five samples', () => {
    const { clock } = clockOver();
    clock.sample(300_500);
    expect(clock.offsetMs()).toBe(300_500);
    for (const sample of [100, 9_000_000, 200, 300]) clock.sample(sample);
    expect(clock.offsetMs()).toBe(300); // [300 500, 100, 9 000 000, 200, 300]
    clock.sample(0);
    clock.sample(0);
    expect(clock.offsetMs()).toBe(200); // [9 000 000, 200, 300, 0, 0]
  });

  it('the first estimate logs scoring.clock.offset once', () => {
    const { clock, offsetLines } = clockOver();
    clock.sample(300_500);
    clock.sample(300_700);
    clock.sample(300_300);
    expect(offsetLines()).toHaveLength(1);
    expect(offsetLines()[0]).toMatchObject({ level: 'info', fields: { ms: 300_500 } });
  });

  it('a move under 2 s logs nothing', () => {
    const { clock, offsetLines } = clockOver();
    clock.sample(0);
    clock.sample(1_999);
    clock.sample(1_999); // the median is 1 999: 1 999 from the 0 logged
    expect(clock.offsetMs()).toBe(1_999);
    expect(offsetLines().map((line) => line.fields.ms)).toEqual([0]);
  });

  it('a move of 2 s exactly logs again', () => {
    const { clock, offsetLines } = clockOver();
    clock.sample(0);
    clock.sample(2_000); // [0, 2 000]: 1 000, under 2 s from 0
    clock.sample(2_000); // [0, 2 000, 2 000]: 2 000, 2 s from 0
    clock.sample(3_900);
    clock.sample(3_900); // [0, 2 000, 2 000, 3 900, 3 900]: 2 000 again
    expect(offsetLines().map((line) => line.fields.ms)).toEqual([0, 2_000]);
  });

  // A slow drift is said once it has come 2 s from what the record last said, not never because each step is small.
  it('the move is measured from the last value logged, not from the last estimate', () => {
    const { clock, offsetLines } = clockOver();
    clock.sample(0);
    clock.sample(3_000); // [0, 3 000]: 1 500, 1.5 s from 0
    expect(clock.offsetMs()).toBe(1_500);
    clock.sample(3_000); // [0, 3 000, 3 000]: 3 000, 1.5 s from 1 500 but 3 s from the 0 logged
    expect(offsetLines().map((line) => line.fields.ms)).toEqual([0, 3_000]);
  });

  it('a negative offset (the phone ahead of the server) is said as it is', () => {
    const { clock, offsetLines } = clockOver();
    clock.sample(-90_000);
    expect(clock.offsetMs()).toBe(-90_000);
    expect(offsetLines()[0]?.fields.ms).toBe(-90_000);
  });

  it('a subscriber hears each change of the offset, not a sample that leaves it where it was', () => {
    const { clock } = clockOver();
    let heard = 0;
    clock.subscribe(() => {
      heard += 1;
    });
    clock.sample(1_000);
    expect(heard).toBe(1);
    clock.sample(1_000); // still 1 000
    expect(heard).toBe(1);
    clock.sample(3_000); // [1 000, 1 000, 3 000]: still 1 000
    expect(heard).toBe(1);
    clock.sample(3_000); // [1 000, 1 000, 3 000, 3 000]: 2 000
    expect(heard).toBe(2);
  });

  it('an unsubscribed listener hears nothing more, and another stays subscribed', () => {
    const { clock } = clockOver();
    const heard: string[] = [];
    const leave = clock.subscribe(() => heard.push('first'));
    clock.subscribe(() => heard.push('second'));
    clock.sample(1_000);
    leave();
    clock.sample(5_000);
    expect(heard).toEqual(['first', 'second', 'second']);
  });

  // Ruling 141: at a return to the foreground the steady clock may have moved by a sleep or a jump made while away, so
  // the samples taken before it no longer measure it. The window is dropped; the offset stays until the next answer,
  // whose one sample then decides.
  it('dropSamples keeps the offset until the next sample, which alone decides', () => {
    const { clock, offsetLines } = clockOver();
    for (const sample of [1_000, 1_000, 1_000, 1_000, 1_000]) clock.sample(sample);
    clock.dropSamples();
    expect(clock.offsetMs()).toBe(1_000);
    clock.sample(-297_000);
    expect(clock.offsetMs()).toBe(-297_000);
    clock.sample(-297_200); // [-297 000, -297 200]: the rounded mean, the old samples gone
    expect(clock.offsetMs()).toBe(-297_100);
    expect(offsetLines().map((line) => line.fields.ms)).toEqual([1_000, -297_000]);
  });

  it('dropSamples before any sample leaves 0, and a second drop changes nothing', () => {
    const { clock } = clockOver();
    clock.dropSamples();
    clock.dropSamples();
    expect(clock.offsetMs()).toBe(0);
    clock.sample(4_000);
    expect(clock.offsetMs()).toBe(4_000);
  });
});
