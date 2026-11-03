import { describe, expect, it } from 'vitest';
import { badmintonRuleRows, type BadmintonRules } from '@/domain/scoring/badmintonRules';
import en from '@/i18n/en.json';

// Owner ruling 15 (2026-10-31): Match details carry the match's rules; owner, 2026-11-01 (option A): as a table, a
// label and a value a row, the sport supplying the rows. In the brief's order: Format, Points, Cap, Interval, Ends
// change. Only facts the config holds; no durations.

/** The preview fake's match, as the brief states it: best of 3, 21 points won by 2, capped at 30, the interval at 11. */
const STANDARD: BadmintonRules = {
  bestOf: 3,
  points: 21,
  decidingPoints: 21,
  winBy: 2,
  cap: 30,
  intervalPoint: 11,
  decidingIntervalPoint: 11,
};

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

  // Owner, 2026-11-03 ("apply rec" on "Ends change: after each game, and at 6 in game 3"): the row was read as ends
  // changing only in game 3. Ends change after every game, and once more within the deciding game.
  it('says ends change after each game, and at the deciding game’s interval point in that game', () => {
    expect(en['scoring.badminton.rules.endsChange.value']).toBe(
      'after each game, and at {point} in game {game}',
    );
    expect(en['scoring.badminton.rules.endsChange.single']).toBe('at {point}');
  });

  // The plural's `one` form ("Best of 1 game") is the translator's.
  it('changes ends at the interval point of a best of 1, its only game, and counts one game', () => {
    const rows = badmintonRuleRows({
      bestOf: 1,
      points: 15,
      decidingPoints: 15,
      winBy: 2,
      cap: 21,
      intervalPoint: 8,
      decidingIntervalPoint: 8,
    });
    expect(rows[0]?.value).toEqual({ key: 'scoring.badminton.rules.bestOf.other', count: 1 });
    expect(rows[4]?.value).toEqual({
      key: 'scoring.badminton.rules.endsChange.single',
      vars: { point: 8 },
    });
  });

  // Plan S2-1 Task 7: the engine's badminton config may hold no cap (`cap: null`); the table says nothing it does not hold.
  it('drops the Cap row for a match with no cap, and keeps the other four in order', () => {
    expect(badmintonRuleRows({ ...STANDARD, cap: null }).map((row) => row.label.key)).toEqual([
      'scoring.badminton.rules.format.label',
      'scoring.badminton.rules.points.label',
      'scoring.badminton.rules.interval.label',
      'scoring.badminton.rules.endsChange.label',
    ]);
  });

  it('reads each fact from its own field: a best of 5 to 11, by 1, capped at 15, the interval at 6', () => {
    expect(
      badmintonRuleRows({
        bestOf: 5,
        points: 11,
        decidingPoints: 11,
        winBy: 1,
        cap: 15,
        intervalPoint: 6,
        decidingIntervalPoint: 6,
      }).map((row) => row.value),
    ).toEqual([
      { key: 'scoring.badminton.rules.bestOf.other', count: 5 },
      { key: 'scoring.badminton.rules.points.value', vars: { points: 11, winBy: 1 } },
      { key: 'scoring.badminton.rules.cap.value', vars: { cap: 15 } },
      { key: 'scoring.badminton.rules.interval.value', vars: { point: 6 } },
      { key: 'scoring.badminton.rules.endsChange.value', vars: { point: 6, game: 5 } },
    ]);
  });

  // Plan S2-1 Task 11 (Task 9 additions): the deciding game may be played to a different score (`finalSetTo`), and the
  // Points row says each game's own target; the ends change at the deciding game's own interval point, not the game
  // under way's.
  describe('a deciding game played to a different score', () => {
    const TO_FIFTEEN: BadmintonRules = {
      ...STANDARD,
      decidingPoints: 15,
      decidingIntervalPoint: 8,
    };

    it('says the deciding game’s target in the Points row, beside the other games’', () => {
      expect(badmintonRuleRows(TO_FIFTEEN)[1]).toEqual({
        label: { key: 'scoring.badminton.rules.points.label' },
        value: {
          key: 'scoring.badminton.rules.points.deciding',
          vars: { points: 21, winBy: 2, game: 3, deciding: 15 },
        },
      });
    });

    it('changes ends at the deciding game’s interval point while game 1 is under way (interval 11)', () => {
      const rows = badmintonRuleRows(TO_FIFTEEN);
      expect(rows.find((row) => row.label.key.endsWith('interval.label'))?.value).toEqual({
        key: 'scoring.badminton.rules.interval.value',
        vars: { point: 11 },
      });
      expect(rows.at(-1)?.value).toEqual({
        key: 'scoring.badminton.rules.endsChange.value',
        vars: { point: 8, game: 3 },
      });
    });

    it('keeps the plain Points row when every game is played to the same score', () => {
      expect(badmintonRuleRows(STANDARD)[1]?.value.key).toBe(
        'scoring.badminton.rules.points.value',
      );
    });
  });
});
