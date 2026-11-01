/**
 * Where a match sits, for any sport (owner, 2026-11-01: "How do we know Comp/Divi round etc/. can we add in not
 * started including rules?"): the competition, its division and round, the fixture's own code or number ("Match 4",
 * "BAD0001"), and the two sides as the organiser typed them, top first. What the organiser left out is null, and its
 * line is not drawn.
 */
export type MatchContext = {
  readonly competition: string;
  readonly division: string | null;
  readonly round: string | null;
  readonly match: string | null;
  readonly sides: readonly [string, string];
};

/** The division and the round on one line, " · " between ("U15 Boys Singles · Round 1"); either alone; or null. */
export function divisionAndRound(context: MatchContext): string | null {
  const parts = [context.division, context.round].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  return parts.length === 0 ? null : parts.join(' · ');
}
