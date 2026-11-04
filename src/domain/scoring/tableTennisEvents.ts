import { tabletennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportEvent } from '@/domain/scoring/scoringSport';
import {
  payloadForFirstSend,
  rallyPayload,
  sanctionPayload,
  standing,
  type VoidableEvent,
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
const SUMMARY = 'tabletennis.game.summary';
const R = tabletennisPadRules;

/**
 * The score events standing in `events`, the ledger's or the fold's stream: the points and the game scores no void takes
 * back. The one count the display (`TableTennisDisplay.scoreEvents`) and a send's check (`tableTennisPayloadForSend`)
 * share, so a tap's `base` and the ledger's count are always the same measure.
 */
export const scoreEventsIn = (events: readonly VoidableEvent[]): number =>
  standing(events, RALLY, SUMMARY).length;

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
        type: SUMMARY,
        payload: { home: tap.first, away: tap.second, partial: true },
      };
  }
}

/**
 * The answer to Who is serving? that a rally may carry: only where the pad needs one (`anchorNeeded`) and at the score it
 * was made at (`servingAt`, the display's count of score events then). With a pick standing, or a server the engine
 * names, the answer is stale or was never asked for (plan S2-2 Task 7, fix round 1); and one made at another count was
 * made to a score that no longer stands (fix round 2, M1 of the Batch C review). Either is dropped here, whatever the
 * caller held, so the engine is never handed a `serving` it would take as an anchor at a score it was not made at.
 */
const answered = (
  tap: Extract<TableTennisTap, { readonly kind: 'rally' }>,
  display: TableTennisDisplay,
): PadSide | null =>
  display.anchorNeeded && tap.servingAt === display.scoreEvents ? tap.serving : null;

/**
 * A rally won by `tap.side`. It names `serving`, the side that served, only when the scorer said so: the answer held
 * from Who is serving? (`tap.serving`), else this phone's Start pick while it is the server shown. The engine's own
 * belief is never stamped, as the web's pad leaves it off the ordinary tap (tabletennis.tsx `buildHalf`): the engine
 * checks a rally's `serving` against that belief, and a pad that filled it in would make the check agree with itself.
 * A stamp is valid only at the score it was made at, so a rally that names one carries `base`, the display's count of
 * score events (`scoreEvents`), for its first send to judge whether the score has moved.
 */
function rallyEvent(
  seats: Seats,
  tap: Extract<TableTennisTap, { readonly kind: 'rally' }>,
  display: TableTennisDisplay,
): SportEvent {
  const serving = answered(tap, display) ?? (display.serverPicked ? display.server : null);
  const server = servingPerson(seats, display);
  const payload = rallyPayload(seats, tap.side, { serving, server });
  return serving === null
    ? { type: RALLY, payload }
    : { type: RALLY, payload, base: display.scoreEvents };
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
 * The payload to send for a queued tap (the controller's rulings, 2026-11-03 and, fix rounds 1 and 2, 2026-11-04): a
 * rally holding the answer to Who is serving? (or the Start pick) goes without `serving` at its first send when
 *
 *  - it carries a `base` and the ledger's count of score events is not that `base`. The phone sends `serving` only while
 *    the engine says the anchor is needed (`rallyEvent`), so a count equal to `base` is the ledger the phone saw when it
 *    asked, and the answer is what the engine needs, whatever stamps stand in it: after a game whose stamps disagree
 *    (`alternation-disputed`) the engine re-anchors from the next declaration, so an earlier game's stamp is no reason to
 *    drop it. A count that moved is a score that moved: the fixed-turns rotation takes any `serving` as an anchor and
 *    works back from the turn parity, so a stamp made at 0–0 that lands after 2 or 3 co-scorer points makes the engine
 *    name the wrong next server for the whole match; or
 *  - it carries no `base` (a queue file from before it existed) and a rally that carries `serving` already stands. With
 *    no count to judge by, a stamp that stands is taken as the anchor the engine keeps (it ignores a later one in the
 *    ordinary case and its drift check would only name the disagreement), so a second would blur the first. That is
 *    wrong for the one case where the engine re-anchors, `alternation-disputed`, which is why a count judges a tap that
 *    has one.
 *
 * Unlike badminton, a rally that carries none does not make the stamp stale by itself (a lost anchor is never recovered
 * from later rallies, design §4.1), only a moved score does. An undone point does not count as played. A tap that has
 * been sent before is judged in the same way unless the ledger holds its copy (`copied`): the web matches a resend by its
 * key and never compares payloads, so a first attempt it never stored is appended as new, with the stamp it was made
 * with at another score. The rest is `payloadForFirstSend`'s.
 */
export function tableTennisPayloadForSend(
  queued: QueuedEvent,
  ledger: readonly LedgerEvent[],
  copied: boolean,
): unknown {
  return payloadForFirstSend(
    queued,
    () =>
      queued.base === undefined
        ? standing(ledger, RALLY).some(namesServing)
        : scoreEventsIn(ledger) !== queued.base,
    copied,
  );
}

const namesServing = ({ payload }: LedgerEvent) => isRecord(payload) && 'serving' in payload;
