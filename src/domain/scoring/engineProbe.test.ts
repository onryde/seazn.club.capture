import { foldMatch, type EventEnvelope, type LineupPair } from '@seazn/engine/core';
import { badminton } from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import { foldReading, syntheticBadmintonMatch, timeFold } from '@/domain/scoring/engineProbe';

/** The engine's refusal of an event after the decision (`EngineError`, @seazn/engine 1.1.0 `core/errors`). */
const ALREADY_DECIDED = expect.objectContaining({ name: 'EngineError', code: 'ALREADY_DECIDED' });

/**
 * R4's ledger (plan S2-1 Task 1): a decided best-of-3, the home side winning 21–15 21–18, as the phone will fold it.
 * The cfg and the lineups are built here from the engine's own API, not taken from the probe, so the fold below checks
 * the probe's events against the engine rather than against themselves.
 */
const HOME = 'probe-home';
const AWAY = 'probe-away';
const cfg = badminton.configSchema.parse({});
const lineups: LineupPair = {
  home: { entrantId: HOME, slots: [{ personId: 'probe-home-1', slot: 'starting', orderNo: 1 }] },
  away: { entrantId: AWAY, slots: [{ personId: 'probe-away-1', slot: 'starting', orderNo: 1 }] },
};

describe('syntheticBadmintonMatch', () => {
  const events = syntheticBadmintonMatch();

  it('is the start and 75 rallies, numbered 1 to 76 with no gap, each with its own id', () => {
    expect(events).toHaveLength(76);
    expect(events[0]).toMatchObject({ seq: 1, type: 'core.start', payload: {} });
    expect(events.slice(1).every((event) => event.type === 'badminton.rally')).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 76 }, (_, i) => i + 1));
    expect(new Set(events.map((event) => event.id)).size).toBe(76);
  });

  // Design §7.3: the match's first rally carries `serving`, which anchors the first server; the winner serves after.
  it('names the first server on the first rally only', () => {
    const serving = events.filter((event) => hasServing(event));
    expect(serving).toHaveLength(1);
    expect(serving[0]).toBe(events[1]);
  });

  it('folds strictly, every event validated, to a decided match: home 2–0, 21–15 and 21–18', () => {
    const state = foldMatch(badminton, cfg, lineups, events, { strictFromSeq: 1 });
    expect(state.outcome).toMatchObject({ kind: 'win', winner: HOME, loser: AWAY });
    expect(state.setsWon).toEqual({ home: 2, away: 0 });
    expect(state.sets).toEqual([
      { home: 21, away: 15, closed: true },
      { home: 21, away: 18, closed: true },
    ]);
  });

  // A second call is a fresh ledger: the probe folds it 50 times, and nothing a caller does to one reaches the next.
  it('gives an equal, separate ledger on a second call', () => {
    const again = syntheticBadmintonMatch();
    expect(again).toEqual(events);
    expect(again).not.toBe(events);
  });

  it('stops being legal one rally later: the engine refuses a rally after the match is decided', () => {
    const extra: EventEnvelope = { ...events[75], id: 'probe-extra', seq: 77 };
    expect(() =>
      foldMatch(badminton, cfg, lineups, [...events, extra], { strictFromSeq: 1 }),
    ).toThrow(ALREADY_DECIDED);
  });
});

describe('timeFold', () => {
  it('folds the ledger the asked number of times and says how many events it folded', () => {
    const timed = timeFold(syntheticBadmintonMatch(), 10);
    expect(timed.events).toBe(76);
    expect(timed.ms).toHaveLength(10);
    expect(timed.ms.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
  });

  // Each entry is one fold's own time: the clock read just before it and just after it, never across two folds.
  it('times each fold between its own two clock readings', () => {
    const readings = [100, 103, 110, 112.5, 200, 207.25];
    let next = 0;
    const timed = timeFold(syntheticBadmintonMatch(), 3, () => readings[next++]);
    expect(timed.ms).toEqual([3, 2.5, 7.25]);
    expect(next).toBe(6);
  });

  it('times an empty ledger, the match before its start', () => {
    expect(timeFold([], 2)).toMatchObject({
      events: 0,
      ms: [expect.any(Number), expect.any(Number)],
    });
  });

  it('times nothing when asked for no folds', () => {
    expect(timeFold(syntheticBadmintonMatch(), 0)).toEqual({ events: 76, ms: [] });
  });

  // A refused fold is not a time: the probe says so rather than timing a throw.
  it('lets a refused fold throw', () => {
    const events = syntheticBadmintonMatch();
    const extra: EventEnvelope = { ...events[75], id: 'probe-extra', seq: 77 };
    expect(() => timeFold([...events, extra], 1)).toThrow(ALREADY_DECIDED);
  });

  // The probe times the strict path, every event validated, as the phone's own queued taps will be. Badminton records
  // no timeouts: a strict fold refuses one that a replay of the ledger (no `strictFromSeq`) takes.
  it('folds every event strictly', () => {
    const opening = syntheticBadmintonMatch().slice(0, 10);
    const timeout: EventEnvelope = {
      ...opening[9],
      id: 'probe-timeout',
      seq: 11,
      type: 'badminton.timeout',
      payload: { by: HOME },
    };
    expect(() => foldMatch(badminton, cfg, lineups, [...opening, timeout])).not.toThrow();
    expect(() => timeFold([...opening, timeout], 1)).toThrow(/does not record timeouts/);
  });
});

describe('foldReading', () => {
  it('reads the fastest, the median, the slowest and the first fold', () => {
    expect(foldReading({ events: 76, ms: [5, 1, 3, 2, 4] })).toEqual({
      events: 76,
      runs: 5,
      min: 1,
      median: 3,
      max: 5,
      first: 5,
    });
  });

  it('takes the mean of the two middle folds when the count is even', () => {
    expect(foldReading({ events: 76, ms: [4, 1, 10, 2] })).toMatchObject({ median: 3, runs: 4 });
  });

  it('reads one fold as all four', () => {
    expect(foldReading({ events: 1, ms: [7] })).toEqual({
      events: 1,
      runs: 1,
      min: 7,
      median: 7,
      max: 7,
      first: 7,
    });
  });

  it('has nothing to read from no folds', () => {
    expect(foldReading({ events: 76, ms: [] })).toBeNull();
  });
});

function hasServing(event: EventEnvelope): boolean {
  const payload = event.payload;
  return typeof payload === 'object' && payload !== null && 'serving' in payload;
}
