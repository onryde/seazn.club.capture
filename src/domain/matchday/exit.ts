import type { Court, MatchDay, Stake } from '@/domain/matchday/matchDay';
import type { ScoringHome, ScoringLeftover } from '@/domain/mode/scoringHome';

/**
 * Leaving Match Day (S4 design §4; MD-2 Task 7), pure. Exit never discards a tap: the words it asks with and the card
 * Home keeps afterwards are decided here, the screens only draw them.
 */

/** What the Exit question says under its title: nothing at stake, how many taps keep sending, or taps that cannot be read. */
export type ExitCopy =
  | { readonly body: 'matchday.exit.body' }
  | { readonly body: 'matchday.exit.bodySending'; readonly count: number }
  | { readonly body: 'matchday.exit.bodyAtRisk' };

/**
 * An unreadable queue is taps at risk, never none (review I1 of Task 4: the list says "Taps at risk" for it), so a count
 * cannot be said and the plain body never is: `unreadable` wins over any count.
 */
export function exitCopy(unsent: number, unreadable = false): ExitCopy {
  if (unreadable) return { body: 'matchday.exit.bodyAtRisk' };
  if (unsent <= 0) return { body: 'matchday.exit.body' };
  return { body: 'matchday.exit.bodySending', count: unsent };
}

/** The `matchday.exit` record line's `unsent`: the count, or null for a queue the phone could not read (never a made-up 0). */
export function exitRecorded(stake: Stake): number | null {
  return stake.unreadable ? null : stake.count;
}

/** The court a match sat on in this day (now, its queue or its finished ones), or null: it is on none, or is not listed. */
export function courtOf(day: MatchDay, fixtureId: string): string | null {
  const held = day.courts.find((court) => rowsOf(court).includes(fixtureId));
  return held === undefined ? null : held.courtName;
}

function rowsOf(court: Court): readonly string[] {
  const rows = [...(court.now === null ? [] : [court.now]), ...court.next, ...court.finished];
  return rows.map((row) => row.fixtureId);
}

/** One match's taps still sending after Exit, as Home says it: "Sending 3 taps · Court 2". */
export type SendingCard = {
  readonly fixtureId: string;
  /** The court it was opened from, else the match's own name; null when it has neither (Home says "another match"). */
  readonly name: string | null;
  readonly unsent: number;
};

/**
 * Home's Sending cards: every match Exit left sending (`courts`: fixture id to the court it was on, '' for none) whose
 * queue still holds taps it can send. A queue that cannot send (dead, held for the scorer's answer) or be read keeps the
 * card Home already has for it, with its Dismiss and its orange words, so it is never told as "sending". A match whose
 * queue has emptied has no card. The leftover cards of the matches that got one are taken out, so no match is counted
 * twice. The saved Remote Scoring match is not one of them: it says what is unsent on its own Continue card (owner
 * ruling T7 c1), so it gets no second card.
 */
export function sendingCards(
  courts: ReadonlyMap<string, string>,
  home: ScoringHome,
): { readonly cards: readonly SendingCard[]; readonly leftovers: readonly ScoringLeftover[] } {
  const cards: SendingCard[] = [];
  const leftovers = home.leftovers.filter((one) => {
    if (one.kind !== 'live' || !courts.has(one.fixtureId)) return true;
    add(cards, courts, one.fixtureId, one.label, one.unsent);
    return false;
  });
  return { cards, leftovers };
}

function add(
  cards: SendingCard[],
  courts: ReadonlyMap<string, string>,
  fixtureId: string,
  label: string,
  unsent: number,
): void {
  const court = courts.get(fixtureId);
  if (court === undefined || unsent === 0) return;
  const name = court !== '' ? court : label !== '' ? label : null;
  cards.push({ fixtureId, name, unsent });
}
