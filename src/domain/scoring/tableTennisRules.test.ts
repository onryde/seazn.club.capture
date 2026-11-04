import { describe, expect, it } from 'vitest';
import { tableTennisRuleRows } from '@/domain/scoring/tableTennisRules';
import type { TableTennisRecords, TableTennisRules } from '@/domain/scoring/tableTennisPad';
import en from '@/i18n/en.json';

// Design §5.4: the match card's rules rows for table tennis, from the fixture's config as the engine reads it
// (`tabletennisPadRules`; the fold puts the reading in the display): Format ("Best of 5"), Points ("11, win by 2"),
// Expedite ("After 10 minutes"), Timeouts ("One each"). The hardbat variant plays to 21, and the rows say 21: the
// number is the config's, never ours.

/** ITTF's default: best of 5, to 11, win by 2 (the engine's `bo5`); the margin of the score bound is the fold's. */
const BO5: TableTennisRules = { bestOf: 5, setTo: 11, finalSetTo: 11, winBy: 2, scoreBound: 31 };
const ALL: TableTennisRecords = { timeouts: true, sanctions: true, expedite: true };

const FORMAT = {
  label: { key: 'scoring.tabletennis.rules.format.label' },
  value: (bestOf: number) => ({ key: 'scoring.tabletennis.rules.bestOf', vars: { bestOf } }),
} as const;

describe('tableTennisRuleRows: the rules table’s rows, as dictionary keys and fills', () => {
  it('says the standard match in four rows: Format, Points, Expedite, Timeouts', () => {
    expect(tableTennisRuleRows(BO5, ALL)).toEqual([
      { label: FORMAT.label, value: FORMAT.value(5) },
      {
        label: { key: 'scoring.tabletennis.rules.points.label' },
        value: { key: 'scoring.tabletennis.rules.points.value', vars: { points: 11, winBy: 2 } },
      },
      {
        label: { key: 'scoring.tabletennis.rules.expedite.label' },
        value: { key: 'scoring.tabletennis.rules.expedite.value' },
      },
      {
        label: { key: 'scoring.tabletennis.rules.timeouts.label' },
        value: { key: 'scoring.tabletennis.rules.timeouts.value' },
      },
    ]);
  });

  it('reads the English wording from the dictionary: the four rows the design names', () => {
    expect(en['scoring.tabletennis.rules.format.label']).toBe('Format');
    expect(en['scoring.tabletennis.rules.bestOf']).toBe('Best of {bestOf}');
    expect(en['scoring.tabletennis.rules.points.label']).toBe('Points');
    expect(en['scoring.tabletennis.rules.points.value']).toBe('{points}, win by {winBy}');
    expect(en['scoring.tabletennis.rules.expedite.label']).toBe('Expedite');
    expect(en['scoring.tabletennis.rules.expedite.value']).toBe('After 10 minutes');
    expect(en['scoring.tabletennis.rules.timeouts.label']).toBe('Timeouts');
    expect(en['scoring.tabletennis.rules.timeouts.value']).toBe('One each');
  });

  it('reads the format from the config: a best of 7 (the engine’s bo7, knock-outs and finals)', () => {
    expect(tableTennisRuleRows({ ...BO5, bestOf: 7 }, ALL)[0]).toEqual({
      label: FORMAT.label,
      value: FORMAT.value(7),
    });
  });

  it('reads each fact from its own field: to 15, win by 1', () => {
    const rows = tableTennisRuleRows({ ...BO5, setTo: 15, finalSetTo: 15, winBy: 1 }, ALL);
    expect(rows[1]?.value).toEqual({
      key: 'scoring.tabletennis.rules.points.value',
      vars: { points: 15, winBy: 1 },
    });
  });

  // Plan Review Focus 5: the hardbat variant (the engine's `hardbat-21`) plays every game to 21, and "11" is never shown.
  it('hardbat cfg reads 21 everywhere', () => {
    const hardbat: TableTennisRules = {
      bestOf: 5,
      setTo: 21,
      finalSetTo: 21,
      winBy: 2,
      scoreBound: 41,
    };
    const rows = tableTennisRuleRows(hardbat, ALL);
    expect(rows[1]?.value).toEqual({
      key: 'scoring.tabletennis.rules.points.value',
      vars: { points: 21, winBy: 2 },
    });
    expect(JSON.stringify(rows)).not.toContain('11');
  });

  // The deciding game may be played to its own score (`finalSetTo`), as badminton's Points row says it.
  describe('a deciding game played to a different score', () => {
    const shorter: TableTennisRules = { ...BO5, setTo: 11, finalSetTo: 7 };

    it('says the deciding game’s target in the Points row, beside the other games’', () => {
      expect(tableTennisRuleRows(shorter, ALL)[1]?.value).toEqual({
        key: 'scoring.tabletennis.rules.points.deciding',
        vars: { points: 11, winBy: 2, game: 5, deciding: 7 },
      });
      expect(en['scoring.tabletennis.rules.points.deciding']).toBe(
        '{points}, win by {winBy}, game {game} to {deciding}',
      );
    });

    it('keeps the plain Points row when every game is played to the same score', () => {
      expect(tableTennisRuleRows(BO5, ALL)[1]?.value.key).toBe(
        'scoring.tabletennis.rules.points.value',
      );
    });

    // A best of 1 plays its one game as the deciding game: the target the config gives it is `finalSetTo`, and the first
    // game's `setTo` is never played.
    it('says a best of 1 by its one game, the deciding game’s target', () => {
      expect(
        tableTennisRuleRows({ ...shorter, bestOf: 1 }, ALL).map((row) => row.value),
      ).toContainEqual({
        key: 'scoring.tabletennis.rules.points.value',
        vars: { points: 7, winBy: 2 },
      });
    });
  });

  // The table says nothing the match does not hold: the pad offers neither, so the rows go with them.
  describe('a match that does not record a thing', () => {
    const labels = (records: TableTennisRecords) =>
      tableTennisRuleRows(BO5, records).map((row) => row.label.key);

    it('drops the Expedite row when the match does not record Expedite', () => {
      expect(labels({ ...ALL, expedite: false })).toEqual([
        'scoring.tabletennis.rules.format.label',
        'scoring.tabletennis.rules.points.label',
        'scoring.tabletennis.rules.timeouts.label',
      ]);
    });

    it('drops the Timeouts row when the match does not record timeouts', () => {
      expect(labels({ ...ALL, timeouts: false })).toEqual([
        'scoring.tabletennis.rules.format.label',
        'scoring.tabletennis.rules.points.label',
        'scoring.tabletennis.rules.expedite.label',
      ]);
    });

    it('keeps Format and Points when it records neither; cards have no row', () => {
      expect(labels({ timeouts: false, sanctions: false, expedite: false })).toEqual([
        'scoring.tabletennis.rules.format.label',
        'scoring.tabletennis.rules.points.label',
      ]);
      expect(labels({ ...ALL, sanctions: false })).toHaveLength(4);
    });
  });
});
