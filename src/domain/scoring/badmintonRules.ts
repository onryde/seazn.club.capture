import type { PadText } from '@/domain/scoring/padView';

/**
 * A badminton match's rules as its config holds them: the engine's in S2, the preview fake's today. Facts only: the
 * Rules sheet (owner ruling 15, 2026-10-31) says these and nothing a config does not hold, no durations.
 */
export type BadmintonRules = {
  /** Games in the match; the side that wins more than half of them takes it. */
  readonly bestOf: number;
  /** A game is won at this many points… */
  readonly points: number;
  /** …with a lead of this many… */
  readonly winBy: number;
  /** …or at this many, whatever the lead. */
  readonly cap: number;
  /** The interval, when the leading side reaches it in a game; the ends change at it in the deciding game. */
  readonly intervalPoint: number;
};

/** The dictionary keys the Rules sheet's lines name; the interval's is the strip's own. */
export type BadmintonRuleKey =
  | 'scoring.badminton.rules.bestOf.other'
  | 'scoring.badminton.rules.points'
  | 'scoring.badminton.rules.cap'
  | 'scoring.badminton.intervalAt'
  | 'scoring.badminton.rules.endsChange';

/**
 * The Rules sheet's lines, in the controller's brief's order (2026-10-31): the format (its plural form is the
 * translator's: "Best of 1 game"), a game's points and lead, the cap, the interval, and the ends changing at the
 * interval point in the deciding game, which is the last a match can have (game 1 of a best of 1).
 */
export function badmintonRuleLines(rules: BadmintonRules): readonly PadText<BadmintonRuleKey>[] {
  return [
    { key: 'scoring.badminton.rules.bestOf.other', count: rules.bestOf },
    { key: 'scoring.badminton.rules.points', vars: { points: rules.points, winBy: rules.winBy } },
    { key: 'scoring.badminton.rules.cap', vars: { cap: rules.cap } },
    { key: 'scoring.badminton.intervalAt', vars: { point: rules.intervalPoint } },
    {
      key: 'scoring.badminton.rules.endsChange',
      vars: { point: rules.intervalPoint, game: rules.bestOf },
    },
  ];
}
