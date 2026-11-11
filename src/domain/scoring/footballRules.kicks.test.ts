import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import { KO_11 } from '../../../test/footballLedger';

// The Shootout row's count when the stage names none is the engine's own (`ruleKeys.shootoutAttempts.whenAbsent`,
// FB-SO-1), never a number of ours (the phone review's M1). This stands in an engine whose default is 4 (the Laws say 5,
// so a typed 5 would show), then one that names no default at all: the row then says nothing it does not know.

const whenAbsent = vi.hoisted(() => ({ kicks: 4 as number | undefined }));

vi.mock('@seazn/engine/sports/football', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sports/football')>();
  const ruleKeys = { ...real.football.ruleKeys };
  const { shootoutAttempts } = ruleKeys;
  if (shootoutAttempts === undefined) throw new Error('engine 2.0.0 names shootoutAttempts');
  return {
    ...real,
    football: {
      ...real.football,
      get ruleKeys() {
        return {
          ...ruleKeys,
          shootoutAttempts: { ...shootoutAttempts, whenAbsent: whenAbsent.kicks },
        };
      },
    },
  };
});

const english = createTranslator('en');

async function shootoutRow(raw: unknown): Promise<readonly string[] | undefined> {
  vi.resetModules();
  const { footballCfg } = await import('@/domain/scoring/footballEngine');
  const { footballRuleRows } = await import('@/domain/scoring/footballRules');
  const cfg = footballCfg(raw);
  if (cfg === null) throw new Error('the config does not parse');
  const rows = footballRuleRows(cfg).map(({ label, value }) => [
    translatePad(english, label),
    translatePad(english, value),
  ]);
  return rows.find(([label]) => label === en['scoring.football.rules.shootout']);
}

describe('the Shootout row’s count when the stage names none', () => {
  it('is the engine’s default: 4 kicks each from an engine that says 4', async () => {
    whenAbsent.kicks = 4;
    expect(await shootoutRow(KO_11)).toEqual(['Shootout', '4 kicks each']);
  });

  it('a stage’s own count still wins over the engine’s default', async () => {
    whenAbsent.kicks = 4;
    expect(await shootoutRow({ ...KO_11, shootoutAttempts: 3 })).toEqual([
      'Shootout',
      '3 kicks each',
    ]);
  });

  it('with no default from the engine and none from the stage, no Shootout row: no count is made up', async () => {
    whenAbsent.kicks = undefined;
    expect(await shootoutRow(KO_11)).toBeUndefined();
  });
});
