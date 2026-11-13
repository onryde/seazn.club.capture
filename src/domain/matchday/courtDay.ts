import type { Court, CourtState, MatchDay, Row } from '@/domain/matchday/matchDay';

/**
 * One court's whole day, for the screen a court's head opens (owner, 2026-11-13: "If I click Court 2, can we open
 * screen with full list and finished matches less?"): the match on it, its whole queue (the card shows only the first
 * two), and its finished matches, newest first, of which the screen shows the latest until asked for the rest.
 */
export type CourtDay = {
  readonly courtId: string;
  readonly name: string;
  readonly venueName: string;
  readonly state: CourtState;
  readonly now: Row | null;
  /** The queue, in the server's planned order. */
  readonly upcoming: readonly Row[];
  readonly finished: readonly Row[];
  /** The newest finished match, or none. */
  readonly latest: Row | null;
  /** How many finished matches "+N more finished" stands for. */
  readonly more: number;
};

export function courtDay(court: Court): CourtDay {
  return {
    courtId: court.courtId,
    name: court.courtName,
    venueName: court.venueName,
    state: court.state,
    now: court.now,
    upcoming: court.next,
    finished: court.finished,
    latest: court.finished[0] ?? null,
    more: Math.max(0, court.finished.length - 1),
  };
}

/** The court `courtId` on the latest read of the day, or null once it is not on it (or there is no day yet). */
export function courtDayOf(day: MatchDay | null, courtId: string): CourtDay | null {
  const court = day?.courts.find((one) => one.courtId === courtId);
  return court === undefined ? null : courtDay(court);
}
