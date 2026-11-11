import { describe, expect, it } from 'vitest';
import { volleyballRuleRows } from '@/domain/scoring/volleyballRules';
import { BEACH, INDOOR, withCfg } from '../../../test/volleyballLedger';
import { displayOf, padOf } from './volleyballPad.testkit';

// S2-6 Task 6: the rules table's rows, from the match's config as the engine reads it and FIVB's per-set numbers.

const rows = (...args: Parameters<typeof padOf>) => padOf(...args).details.rules;

describe('volleyballRuleRows', () => {
  it('indoor: best of 5, 25 win by 2 with the deciding set to 15, two timeouts and six subs a set', () => {
    expect(rows([])).toEqual([
      {
        label: { key: 'scoring.volleyball.rules.format.label' },
        value: { key: 'scoring.volleyball.rules.bestOf', vars: { bestOf: 5 } },
      },
      {
        label: { key: 'scoring.volleyball.rules.points.label' },
        value: {
          key: 'scoring.volleyball.rules.points.deciding',
          vars: { points: 25, winBy: 2, set: 5, deciding: 15 },
        },
      },
      {
        label: { key: 'scoring.volleyball.rules.timeouts.label' },
        value: { key: 'scoring.volleyball.rules.timeouts.value', vars: { cap: 2 } },
      },
      {
        label: { key: 'scoring.volleyball.rules.subs.label' },
        value: { key: 'scoring.volleyball.rules.subs.value', vars: { cap: 6 } },
      },
    ]);
  });

  it('beach: best of 3, 21 with the deciding set to 15, one timeout, no subs row', () => {
    expect(rows([], { bootstrap: BEACH })).toEqual([
      {
        label: { key: 'scoring.volleyball.rules.format.label' },
        value: { key: 'scoring.volleyball.rules.bestOf', vars: { bestOf: 3 } },
      },
      {
        label: { key: 'scoring.volleyball.rules.points.label' },
        value: {
          key: 'scoring.volleyball.rules.points.deciding',
          vars: { points: 21, winBy: 2, set: 3, deciding: 15 },
        },
      },
      {
        label: { key: 'scoring.volleyball.rules.timeouts.label' },
        value: { key: 'scoring.volleyball.rules.timeouts.value', vars: { cap: 1 } },
      },
    ]);
  });

  it('says the target once when every set is played to the same score', () => {
    const same = withCfg(INDOOR, { setTo: 15, finalSetTo: 15 });
    expect(rows([], { bootstrap: same })[1]?.value).toEqual({
      key: 'scoring.volleyball.rules.points.value',
      vars: { points: 15, winBy: 2 },
    });
  });

  it('a best of 1 plays its one set as the deciding set: its target is the one said', () => {
    const one = withCfg(INDOOR, { bestOf: 1, setTo: 25, finalSetTo: 15 });
    expect(rows([], { bootstrap: one })[1]?.value).toEqual({
      key: 'scoring.volleyball.rules.points.value',
      vars: { points: 15, winBy: 2 },
    });
  });

  it('has no Timeouts row for a match that records none, and no Subs row for one that records none', () => {
    const display = displayOf([]);
    const none = { timeouts: false, sanctions: true, substitutions: false };
    expect(volleyballRuleRows(display.rules, none, display.caps).map((r) => r.label.key)).toEqual([
      'scoring.volleyball.rules.format.label',
      'scoring.volleyball.rules.points.label',
    ]);
  });

  it('a Subs row needs both the record flag and a cap above none', () => {
    const display = displayOf([]);
    const records = { timeouts: true, sanctions: true, substitutions: true };
    const labels = (caps: typeof display.caps) =>
      volleyballRuleRows(display.rules, records, caps).map((r) => r.label.key);
    expect(labels({ timeouts: 2, subs: 0 })).not.toContain('scoring.volleyball.rules.subs.label');
    expect(labels({ timeouts: 2, subs: 6 })).toContain('scoring.volleyball.rules.subs.label');
  });
});
