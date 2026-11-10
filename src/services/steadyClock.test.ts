import { describe, expect, it } from 'vitest';
import { createLogger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { createSteadyClock, monotonicOf } from '@/services/steadyClock';

/**
 * The football clock's "device now" (controller ruling 137, device finding F5): the wall clock read once, run on by a
 * monotonic source, so a wall clock set by hand, by NTP or by a time zone mid-match moves nothing. Its record lines:
 * `scoring.clock.jump {ms}` when the wall moves 2 s or more against it, and `scoring.clock.steady {monotonic: false}`
 * when the platform has no monotonic source and it reads the wall clock.
 */
const T0 = Date.parse('2026-11-10T14:00:00.000Z');

function rig(options: { readonly mono?: boolean } = {}) {
  let wallMs = T0;
  let monoMs = 1_234.5; // performance.now() counts from the runtime's start, never from the epoch
  let onReturn: (() => void) | null = null;
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  const steady = createSteadyClock({
    wall: () => wallMs,
    mono: options.mono === false ? null : () => monoMs,
    logger,
    foreground: {
      subscribe: (listener) => {
        onReturn = listener;
        return () => undefined;
      },
    },
  });
  const lines = (event: string) =>
    record
      .lines()
      .map(parseRecordLine)
      .filter((entry) => entry.event === event);
  return {
    steady,
    lines,
    /** Real time passes: both clocks move together. */
    pass: (ms: number) => {
      wallMs += ms;
      monoMs += ms;
    },
    /** The wall clock alone moves: a hand-set time, NTP, a zone change. */
    jump: (ms: number) => {
      wallMs += ms;
    },
    /** The CPU slept: the wall clock ran on, the monotonic source did not. */
    sleep: (ms: number) => {
      wallMs += ms;
    },
    returns: () => onReturn?.(),
  };
}

describe('createSteadyClock', () => {
  it('reads the wall clock at its creation', () => {
    const { steady } = rig();
    expect(steady.nowMs()).toBe(T0);
  });

  it('runs on with the monotonic source', () => {
    const { steady, pass } = rig();
    pass(61_000);
    expect(steady.nowMs()).toBe(T0 + 61_000);
  });

  it('a wall jump of +5 min leaves its reading where it was, and it runs on', () => {
    const { steady, pass, jump } = rig();
    pass(30_000);
    jump(300_000);
    expect(steady.nowMs()).toBe(T0 + 30_000);
    pass(10_000);
    expect(steady.nowMs()).toBe(T0 + 40_000);
  });

  it('a wall jump of −5 min leaves its reading where it was, and it runs on', () => {
    const { steady, pass, jump } = rig();
    pass(30_000);
    jump(-300_000);
    expect(steady.nowMs()).toBe(T0 + 30_000);
    pass(10_000);
    expect(steady.nowMs()).toBe(T0 + 40_000);
  });

  it('says scoring.clock.jump {ms} once per jump of 2 s or more, read at a reading', () => {
    const { steady, jump, lines } = rig();
    jump(298_000);
    steady.nowMs();
    steady.nowMs();
    jump(-298_000);
    steady.nowMs();
    expect(lines('scoring.clock.jump').map((line) => line.fields)).toEqual([
      { ms: 298_000 },
      { ms: -298_000 },
    ]);
  });

  it('a wall move under 2 s says nothing; 2 s exactly does', () => {
    const { steady, jump, lines } = rig();
    jump(1_999);
    steady.nowMs();
    expect(lines('scoring.clock.jump')).toEqual([]);
    jump(1);
    steady.nowMs();
    expect(lines('scoring.clock.jump').map((line) => line.fields)).toEqual([{ ms: 2_000 }]);
  });

  it('at a return to the foreground, catches up the time the CPU slept', () => {
    const { steady, pass, sleep, returns } = rig();
    pass(10_000);
    sleep(600_000);
    expect(steady.nowMs()).toBe(T0 + 10_000);
    returns();
    expect(steady.nowMs()).toBe(T0 + 610_000);
    pass(1_000);
    expect(steady.nowMs()).toBe(T0 + 611_000);
  });

  it('a return never follows a wall clock set back while away (no sleep runs it backwards)', () => {
    const { steady, pass, jump, returns } = rig();
    pass(10_000);
    jump(-298_000);
    returns();
    expect(steady.nowMs()).toBe(T0 + 10_000);
  });

  it('the catch-up at a return is said once, and the next reading says nothing more', () => {
    const { steady, sleep, returns, lines } = rig();
    sleep(600_000);
    returns();
    steady.nowMs();
    expect(lines('scoring.clock.jump').map((line) => line.fields)).toEqual([{ ms: 600_000 }]);
  });

  it('a second return with nothing moved changes nothing', () => {
    const { steady, pass, returns, lines } = rig();
    pass(5_000);
    returns();
    returns();
    expect(steady.nowMs()).toBe(T0 + 5_000);
    expect(lines('scoring.clock.jump')).toEqual([]);
  });

  it('with no monotonic source, reads the wall clock and says so once', () => {
    const { steady, pass, jump, returns, lines } = rig({ mono: false });
    pass(1_000);
    jump(298_000);
    returns();
    expect(steady.nowMs()).toBe(T0 + 299_000);
    expect(lines('scoring.clock.steady').map((line) => line.fields)).toEqual([
      { monotonic: false },
    ]);
    expect(lines('scoring.clock.jump')).toEqual([]);
  });

  it('with a monotonic source, says nothing at its creation', () => {
    const { lines } = rig();
    expect(lines('scoring.clock.steady')).toEqual([]);
  });
});

describe('monotonicOf', () => {
  it('reads performance.now when the runtime has it', () => {
    let at = 5;
    const mono = monotonicOf({ performance: { now: () => at } });
    at = 7;
    expect(mono?.()).toBe(7);
  });

  it('is null with no performance, or no now on it', () => {
    expect(monotonicOf({})).toBeNull();
    expect(monotonicOf({ performance: {} })).toBeNull();
    expect(monotonicOf({ performance: { now: 3 } })).toBeNull();
  });
});
