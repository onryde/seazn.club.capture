import type { PadRuleRow, PadText } from '@/domain/scoring/padView';

/**
 * A badminton match's rules as its config holds them: the engine's in S2, the preview fake's today. Facts only: the
 * Match details (owner ruling 15, 2026-10-31) say these and nothing a config does not hold, no durations.
 */
export type BadmintonRules = {
  /** Games in the match; the side that wins more than half of them takes it. */
  readonly bestOf: number;
  /** A game is won at this many points… */
  readonly points: number;
  /** …with a lead of this many… */
  readonly winBy: number;
  /** …or at this many, whatever the lead; null when the config holds no cap, and the table has no Cap row. */
  readonly cap: number | null;
  /** The interval, when the leading side reaches it in a game; the ends change at it in the deciding game. */
  readonly intervalPoint: number;
};

/** The dictionary keys the rules table's rows name: a label and a value a row. */
export type BadmintonRuleKey =
  | 'scoring.badminton.rules.format.label'
  | 'scoring.badminton.rules.bestOf.other'
  | 'scoring.badminton.rules.points.label'
  | 'scoring.badminton.rules.points.value'
  | 'scoring.badminton.rules.cap.label'
  | 'scoring.badminton.rules.cap.value'
  | 'scoring.badminton.rules.interval.label'
  | 'scoring.badminton.rules.interval.value'
  | 'scoring.badminton.rules.endsChange.label'
  | 'scoring.badminton.rules.endsChange.value';

/**
 * The rules table's rows (owner, 2026-11-01, option A: "a proper format also it can change per sport"), in the brief's
 * order: Format (its plural form is the translator's: "Best of 1 game"), Points (a game's points and lead), Cap,
 * Interval, and Ends change, at the interval point in the deciding game, which is the last a match can have (game 1 of
 * a best of 1). `MatchCard` draws any sport's rows; it knows nothing of badminton.
 */
export function badmintonRuleRows(rules: BadmintonRules): readonly PadRuleRow<BadmintonRuleKey>[] {
  const cap =
    rules.cap === null
      ? []
      : [row('cap', { key: 'scoring.badminton.rules.cap.value', vars: { cap: rules.cap } })];
  return [
    row('format', { key: 'scoring.badminton.rules.bestOf.other', count: rules.bestOf }),
    row('points', {
      key: 'scoring.badminton.rules.points.value',
      vars: { points: rules.points, winBy: rules.winBy },
    }),
    ...cap,
    row('interval', {
      key: 'scoring.badminton.rules.interval.value',
      vars: { point: rules.intervalPoint },
    }),
    row('endsChange', {
      key: 'scoring.badminton.rules.endsChange.value',
      vars: { point: rules.intervalPoint, game: rules.bestOf },
    }),
  ];
}

type RuleName = 'format' | 'points' | 'cap' | 'interval' | 'endsChange';

const row = (name: RuleName, value: PadText<BadmintonRuleKey>): PadRuleRow<BadmintonRuleKey> => ({
  label: { key: `scoring.badminton.rules.${name}.label` },
  value,
});
