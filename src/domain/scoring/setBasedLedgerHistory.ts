import type { EventEnvelope } from '@seazn/engine/core';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import type { SetBasedHistoryEntry } from '@/domain/scoring/setBasedHistory';
import { sideOfEntrant, type SetBasedNames } from '@/domain/scoring/setBasedSides';

/**
 * History from the ledger for the set-based sports (design §6.4; plan S2-1 Task 7, lifted for S2-2 Task 3): every
 * scorer's events as the server holds them, this phone's queued taps on top marked as sending, an event another event
 * voids marked undone in its place, a void never a row of its own. What a row says comes from the event and its fold (a
 * sport's `doneOf`), the one vocabulary the last-tap line speaks too; the score after a point is the engine's fold of the
 * ledger up to it. Own is `ownEventIds` (the caller's), never the device link, which a browser on the same link shares.
 * A generic file: it names no sport.
 */

/** What the fold says of one event, from the match's state just after it. */
export type EventFacts = {
  /** The game it was recorded in: a rally's own; anything else the game under way, or the next one between games. */
  readonly game: number;
  /** The points of the game it was recorded in, after it. */
  readonly after: Readonly<Record<PadSide, number>>;
  /** A rally's: whether it won the game or the match. */
  readonly won: 'none' | 'game' | 'match';
  /** The person of the latest sanction standing then, or null: a disqualification's ending names them. */
  readonly sanctionedPerson: string | null;
};

/** One event of the match as History reads it: the ledger's in seq order, then this phone's legal queued taps. */
export type LedgerEntry = {
  readonly envelope: EventEnvelope;
  readonly own: boolean;
  readonly sending: boolean;
};

/** An event the pad has words for: what it did (`D`, the sport's type), and its facts. */
export type Recorded<D> = { readonly did: D; readonly facts: EventFacts };

/** A payload's field, or undefined for a payload that is not an object. */
export const field = (payload: unknown, name: string): unknown =>
  isRecord(payload) ? payload[name] : undefined;

/** A set score on the pad: the top side's points first. */
export type SetScoreDone = {
  readonly kind: 'setScore';
  readonly first: number;
  readonly second: number;
};

/** A set score, top first: the positional form the pad writes, or the by-entrant form the engine also takes. */
export function summaryDone(names: SetBasedNames, payload: unknown): SetScoreDone | null {
  const home = field(payload, 'home');
  const away = field(payload, 'away');
  if (typeof home === 'number' && typeof away === 'number') {
    return { kind: 'setScore', first: home, second: away };
  }
  const by = sideOfEntrant(names, field(payload, 'by'));
  const forBy = field(payload, 'forBy');
  const forOpp = field(payload, 'forOpp');
  if (by === null || typeof forBy !== 'number' || typeof forOpp !== 'number') return null;
  return by === 'first'
    ? { kind: 'setScore', first: forBy, second: forOpp }
    : { kind: 'setScore', first: forOpp, second: forBy };
}

/**
 * History's rows: one for each event the pad has words for (`recorded`, by envelope id), in the match's order, undone
 * when a void takes it back (`voided`), sending when it is this phone's queued tap. The sport's history groups them by
 * game, newest first (`setBasedHistory`).
 */
export function ledgerRows<D>(
  entries: readonly LedgerEntry[],
  recorded: ReadonlyMap<string, Recorded<D>>,
  voided: ReadonlySet<string>,
): readonly SetBasedHistoryEntry<D>[] {
  return entries.flatMap((entry) => {
    const event = recorded.get(entry.envelope.id);
    if (event === undefined) return [];
    return [
      {
        did: event.did,
        game: event.facts.game,
        after: event.facts.after,
        own: entry.own,
        undone: voided.has(entry.envelope.id),
        sending: entry.sending,
      },
    ];
  });
}
