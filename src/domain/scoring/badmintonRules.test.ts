import { describe, expect, it } from 'vitest';
import { badmintonRuleLines, type BadmintonRules } from '@/domain/scoring/badmintonRules';

// Owner ruling 15 (2026-10-31): a Rules sheet with the match's rules. The lines are the controller's brief's, in its
// order: the format, the game's points and lead, the cap, the interval, and where the ends change. Only facts the
// config holds; no durations.

/** The preview fake's match, as the brief states it: best of 3, 21 points won by 2, capped at 30, the interval at 11. */
const STANDARD: BadmintonRules = { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 };

describe('badmintonRuleLines: the Rules sheet’s lines, as dictionary keys and fills', () => {
  it('says the standard match in five lines', () => {
    expect(badmintonRuleLines(STANDARD)).toEqual([
      { key: 'scoring.badminton.rules.bestOf.other', count: 3 },
      { key: 'scoring.badminton.rules.points', vars: { points: 21, winBy: 2 } },
      { key: 'scoring.badminton.rules.cap', vars: { cap: 30 } },
      { key: 'scoring.badminton.intervalAt', vars: { point: 11 } },
      { key: 'scoring.badminton.rules.endsChange', vars: { point: 11, game: 3 } },
    ]);
  });

  it('changes ends in game 1 of a best of 1, and counts one game (the plural’s `one` form is the translator’s)', () => {
    const lines = badmintonRuleLines({
      bestOf: 1,
      points: 15,
      winBy: 2,
      cap: 21,
      intervalPoint: 8,
    });
    expect(lines[0]).toEqual({ key: 'scoring.badminton.rules.bestOf.other', count: 1 });
    expect(lines[4]).toEqual({
      key: 'scoring.badminton.rules.endsChange',
      vars: { point: 8, game: 1 },
    });
  });

  it('reads each fact from its own field: a best of 5 to 11, by 1, capped at 15, the interval at 6', () => {
    expect(
      badmintonRuleLines({ bestOf: 5, points: 11, winBy: 1, cap: 15, intervalPoint: 6 }),
    ).toEqual([
      { key: 'scoring.badminton.rules.bestOf.other', count: 5 },
      { key: 'scoring.badminton.rules.points', vars: { points: 11, winBy: 1 } },
      { key: 'scoring.badminton.rules.cap', vars: { cap: 15 } },
      { key: 'scoring.badminton.intervalAt', vars: { point: 6 } },
      { key: 'scoring.badminton.rules.endsChange', vars: { point: 6, game: 5 } },
    ]);
  });
});
