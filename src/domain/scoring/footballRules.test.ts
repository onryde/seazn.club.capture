import { describe, expect, it } from 'vitest';
import { footballCfg } from '@/domain/scoring/footballEngine';
import { footballRuleRows } from '@/domain/scoring/footballRules';
import en from '@/i18n/en.json';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import { CAPPED, KO_11, LEAGUE_11, MINI } from '../../../test/footballLedger';

/**
 * The rules rows (S2-5 design §6.4: format, half length, extra time, shootout, subs), read in English as Match details
 * draws them. Every value is the fixture's config as the engine reads it; the expected words are written out.
 */

const english = createTranslator('en');

function rowsOf(raw: unknown): readonly (readonly [string, string])[] {
  const cfg = footballCfg(raw);
  if (cfg === null) throw new Error('the config does not parse');
  return footballRuleRows(cfg).map(({ label, value }) => [
    translatePad(english, label),
    translatePad(english, value),
  ]);
}

describe('footballRuleRows', () => {
  it('KO_11: two halves of 45, extra time, a shootout of five, sin-bins of 10', () => {
    expect(rowsOf(KO_11)).toEqual([
      ['Format', '2 × 45 min'],
      ['Extra time', '2 × 15 min'],
      ['Shootout', '5 kicks each'],
      ['Subs', 'Unlimited'],
      ['Sin-bin', '10 min'],
    ]);
  });

  it('LEAGUE_11: a draw stands, so no extra time and no shootout', () => {
    expect(rowsOf(LEAGUE_11)).toEqual([
      ['Format', '2 × 45 min'],
      ['Extra time', 'None'],
      ['Shootout', 'None'],
      ['Subs', 'Unlimited'],
      ['Sin-bin', 'None'],
    ]);
  });

  it('MINI: four quarters of 10, rolling substitutions', () => {
    expect(rowsOf(MINI)).toEqual([
      ['Format', '4 × 10 min'],
      ['Extra time', 'None'],
      ['Shootout', 'None'],
      ['Subs', 'Rolling'],
      ['Sin-bin', 'None'],
    ]);
  });

  it('CAPPED: the Laws’ five substitutions in three windows', () => {
    expect(rowsOf(CAPPED)[3]).toEqual(['Subs', 'Up to 5 in 3 windows']);
  });

  it('says a cap alone, windows alone, and one window', () => {
    expect(rowsOf({ ...LEAGUE_11, maxSubs: 3 })[3]).toEqual(['Subs', 'Up to 3']);
    expect(rowsOf({ ...LEAGUE_11, subWindows: 3 })[3]).toEqual(['Subs', 'In 3 windows']);
    expect(rowsOf({ ...LEAGUE_11, maxSubs: 3, subWindows: 1 })[3]).toEqual([
      'Subs',
      'Up to 3 in 1 window',
    ]);
  });

  // Engine 7.0.0 (F-R3): `extraTimeSubs` raises each declared cap once the match reaches extra time. The row says the
  // raise as the engine reads it (`effectiveSubCaps`), only where extra time is played and something is raised.
  const ET_CAPPED = { ...KO_11, maxSubs: 5, subWindows: 3 };
  it('says the extra-time allowance in its own row under Subs, when extra time is played', () => {
    const rows = rowsOf({ ...ET_CAPPED, extraTimeSubs: { subs: 1, windows: 1 } });
    expect(rows.slice(3, 5)).toEqual([
      ['Subs', 'Up to 5 in 3 windows'],
      ['Extra-time subs', '+1 in 1 more window'],
    ]);
    expect(rowsOf({ ...ET_CAPPED, extraTimeSubs: { subs: 2, windows: 2 } })[4]).toEqual([
      'Extra-time subs',
      '+2 in 2 more windows',
    ]);
  });

  it('says only what the engine raises: a cap alone, windows alone', () => {
    const extra = { extraTimeSubs: { subs: 1, windows: 1 } };
    expect(rowsOf({ ...KO_11, maxSubs: 5, ...extra })[4]).toEqual(['Extra-time subs', '+1']);
    expect(rowsOf({ ...KO_11, subWindows: 3, ...extra })[4]).toEqual([
      'Extra-time subs',
      '+1 window',
    ]);
    expect(rowsOf({ ...ET_CAPPED, extraTimeSubs: { subs: 1, windows: 0 } })[4]).toEqual([
      'Extra-time subs',
      '+1',
    ]);
  });

  it('no extra-time row with no allowance, nothing it raises, or no extra time', () => {
    const labels = (cfg: unknown) => rowsOf(cfg).map(([label]) => label);
    const five = ['Format', 'Extra time', 'Shootout', 'Subs', 'Sin-bin'];
    expect(labels(ET_CAPPED)).toEqual(five);
    // An uncapped side stays uncapped: the engine raises nothing.
    expect(labels({ ...KO_11, extraTimeSubs: { subs: 1, windows: 1 } })).toEqual(five);
    expect(labels({ ...ET_CAPPED, extraTimeSubs: { subs: 0, windows: 0 } })).toEqual(five);
    expect(labels({ ...CAPPED, extraTimeSubs: { subs: 1, windows: 1 } })).toEqual(five);
  });

  it('a cap is said over rolling: it is what stops Sub', () => {
    expect(rowsOf({ ...MINI, maxSubs: 6 })[3]).toEqual(['Subs', 'Up to 6']);
  });

  it('a stage’s own number of kicks, and one kick said as one', () => {
    expect(rowsOf({ ...KO_11, shootoutAttempts: 3 })[2]).toEqual(['Shootout', '3 kicks each']);
    expect(rowsOf({ ...KO_11, shootoutAttempts: 1 })[2]).toEqual(['Shootout', '1 kick each']);
  });

  it('periods of different lengths are said each', () => {
    expect(rowsOf({ ...LEAGUE_11, periodSeconds: { H1: 2400, H2: 2700 } })[0]).toEqual([
      'Format',
      '40 + 45 min',
    ]);
  });

  it('reads the labels from the dictionary', () => {
    expect(en['scoring.football.rules.format']).toBe('Format');
    expect(en['scoring.football.rules.subsCapped.other']).toBe('Up to {subs} in {count} windows');
    expect(en['scoring.football.rules.none']).toBe('None');
  });
});
