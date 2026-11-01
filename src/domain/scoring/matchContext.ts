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
  const parts = given([context.division, context.round]);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * Match details' header as a screen reader hears it, one line (owner, 2026-11-01, option A): each piece the organiser
 * gave, a comma between, which is a pause in all four languages. The middle dot is drawn, never said.
 */
export function contextSaid(context: MatchContext): string {
  return given([context.competition, context.division, context.round, context.match]).join(', ');
}

/** The pieces the organiser gave: a piece left out, or blank, is skipped. */
const given = (parts: readonly (string | null)[]): string[] =>
  parts.filter((part): part is string => part !== null && part.trim() !== '');
