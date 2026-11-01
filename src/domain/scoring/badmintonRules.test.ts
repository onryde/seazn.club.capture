import { describe, expect, it } from 'vitest';
import { badmintonRuleRows, type BadmintonRules } from '@/domain/scoring/badmintonRules';

// Owner ruling 15 (2026-10-31): Match details carry the match's rules; owner, 2026-11-01 (option A): as a table, a
// label and a value a row, the sport supplying the rows. In the brief's order: Format, Points, Cap, Interval, Ends
// change. Only facts the config holds; no durations.

/** The preview fake's match, as the brief states it: best of 3, 21 points won by 2, capped at 30, the interval at 11. */
const STANDARD: BadmintonRules = { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 };

describe('badmintonRuleRows: the rules table’s rows, as dictionary keys and fills', () => {
  it('says the standard match in five rows', () => {
    expect(badmintonRuleRows(STANDARD)).toEqual([
      {
        label: { key: 'scoring.badminton.rules.format.label' },
        value: { key: 'scoring.badminton.rules.bestOf.other', count: 3 },
      },
      {
        label: { key: 'scoring.badminton.rules.points.label' },
        value: { key: 'scoring.badminton.rules.points.value', vars: { points: 21, winBy: 2 } },
      },
      {
        label: { key: 'scoring.badminton.rules.cap.label' },
        value: { key: 'scoring.badminton.rules.cap.value', vars: { cap: 30 } },
      },
      {
        label: { key: 'scoring.badminton.rules.interval.label' },
        value: { key: 'scoring.badminton.rules.interval.value', vars: { point: 11 } },
      },
      {
        label: { key: 'scoring.badminton.rules.endsChange.label' },
        value: { key: 'scoring.badminton.rules.endsChange.value', vars: { point: 11, game: 3 } },
      },
    ]);
  });

  it('changes ends in game 1 of a best of 1, and counts one game (the plural’s `one` form is the translator’s)', () => {
    const rows = badmintonRuleRows({ bestOf: 1, points: 15, winBy: 2, cap: 21, intervalPoint: 8 });
    expect(rows[0]?.value).toEqual({ key: 'scoring.badminton.rules.bestOf.other', count: 1 });
    expect(rows[4]?.value).toEqual({
      key: 'scoring.badminton.rules.endsChange.value',
      vars: { point: 8, game: 1 },
    });
  });

  it('reads each fact from its own field: a best of 5 to 11, by 1, capped at 15, the interval at 6', () => {
    expect(
      badmintonRuleRows({ bestOf: 5, points: 11, winBy: 1, cap: 15, intervalPoint: 6 }).map(
        (row) => row.value,
      ),
    ).toEqual([
      { key: 'scoring.badminton.rules.bestOf.other', count: 5 },
      { key: 'scoring.badminton.rules.points.value', vars: { points: 11, winBy: 1 } },
      { key: 'scoring.badminton.rules.cap.value', vars: { cap: 15 } },
      { key: 'scoring.badminton.rules.interval.value', vars: { point: 6 } },
      { key: 'scoring.badminton.rules.endsChange.value', vars: { point: 6, game: 5 } },
    ]);
  });
});
