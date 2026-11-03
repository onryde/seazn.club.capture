import type { PadSide } from '@/domain/scoring/padView';
import type { Bootstrap, BootstrapSide } from '@/domain/scoring/wire';

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
