import type { PadText, PadVar } from '@/domain/scoring/padView';
import { sideNames, type SetBasedSide } from '@/domain/scoring/setBasedSides';

/**
 * What the set-based sports (badminton, table tennis) ask alike when a scorer gives a side a card (plan S2-2 Task 6,
 * lifted from badminton's sanction steps; design §6): the sheet that asks the level, the sheet that asks the person from
 * the side's players, and the person a choice names. A generic file: it names no sport and no dictionary. Each sport
 * hands in its own words (`K` is its key union) and decides its own steps (badminton has a confirm and a person always;
 * table tennis asks the person only of a pair).
 */

/** One choice on a step's sheet. */
export type SanctionOption<K extends string> = {
  readonly id: string;
  /** A level's word, or a player's name as typed. */
  readonly label: PadVar<K>;
  readonly tone: 'standard' | 'destructive';
};

/** One step as a sheet asks it: a title, a line naming what is already chosen, and the choices. */
export type SanctionSheet<K extends string> = {
  readonly title: PadText<K>;
  readonly body: PadVar<K>;
  readonly options: readonly SanctionOption<K>[];
};

/** The player a person step's choice names: the option's id is the player's place in the side's list, counted from 0. */
export function playerChosen(side: SetBasedSide, choice: string): string | undefined {
  return side.players.find((_, at) => String(at) === choice);
}

/** A side's players as the person step offers them, each by its place (`playerChosen` reads it back). */
export function playerOptions<K extends string>(side: SetBasedSide): readonly SanctionOption<K>[] {
  return side.players.map((player, at) => ({ id: String(at), label: player, tone: 'standard' }));
}

/** The level step: the side's names as the body, and the sport's levels as the choices. */
export function levelSheet<K extends string>(
  title: PadText<K>,
  side: SetBasedSide,
  options: readonly SanctionOption<K>[],
): SanctionSheet<K> {
  return { title, body: sideNames(side), options };
}

/** The person step: the level already chosen as the body, and the side's players as the choices. */
export function personSheet<K extends string>(
  title: PadText<K>,
  side: SetBasedSide,
  level: PadVar<K>,
): SanctionSheet<K> {
  return { title, body: level, options: playerOptions<K>(side) };
}
