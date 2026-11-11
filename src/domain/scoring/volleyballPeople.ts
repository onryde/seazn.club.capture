import type { PadSide } from '@/domain/scoring/padView';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import type { Bootstrap, BootstrapSide } from '@/domain/scoring/wire';

/**
 * The people a side's sub and sanction sheets offer (S2-6 Task 7; rulings 182, 187), read from the bootstrap's team sheet:
 * each row's person, named by the member the web lists, in the sheet's order. A row with no member has no name to show and
 * is not offered. `official` is a coach or staff row (the web's `lineups.role`): a sub offers players only, a sanction
 * players first and then the officials. Anyone on the sheet is offered whether or not the scorer thinks they are on court:
 * the phone does not track who has come on (ruling 182).
 */
export type VolleyballPerson = {
  readonly personId: string;
  readonly name: string;
  readonly official: boolean;
};

export type VolleyballPeople = Readonly<Record<PadSide, readonly VolleyballPerson[]>>;

const NOBODY: VolleyballPeople = { first: [], second: [] };

function peopleOfSide(seat: BootstrapSide): readonly VolleyballPerson[] {
  return seat.lineup.flatMap((row) => {
    const member = seat.members.find((one) => one.personId === row.personId);
    if (member === undefined) return [];
    return [
      {
        personId: row.personId,
        name: member.fullName,
        official: row.role !== undefined && row.role !== 'player',
      },
    ];
  });
}

/** Both sides' people, top first; nobody while either seat is empty. */
export function volleyballPeopleOf(bootstrap: Bootstrap): VolleyballPeople {
  const seats = seatsOf(bootstrap);
  return seats === null
    ? NOBODY
    : { first: peopleOfSide(seats.first), second: peopleOfSide(seats.second) };
}

/** Players first, then officials, each in the sheet's order. */
export const playersFirst = (people: readonly VolleyballPerson[]): readonly VolleyballPerson[] => [
  ...people.filter((one) => !one.official),
  ...people.filter((one) => one.official),
];

export const playersOf = (people: readonly VolleyballPerson[]): readonly VolleyballPerson[] =>
  people.filter((one) => !one.official);
