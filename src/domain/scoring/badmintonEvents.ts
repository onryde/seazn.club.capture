import type {
  BadmintonDisplay,
  BadmintonSanction,
  BadmintonTap,
} from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import {
  payloadForFirstSend,
  rallyPayload,
  sanctionPayload,
  standing,
} from '@/domain/scoring/setBasedEvents';
import { seatsOf, soleOf, type Seats } from '@/domain/scoring/setBasedSides';
import type { Bootstrap, BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * A pad tap as the event the server records (design §7.3; plan S2-1 Task 7). The top half is `home`, the bottom `away`
 * (layout A). The engine judges whether the event is legal now (`foldBadminton`'s `legalQueued`); this decides only
 * what the tap is, and refuses (null) a tap that names what the match does not have: an empty seat, a person who does
 * not play for the side, or an ending with no disqualification of that side waiting. The pad ends a match only that
 * way: it never writes `core.settle` or `core.abandon`, and `core.forfeit` only as a disqualification's ending.
 */
export type BadmintonEvent = { readonly type: string; readonly payload: unknown };

/** The match, and the display the tap was made on: `foldBadminton`'s, whose `serverPicked` says when to send the pick. */
export type BadmintonEventContext = {
  readonly bootstrap: Bootstrap;
  readonly display: BadmintonDisplay;
};

export function badmintonEventFor(
  tap: BadmintonTap,
  { bootstrap, display }: BadmintonEventContext,
): BadmintonEvent | null {
  const seats = seatsOf(bootstrap);
  if (seats === null) return null;
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'rally':
      return rallyEvent(seats, tap.side, display);
    case 'sanction':
      return sanctionEvent(seats[tap.side], tap);
    case 'setScore':
      return {
        type: 'badminton.game.summary',
        payload: { home: tap.first, away: tap.second, partial: true },
      };
    case 'ending':
      return endingEvent(seats, display, tap.side);
  }
}

/**
 * A rally won by `side`. The match's first rally names the picked side's entrant as `serving`, which anchors the first
 * server (design §7.3). In singles it also names people, as the web's pad does (skins/badminton.tsx `buildHalf`; the
 * controller's ruling, 2026-11-02): `scorer`, the winner's one player, and `server`, the serving side's one player,
 * only while the server shown is the engine's (never a pick, never a guess). A pair names neither.
 */
function rallyEvent(seats: Seats, side: PadSide, display: BadmintonDisplay): BadmintonEvent {
  const serving = display.serverPicked ? display.server : null;
  const served = display.serverPicked ? null : display.server;
  const server = served === null ? null : soleOf(seats[served]);
  return { type: RALLY, payload: rallyPayload(seats, side, { serving, server }) };
}

/**
 * The person by the id the bootstrap gave for the name the pad offered; a name the side does not have is refused. A
 * side that lists no people is offered as its own name (`namesOf`), and that name is a team sanction, with no person
 * (`sanctionPayload`; the engine reads an absent `person` so, `SetBasedSanction`; device, 2026-11-03).
 */
function sanctionEvent(seat: BootstrapSide, sanction: BadmintonSanction): BadmintonEvent | null {
  const payload = sanctionPayload(seat, sanction.level, sanction.person);
  return payload === null ? null : { type: 'badminton.sanction', payload };
}

/**
 * The ending of the disqualification waiting, by the side it disqualified. The engine takes a forfeit by either side
 * there, so a tap naming the other side would hand the match to the side disqualified: it is refused.
 */
function endingEvent(
  seats: Seats,
  display: BadmintonDisplay,
  side: PadSide,
): BadmintonEvent | null {
  const waiting = display.awaitingEnding
    ? display.sanctions[display.sanctions.length - 1]
    : undefined;
  if (waiting?.level !== 'disqualification' || waiting.side !== side) return null;
  return { type: 'core.forfeit', payload: { by: seats[side].entrantId, reason: 'disqualified' } };
}

const RALLY = 'badminton.rally';

/**
 * The payload to send for a queued tap (the controller's ruling, 2026-11-02): the match's first rally (the one tap
 * that carries `serving`, `badmintonEventFor`) drops it at its first send if a rally already stands in the server's
 * ledger (a co-scorer's landed first): the engine would ignore it there, and its drift check would then name no server
 * for the rest of game 1. An undone rally does not count as played (the controller's ruling, 2026-11-02). A tap with an attempt keeps what it was first sent with, since the server
 * may hold it under its key already (a tap in flight has one: `markSending` counts it as the send starts). Every other
 * tap goes as queued. The key never changes.
 */
export function payloadForSend(queued: QueuedEvent, ledger: readonly LedgerEvent[]): unknown {
  return payloadForFirstSend(queued, () => standing(ledger, RALLY).length > 0);
}
