import { tabletennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportEvent } from '@/domain/scoring/scoringSport';
import {
  payloadForFirstSend,
  rallyPayload,
  sanctionPayload,
  standing,
} from '@/domain/scoring/setBasedEvents';
import { seatsOf, soleOf, type Seats } from '@/domain/scoring/setBasedSides';
import type { PadSide } from '@/domain/scoring/padView';
import type { TableTennisDisplay, TableTennisTap } from '@/domain/scoring/tableTennisPad';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';

/**
 * A pad tap as the event the server records (design §4; plan S2-2 Task 4). The top half is `home`, the bottom `away`.
 * The engine judges whether the event is legal now (`foldTableTennis`'s `legalQueued`); this decides only what the tap
 * is, and refuses (null) a tap that names what the match does not have: an empty seat, a person who does not play for
 * the side, or a 13 returns point the receiver cannot take. The pad ends no match: it never writes `core.forfeit`,
 * `core.settle` or `core.abandon` (a device link gets 403 for them), and table tennis declares no sanction ending.
 */

/** The match, and the display the tap was made on: `foldTableTennis`'s, whose `serverPicked` says what the server is. */
export type TableTennisEventContext = {
  readonly bootstrap: Bootstrap;
  readonly display: TableTennisDisplay;
};

const RALLY = 'tabletennis.rally';
const R = tabletennisPadRules;

/** The engine's name for each half: the top side is home. */
const ENGINE_SIDE = { first: 'home', second: 'away' } as const;

export function tableTennisEventFor(
  tap: TableTennisTap,
  { bootstrap, display }: TableTennisEventContext,
): SportEvent | null {
  const seats = seatsOf(bootstrap);
  if (seats === null) return null;
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'rally':
      return rallyEvent(seats, tap, display);
    case 'returns':
      return returnsEvent(seats, tap.side, display);
    case 'timeout':
      return { type: 'tabletennis.timeout', payload: { by: seats[tap.side].entrantId } };
    case 'expedite':
      return { type: 'tabletennis.expedite.start', payload: {} };
    case 'sanction': {
      const payload = sanctionPayload(seats[tap.side], tap.level, tap.person);
      return payload === null ? null : { type: 'tabletennis.sanction', payload };
    }
    case 'setScore':
      return {
        type: 'tabletennis.game.summary',
        payload: { home: tap.first, away: tap.second, partial: true },
      };
  }
}

/**
 * A rally won by `tap.side`. It names `serving`, the side that served, only when the scorer said so: the answer held
 * from Who is serving? (`tap.serving`), else this phone's Start pick while it is the server shown. The engine's own
 * belief is never stamped, as the web's pad leaves it off the ordinary tap (tabletennis.tsx `buildHalf`): the engine
 * checks a rally's `serving` against that belief, and a pad that filled it in would make the check agree with itself.
 */
function rallyEvent(
  seats: Seats,
  tap: Extract<TableTennisTap, { readonly kind: 'rally' }>,
  display: TableTennisDisplay,
): SportEvent {
  const serving = tap.serving ?? (display.serverPicked ? display.server : null);
  const server = servingPerson(seats, display);
  return { type: RALLY, payload: rallyPayload(seats, tap.side, { serving, server }) };
}

/**
 * The player serving, a person's id, as the web stamps it (`servingInfo`: the engine's doubles server, else the serving
 * side's one player): only while the server shown is the engine's, never a pick. The fold names no singles person
 * (`serverPersonId` is a doubles pair order's), so a singles side's one player is read from its lineup.
 */
function servingPerson(seats: Seats, display: TableTennisDisplay): string | null {
  if (display.serverPicked) return null;
  if (display.serverPersonId !== null) return display.serverPersonId;
  return display.server === null ? null : soleOf(seats[display.server]);
}

/**
 * The point the receiver wins on their thirteenth good return (ITTF 2.15.4; design §4.5), only where the engine would
 * take it and could not check it: Expedite in force, the server named by the engine (never a pick, which anchors
 * nothing) and the point the receiver's. It names no `serving` and no `server`: the engine counts such a rally unchecked,
 * and this gate, with the fold's own (`mayCreditReceiver`), is the check.
 */
function returnsEvent(seats: Seats, side: PadSide, display: TableTennisDisplay): SportEvent | null {
  const { server } = display;
  if (display.expedite !== 'inForce' || display.serverPicked || server === null) return null;
  if (!R.expediteReturnsCreditable(ENGINE_SIDE[server], ENGINE_SIDE[side])) return null;
  return { type: RALLY, payload: rallyPayload(seats, side, { returns: R.expediteReturns }) };
}

/**
 * The payload to send for a queued tap (the controller's ruling, 2026-11-03, after badminton's): a rally holding the
 * answer to Who is serving? (or the Start pick) goes without `serving` at its first send only if a rally that carries
 * one already stands in the server's ledger. The engine takes the first `serving` as the anchor and ignores a later one
 * (its drift check names the disagreement), so a second would only blur the first. Unlike badminton, rallies that carry
 * none do not make it stale: table tennis's rotation never recovers a lost anchor from them, so this answer is its only
 * one (design §4.1). An undone rally does not count as played. The rest is `payloadForFirstSend`'s.
 */
export function tableTennisPayloadForSend(
  queued: QueuedEvent,
  ledger: readonly LedgerEvent[],
): unknown {
  return payloadForFirstSend(queued, () => standing(ledger, RALLY).some(namesServing));
}

const namesServing = ({ payload }: LedgerEvent) => isRecord(payload) && 'serving' in payload;
