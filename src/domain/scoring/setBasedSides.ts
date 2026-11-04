import type { PadSide } from '@/domain/scoring/padView';
import type { Bootstrap, BootstrapMember, BootstrapSide } from '@/domain/scoring/wire';

/**
 * How the set-based sports (badminton, table tennis) read a match's sides, which is the same word for word (plan S2-2
 * Task 2): who sits on top, a singles side's one player, a side's names as one line, a score as one string. A generic
 * file: it names no sport, and a sport's own files (`badmintonPad`, `badmintonEvents`) read the sides through here.
 */

/** A side's players as the organiser typed them: one in singles, two in doubles. */
export type SetBasedSide = { readonly players: readonly string[] };

/** The two seats, top first. */
export type Seats = Readonly<Record<PadSide, BootstrapSide>>;

/** The two seats, top first, or null while either has no entrant (a bye, a match waiting on a result). */
export function seatsOf(bootstrap: Bootstrap): Seats | null {
  const { home, away } = bootstrap.sides;
  return home === null || away === null ? null : { first: home, second: away };
}

/** A singles side's one player, or null for a pair (the web's `soleMemberOf`: the lineup, by its length). */
export function soleOf(seat: BootstrapSide): string | null {
  const [only, ...more] = seat.lineup;
  return only !== undefined && more.length === 0 ? only.personId : null;
}

/** A side's names as one line: partners joined, as the match label joins them. */
export function sideNames(side: SetBasedSide): string {
  return side.players.join(' / ');
}

/** A score, top first, an en dash between ("7–3"): numbers are not translated (docs/i18n-glossary.md, Typography). */
export const scoreText = ({ first, second }: { readonly first: number; readonly second: number }) =>
  `${first}–${second}`;

/** The sides as a ledger fold names them: the entrant ids top first, the players as typed, and who plays for each. */
export type SetBasedNames = {
  readonly entrants: Readonly<Record<PadSide, string>>;
  readonly sides: Readonly<Record<PadSide, SetBasedSide>>;
  readonly members: Readonly<Record<PadSide, readonly BootstrapMember[]>>;
};

export function namesOf(seats: Seats): SetBasedNames {
  const players = (seat: BootstrapSide): SetBasedSide => ({
    players: seat.members.length === 0 ? [seat.name] : seat.members.map((one) => one.fullName),
  });
  return {
    entrants: { first: seats.first.entrantId, second: seats.second.entrantId },
    sides: { first: players(seats.first), second: players(seats.second) },
    members: { first: seats.first.members, second: seats.second.members },
  };
}

/** The half an entrant id is, or null for an id that is neither side's. */
export function sideOfEntrant(names: SetBasedNames, entrantId: unknown): PadSide | null {
  if (entrantId === names.entrants.first) return 'first';
  return entrantId === names.entrants.second ? 'second' : null;
}

/** A named person's name as typed; with none named (or one the side does not list), the side's names. */
export function personName(names: SetBasedNames, side: PadSide, personId: unknown): string {
  const member = names.members[side].find((one) => one.personId === personId);
  return member?.fullName ?? sideNames(names.sides[side]);
}
