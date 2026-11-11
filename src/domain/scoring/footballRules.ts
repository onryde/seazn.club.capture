import { footballPadRules } from '@seazn/engine/pad';
import { football, type FootballCfg } from '@seazn/engine/sports/football';
import { periodLengths } from '@/domain/scoring/footballClock';
import type { FootballPadKey } from '@/domain/scoring/footballTypes';
import type { PadRuleRow, PadText } from '@/domain/scoring/padView';

type Row = PadRuleRow<FootballPadKey>;
type Value = PadText<FootballPadKey>;

const NONE: Value = { key: 'scoring.football.rules.none' };

/**
 * The rules table's rows for a football match (S2-5 design §6.4: format, half length, extra time, shootout, subs), in
 * order: Format ("2 × 45 min"), Extra time ("2 × 15 min" or None), Shootout ("5 kicks each" or None; no row when
 * neither the stage nor the engine names the count), Subs (Rolling, "Up to 5 in 3 windows", Unlimited), Extra-time subs
 * ("+1 in 1 more window"; only where extra time is played and the competition raises a cap there) and Sin-bin
 * ("10 min" or None). Every fact is the match's config as the engine reads it
 * (the fold's `cfg`, defaults filled): the lengths are the clock's own (`periodLengths`), so a period the config makes
 * longer than the others is said as it is. `MatchCard` draws any sport's rows; it knows nothing of football.
 */
export function footballRuleRows(cfg: FootballCfg): readonly Row[] {
  const lengths = Object.entries(periodLengths(cfg));
  const regulation = lengths.filter(([period]) => !period.startsWith('ET_'));
  const extra = lengths.filter(([period]) => period.startsWith('ET_'));
  return [
    row('format', periodsValue(regulation.map(([, seconds]) => seconds))),
    row('extraTime', extra.length === 0 ? NONE : periodsValue(extra.map(([, seconds]) => seconds))),
    ...shootoutRows(cfg),
    row('subs', subsValue(cfg)),
    ...extraTimeSubsRows(cfg, extra.length > 0),
    row('sinBin', cfg.sinBinMinutes === undefined ? NONE : minutes(cfg.sinBinMinutes)),
  ];
}

type RuleLabel = 'format' | 'extraTime' | 'shootout' | 'subs' | 'extraTimeSubs' | 'sinBin';

const row = (label: RuleLabel, value: Value): Row => ({
  label: { key: `scoring.football.rules.${label}` },
  value,
});

const minutes = (count: number | string): Value => ({
  key: 'scoring.football.rules.minutes',
  vars: { minutes: count },
});

/** Periods of one length as "2 × 45 min"; periods of different lengths each, "40 + 45 min". */
function periodsValue(seconds: readonly number[]): Value {
  const lengths = seconds.map((each) => each / 60);
  const [first] = lengths;
  if (first !== undefined && lengths.every((length) => length === first)) {
    return {
      key: 'scoring.football.rules.periods',
      vars: { count: lengths.length, minutes: first },
    };
  }
  return minutes(lengths.join(' + '));
}

/**
 * The Shootout row: None with no shootout; else the kicks each side takes before sudden death, the stage's, or when it
 * names none the engine's own default (`ruleKeys.shootoutAttempts.whenAbsent`, FB-SO-1: the one number the fold plays),
 * never a number of ours. With neither, no row: a count made up here could disagree with the fold.
 */
function shootoutRows(cfg: FootballCfg): readonly Row[] {
  if (!cfg.shootout) return [row('shootout', NONE)];
  const count = cfg.shootoutAttempts ?? football.ruleKeys?.shootoutAttempts?.whenAbsent;
  if (count === undefined) return [];
  return [row('shootout', { key: 'scoring.football.rules.shootoutKicks.other', count })];
}

/**
 * The substitutions the match allows: the cap and its windows when it has them ("Up to 5 in 3 windows", "Up to 5", "In 3
 * windows"), else Rolling when a player who came off may go back on, else Unlimited. A cap is said before Rolling: it is
 * what stops the scorer's Sub.
 */
function subsValue(cfg: FootballCfg): Value {
  const { maxSubs, subWindows } = cfg;
  if (maxSubs !== undefined && subWindows !== undefined) {
    return {
      key: 'scoring.football.rules.subsCapped.other',
      count: subWindows,
      vars: { subs: maxSubs },
    };
  }
  if (maxSubs !== undefined)
    return { key: 'scoring.football.rules.subsMax', vars: { subs: maxSubs } };
  if (subWindows !== undefined) {
    return { key: 'scoring.football.rules.subsWindows.other', count: subWindows };
  }
  return {
    key:
      cfg.rollingSubs === true
        ? 'scoring.football.rules.subsRolling'
        : 'scoring.football.rules.subsUnlimited',
  };
}

/**
 * The Extra-time subs row (engine 7.0.0, F-R3; Law 3): what extra time adds to each cap, as the engine reads both caps
 * (`effectiveSubCaps`, the one reading the fold uses), so a cap the competition did not declare is never raised here.
 * No row without extra time, or when nothing is raised.
 */
function extraTimeSubsRows(cfg: FootballCfg, extraTime: boolean): readonly Row[] {
  if (!extraTime) return [];
  const before = footballPadRules.effectiveSubCaps(cfg, 'H2');
  const after = footballPadRules.effectiveSubCaps(cfg, 'ET_H1');
  const subs = raised(before.maxSubs, after.maxSubs);
  const windows = raised(before.subWindows, after.subWindows);
  if (subs > 0 && windows > 0) {
    return [
      row('extraTimeSubs', {
        key: 'scoring.football.rules.extraTimeSubsCapped.other',
        count: windows,
        vars: { subs },
      }),
    ];
  }
  if (subs > 0) {
    return [
      row('extraTimeSubs', { key: 'scoring.football.rules.extraTimeSubsMax', vars: { subs } }),
    ];
  }
  if (windows > 0) {
    return [
      row('extraTimeSubs', {
        key: 'scoring.football.rules.extraTimeSubsWindows.other',
        count: windows,
      }),
    ];
  }
  return [];
}

/** What extra time adds to one cap: the engine leaves a cap the competition did not declare undefined in both. */
const raised = (before: number | undefined, after: number | undefined): number =>
  (after ?? 0) - (before ?? 0);
