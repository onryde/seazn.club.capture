import type { PadSide } from '@/domain/scoring/padView';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import type { Bootstrap, BootstrapSide, SlotKind } from '@/domain/scoring/wire';

/**
 * The people a side's sub and sanction sheets offer (S2-6 Task 7; rulings 182, 187), read from the bootstrap's team sheet:
 * each row's person, named by the member the web lists, in the sheet's order. A row with no member has no name to show and
 * is not offered. `official` is a coach or staff row (the web's `lineups.role`): a sub offers players only, a sanction
 * players first and then the officials. `slot` is the row's place on the sheet, which a sub's off step reads with the
 * match's swaps to list who is on court (`volleyballSub.ts`; F4).
 */
export type VolleyballSheetPerson = {
  readonly personId: string;
  readonly name: string;
  readonly official: boolean;
  /** Where the row sits on the team sheet; null when the side has no sheet (an older web): nobody is known to be on court. */
  readonly slot: SlotKind | null;
};

export type VolleyballPeople = Readonly<Record<PadSide, readonly VolleyballSheetPerson[]>>;

const NOBODY: VolleyballPeople = { first: [], second: [] };

function peopleOfSide(seat: BootstrapSide): readonly VolleyballSheetPerson[] {
  // As `teamSheetOf` reads it: a sheet is any row with a slot, and a row with none among them starts.
  const sheet = seat.lineup.some((row) => row.slot !== undefined);
  return seat.lineup.flatMap((row) => {
    const member = seat.members.find((one) => one.personId === row.personId);
    if (member === undefined) return [];
    return [
      {
        personId: row.personId,
        name: member.fullName,
        official: row.role !== undefined && row.role !== 'player',
        slot: sheet ? (row.slot ?? 'starting') : null,
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
export const playersFirst = (
  people: readonly VolleyballSheetPerson[],
): readonly VolleyballSheetPerson[] => [
  ...people.filter((one) => !one.official),
  ...people.filter((one) => one.official),
];

export const playersOf = (
  people: readonly VolleyballSheetPerson[],
): readonly VolleyballSheetPerson[] => people.filter((one) => !one.official);
