import type { PadRuleRow, PadText } from '@/domain/scoring/padView';
import type {
  VolleyballCaps,
  VolleyballRecords,
  VolleyballRules,
} from '@/domain/scoring/volleyballTypes';

/** The dictionary keys the rules table's rows name: a label and a value a row. */
export type VolleyballRuleKey =
  | 'scoring.volleyball.rules.format.label'
  | 'scoring.volleyball.rules.bestOf'
  | 'scoring.volleyball.rules.points.label'
  | 'scoring.volleyball.rules.points.value'
  | 'scoring.volleyball.rules.points.deciding'
  | 'scoring.volleyball.rules.timeouts.label'
  | 'scoring.volleyball.rules.timeouts.value'
  | 'scoring.volleyball.rules.subs.label'
  | 'scoring.volleyball.rules.subs.value';

type Row = PadRuleRow<VolleyballRuleKey>;
type Value = PadText<VolleyballRuleKey>;

/**
 * The rules table's rows (S2-6; table tennis's twin): Format ("Best of 5"), Points (a set's points and lead, and the
 * deciding set's own target when it differs: "25, win by 2, set 5 to 15"), Timeouts and Subs, each a set. The facts of the
 * first two are the match's config as the engine reads it (`VolleyballRules`: a beach match says 21, never 25); the last
 * two are FIVB's numbers for the variant (`caps`, ruling 175), shown only where the match records them: beach has no Subs
 * row, as it has no Sub tool.
 */
export function volleyballRuleRows(
  rules: VolleyballRules,
  records: VolleyballRecords,
  caps: VolleyballCaps,
): readonly Row[] {
  return [
    row('format', { key: 'scoring.volleyball.rules.bestOf', vars: { bestOf: rules.bestOf } }),
    row('points', pointsOf(rules)),
    ...(records.timeouts
      ? [
          row('timeouts', {
            key: 'scoring.volleyball.rules.timeouts.value',
            vars: { cap: caps.timeouts },
          }),
        ]
      : []),
    ...(records.substitutions && caps.subs > 0
      ? [row('subs', { key: 'scoring.volleyball.rules.subs.value', vars: { cap: caps.subs } })]
      : []),
  ];
}

/**
 * Each set's target in one value: said once when every set is played to the same score, else the deciding set's too. A
 * best of 1 plays its one set as the deciding set, so the target the config gives the first set is never played.
 */
function pointsOf(rules: VolleyballRules): Value {
  const { bestOf, setTo, finalSetTo, winBy } = rules;
  const first = bestOf === 1 ? finalSetTo : setTo;
  if (finalSetTo === first) {
    return { key: 'scoring.volleyball.rules.points.value', vars: { points: first, winBy } };
  }
  return {
    key: 'scoring.volleyball.rules.points.deciding',
    vars: { points: first, winBy, set: bestOf, deciding: finalSetTo },
  };
}

type RuleName = 'format' | 'points' | 'timeouts' | 'subs';

const row = (name: RuleName, value: Value): Row => ({
  label: { key: `scoring.volleyball.rules.${name}.label` },
  value,
});
