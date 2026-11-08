import { cricket } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { cricketRuleRows } from '@/domain/scoring/cricketRules';
import { KO_2, T20, TWO_INNINGS } from '../../../test/cricketLedger';

// The match card's format line (S2-4 spec §4.1), as label and value rows: overs an innings (or Unlimited), balls an
// over, players a side, a bowler's overs, the super over on or off, then the follow-on and reviews only when the format
// has them. Each format is the engine's own reading of a fixture's cfg; every row is written out.

const cfg = (raw: unknown) => cricket.configSchema.parse(raw);

const label = (name: string) => ({ key: `scoring.cricket.rules.${name}.label` });

describe('cricketRuleRows', () => {
  it('a knockout of two overs: one over a bowler, the super over on, no follow-on and no reviews', () => {
    expect(cricketRuleRows(cfg(KO_2))).toStrictEqual([
      {
        label: label('overs'),
        value: { key: 'scoring.cricket.rules.overs.value', vars: { overs: '2' } },
      },
      {
        label: label('over'),
        value: { key: 'scoring.cricket.rules.over.value', vars: { balls: 6 } },
      },
      {
        label: label('players'),
        value: { key: 'scoring.cricket.rules.players.value', vars: { players: 11 } },
      },
      {
        label: label('bowler'),
        value: { key: 'scoring.cricket.rules.bowler.value.other', count: 1 },
      },
      { label: label('superOver'), value: { key: 'scoring.cricket.rules.superOver.on' } },
    ]);
  });

  it('a T20: twenty overs, four a bowler', () => {
    const rows = cricketRuleRows(cfg(T20));
    expect(rows.map((row) => row.value)).toStrictEqual([
      { key: 'scoring.cricket.rules.overs.value', vars: { overs: '20' } },
      { key: 'scoring.cricket.rules.over.value', vars: { balls: 6 } },
      { key: 'scoring.cricket.rules.players.value', vars: { players: 11 } },
      { key: 'scoring.cricket.rules.bowler.value.other', count: 4 },
      { key: 'scoring.cricket.rules.superOver.on' },
    ]);
  });

  it('two innings a side: unlimited overs, no quota, no super over, the follow-on at 200 and two reviews', () => {
    expect(cricketRuleRows(cfg(TWO_INNINGS))).toStrictEqual([
      { label: label('overs'), value: { key: 'scoring.cricket.rules.overs.unlimited' } },
      {
        label: label('over'),
        value: { key: 'scoring.cricket.rules.over.value', vars: { balls: 6 } },
      },
      {
        label: label('players'),
        value: { key: 'scoring.cricket.rules.players.value', vars: { players: 11 } },
      },
      { label: label('bowler'), value: { key: 'scoring.cricket.rules.bowler.none' } },
      { label: label('superOver'), value: { key: 'scoring.cricket.rules.superOver.off' } },
      {
        label: label('followOn'),
        value: { key: 'scoring.cricket.rules.followOn.value', vars: { lead: 200 } },
      },
      {
        label: label('reviews'),
        value: { key: 'scoring.cricket.rules.reviews.value', vars: { reviews: 2 } },
      },
    ]);
  });

  it('a follow-on the format turns off has no row; reviews of none still have one', () => {
    const rows = cricketRuleRows(
      cfg({ ...TWO_INNINGS, followOn: { enabled: false, lead: 200 }, reviews: { perInnings: 0 } }),
    );
    expect(rows.map((row) => row.label.key)).toStrictEqual([
      'scoring.cricket.rules.overs.label',
      'scoring.cricket.rules.over.label',
      'scoring.cricket.rules.players.label',
      'scoring.cricket.rules.bowler.label',
      'scoring.cricket.rules.superOver.label',
      'scoring.cricket.rules.reviews.label',
    ]);
  });

  // The Hundred: 100 balls in sets of five is 20 overs; 100 balls of six is 16 overs and 4 balls, as a scorebook writes it.
  it('writes overs and balls when the balls do not make whole overs', () => {
    const hundred = cricketRuleRows(cfg({ ...T20, ballsPerInnings: 100, ballsPerOver: 5 }));
    expect(hundred[0]?.value).toStrictEqual({
      key: 'scoring.cricket.rules.overs.value',
      vars: { overs: '20' },
    });
    expect(hundred[1]?.value).toStrictEqual({
      key: 'scoring.cricket.rules.over.value',
      vars: { balls: 5 },
    });
    const sixes = cricketRuleRows(cfg({ ...T20, ballsPerInnings: 100 }));
    expect(sixes[0]?.value).toStrictEqual({
      key: 'scoring.cricket.rules.overs.value',
      vars: { overs: '16.4' },
    });
  });

  it('players a side as the format sets them', () => {
    const six = cricketRuleRows(cfg({ ...KO_2, playersPerSide: 6 }));
    expect(six[2]?.value).toStrictEqual({
      key: 'scoring.cricket.rules.players.value',
      vars: { players: 6 },
    });
  });
});
