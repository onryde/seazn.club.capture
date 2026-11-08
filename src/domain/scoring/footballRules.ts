import type { FootballCfg } from '@seazn/engine/sports/football';
import { periodLengths } from '@/domain/scoring/footballClock';
import type { FootballPadKey } from '@/domain/scoring/footballTypes';
import type { PadRuleRow, PadText } from '@/domain/scoring/padView';

type Row = PadRuleRow<FootballPadKey>;
type Value = PadText<FootballPadKey>;

const NONE: Value = { key: 'scoring.football.rules.none' };

/**
 * The rules table's rows for a football match (S2-5 design §6.4: format, half length, extra time, shootout, subs), in
 * order: Format ("2 × 45 min"), Extra time ("2 × 15 min" or None), Shootout ("5 kicks each" or None), Subs (Rolling, "Up
 * to 5 in 3 windows", Unlimited) and Sin-bin ("10 min" or None). Every fact is the match's config as the engine reads it
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
    row('shootout', cfg.shootout ? kicksValue(cfg) : NONE),
    row('subs', subsValue(cfg)),
    row('sinBin', cfg.sinBinMinutes === undefined ? NONE : minutes(cfg.sinBinMinutes)),
  ];
}

type RuleLabel = 'format' | 'extraTime' | 'shootout' | 'subs' | 'sinBin';

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
 * The kicks each side takes before sudden death when the stage names none: the Laws' five. The engine's own constant
 * (`SHOOTOUT_ATTEMPTS_DEFAULT`, FB-SO-1, engine 2.0.0 `sports/football/football.d.ts`) is not exported from
 * `@seazn/engine/sports/football`, so it is written here once; the fold reads the same five when `shootoutAttempts` is
 * absent.
 */
const LAWS_KICKS = 5;

/** The kicks each side takes before sudden death: the stage's, or the Laws' five when it names none. */
const kicksValue = (cfg: FootballCfg): Value => ({
  key: 'scoring.football.rules.shootoutKicks.other',
  count: cfg.shootoutAttempts ?? LAWS_KICKS,
});

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
