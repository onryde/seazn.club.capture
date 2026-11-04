import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { soleOf, type Seats } from '@/domain/scoring/setBasedSides';
import type { BootstrapSide } from '@/domain/scoring/wire';

/**
 * What the set-based sports (badminton, table tennis) do the same way when a pad tap becomes the event the server
 * records (plan S2-2 Task 4; design §6, the lift rule): the rally's payload, a card's payload, the ledger's standing
 * events and the first send's `serving`. A generic file: it names no sport, and each sport's own event file (`badmintonEvents`)
 * keeps what is its own, which side it names as serving and what ends a pick's life.
 */

/** What a rally can say besides who won it: the side that served it, the serving person and the receiver's returns. */
export type RallyFacts = {
  readonly serving?: PadSide | null;
  readonly server?: string | null;
  readonly returns?: number;
};

/**
 * A rally won by `winner`, the engine's `SetBasedRally`: `wonBy` always; `serving` (the side, as its entrant) and
 * `server` (a person) when given; `scorer` only for a singles winner, the one player, as the web's pad stamps it
 * (skins/badminton.tsx and tabletennis.tsx `buildHalf`; a pair is not asked, S2 ruling 5); `returns` when counted.
 */
export function rallyPayload(seats: Seats, winner: PadSide, facts: RallyFacts = {}) {
  const { serving = null, server = null, returns } = facts;
  const scorer = soleOf(seats[winner]);
  return {
    wonBy: seats[winner].entrantId,
    ...(serving === null ? {} : { serving: seats[serving].entrantId }),
    ...(server === null ? {} : { server }),
    ...(scorer === null ? {} : { scorer }),
    ...(returns === undefined ? {} : { returns }),
  };
}

/**
 * A card against `seat`'s side: the person by the id the bootstrap gave for the name the pad offered, a name the side
 * does not list refused (null). A side that lists no people is offered as its own name (`namesOf`), and that name is a
 * team sanction with no person, which the engine reads for an absent `person` (device, 2026-11-03); so is a card
 * given no person at all.
 */
export function sanctionPayload(
  seat: BootstrapSide,
  level: string,
  person: string | null,
): { readonly by: string; readonly level: string; readonly person?: string } | null {
  const by = seat.entrantId;
  if (person === null) return { by, level };
  if (seat.members.length === 0) return person === seat.name ? { by, level } : null;
  const member = seat.members.find((one) => one.fullName === person);
  return member === undefined ? null : { by, level, person: member.personId };
}

/** An event a void can take back: the server's ledger event, and the engine's envelope the fold makes of it, alike. */
export type VoidableEvent = {
  readonly id: string;
  readonly type: string;
  readonly voids?: string | null;
};

/** The events of any of `types` that no other event voids (an undone point does not count as played), in order. */
export function standing<E extends VoidableEvent>(
  events: readonly E[],
  ...types: readonly string[]
): readonly E[] {
  const voided = new Set(
    events.flatMap((event) => (typeof event.voids === 'string' ? [event.voids] : [])),
  );
  return events.filter((event) => types.includes(event.type) && !voided.has(event.id));
}

/**
 * The payload to send for a queued tap whose `serving` anchors the server (the controller's ruling, 2026-11-02): it goes
 * without `serving` when `taken()` says the ledger already holds what the engine would take the anchor from, or what the
 * stamp was made against has moved (a co-scorer's landed first: the engine would ignore it there, and its drift check
 * could then name no server). A tap goes as queued while `copied`: the ledger holds the server's copy of it, which the web
 * matches by the tap's key and never by its payload (a tap in flight has an attempt: `markSending` counts it as the send
 * starts, so only a tap sent before can have a copy). A tap sent before whose copy is not there may never have been
 * stored, and a resend is then appended as new (fix round 2, I2 of the Batch C review): it is judged as a first send is.
 * Every other tap goes as queued. The key never changes. `taken` is asked only for a tap that could lose something.
 */
export function payloadForFirstSend(
  queued: QueuedEvent,
  taken: () => boolean,
  copied: boolean,
): unknown {
  const { payload } = queued;
  if (!isRecord(payload) || !('serving' in payload)) return payload;
  if (copied) return payload;
  if (!taken()) return payload;
  const { serving: _dropped, ...rest } = payload;
  return rest;
}
