import type { PadRuleRow, PadText } from '@/domain/scoring/padView';

/**
 * A badminton match's rules as its config holds them: the engine's in S2, the preview fake's today. Facts only: the
 * Match details (owner ruling 15, 2026-10-31) say these and nothing a config does not hold, no durations.
 */
export type BadmintonRules = {
  /** Games in the match; the side that wins more than half of them takes it. */
  readonly bestOf: number;
  /** The first game is won at this many points… */
  readonly points: number;
  /**
   * …and the deciding game, the last a match can have, at this many: the same unless the config plays it to a different
   * score (`finalSetTo`). In a best of 1 the one game is the deciding game, so both are its target.
   */
  readonly decidingPoints: number;
  /** …with a lead of this many… */
  readonly winBy: number;
  /** …or at this many, whatever the lead; null when the config holds no cap, and the table has no Cap row. */
  readonly cap: number | null;
  /** The interval of the game under way, when the leading side reaches it. */
  readonly intervalPoint: number;
  /** The deciding game's own interval point, where the ends change in it (the game under way's, if that is the deciding game). */
  readonly decidingIntervalPoint: number;
};

/** The dictionary keys the rules table's rows name: a label and a value a row. */
export type BadmintonRuleKey =
  | 'scoring.badminton.rules.format.label'
  | 'scoring.badminton.rules.bestOf.other'
  | 'scoring.badminton.rules.points.label'
  | 'scoring.badminton.rules.points.value'
  | 'scoring.badminton.rules.points.deciding'
  | 'scoring.badminton.rules.cap.label'
  | 'scoring.badminton.rules.cap.value'
  | 'scoring.badminton.rules.interval.label'
  | 'scoring.badminton.rules.interval.value'
  | 'scoring.badminton.rules.endsChange.label'
  | 'scoring.badminton.rules.endsChange.value'
  | 'scoring.badminton.rules.endsChange.single';

/**
 * The rules table's rows (owner, 2026-11-01, option A: "a proper format also it can change per sport"), in the brief's
 * order: Format (its plural form is the translator's: "Best of 1 game"), Points (a game's points and lead, and the
 * deciding game's own target when it differs: "21, win by 2, game 3 to 15"), Cap, Interval, and Ends change: after
 * each game, and at the deciding game's interval point in the deciding game, the last a match can have
 * (`endsChangeOf`).
 * `MatchCard` draws any sport's rows; it knows nothing of badminton.
 */
export function badmintonRuleRows(rules: BadmintonRules): readonly PadRuleRow<BadmintonRuleKey>[] {
  const cap =
    rules.cap === null
      ? []
      : [row('cap', { key: 'scoring.badminton.rules.cap.value', vars: { cap: rules.cap } })];
  return [
    row('format', { key: 'scoring.badminton.rules.bestOf.other', count: rules.bestOf }),
    row('points', pointsOf(rules)),
    ...cap,
    row('interval', {
      key: 'scoring.badminton.rules.interval.value',
      vars: { point: rules.intervalPoint },
    }),
    row('endsChange', endsChangeOf(rules)),
  ];
}

/** Each game's target in one value: said once when every game is played to the same score, else the deciding game's too. */
function pointsOf(rules: BadmintonRules): PadText<BadmintonRuleKey> {
  const { points, decidingPoints, winBy } = rules;
  if (decidingPoints === points) {
    return { key: 'scoring.badminton.rules.points.value', vars: { points, winBy } };
  }
  return {
    key: 'scoring.badminton.rules.points.deciding',
    vars: { points, winBy, game: rules.bestOf, deciding: decidingPoints },
  };
}

/**
 * Ends change after every game, and once more within the deciding game at its interval point (BWF Law 8; owner,
 * 2026-11-03: the row had read as a change in game 3 only). A best of 1 has no game after it: only the point.
 */
function endsChangeOf(rules: BadmintonRules): PadText<BadmintonRuleKey> {
  return rules.bestOf === 1
    ? {
        key: 'scoring.badminton.rules.endsChange.single',
        vars: { point: rules.decidingIntervalPoint },
      }
    : {
        key: 'scoring.badminton.rules.endsChange.value',
        vars: { point: rules.decidingIntervalPoint, game: rules.bestOf },
      };
}

type RuleName = 'format' | 'points' | 'cap' | 'interval' | 'endsChange';

const row = (name: RuleName, value: PadText<BadmintonRuleKey>): PadRuleRow<BadmintonRuleKey> => ({
  label: { key: `scoring.badminton.rules.${name}.label` },
  value,
});
