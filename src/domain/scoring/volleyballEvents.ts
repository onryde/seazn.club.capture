import { isRecord } from '@/domain/credentials/wire';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportEvent, SportEventContext } from '@/domain/scoring/scoringSport';
import { payloadForFirstSend, standing, type VoidableEvent } from '@/domain/scoring/setBasedEvents';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import type { VolleyballTap, VolleyballTypes } from '@/domain/scoring/volleyballTypes';
import type { BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * A pad tap as the event the server records (S2-6 Task 5; spec §4), table tennis's twin (`tableTennisEvents`). The top half
 * is `home`, the bottom `away`. The engine judges whether the event is legal now (`foldVolleyball`'s `legalQueued`); this
 * decides only what the tap is, and refuses (null) a tap that names what the match does not have: an empty seat, a person
 * the side does not list, a substitution in a match that records none. The pad never writes `core.forfeit`, `core.settle`,
 * `core.abandon`, `core.lineup.replacement`, an expedite, a timeout with `technical` or a rally with `scorer` (AGENTS §1;
 * rulings 171, 172, 174, 176).
 */

const RALLY = 'volleyball.rally';
const SUMMARY = 'volleyball.set.summary';

/**
 * The score events standing in `events`, the ledger's or the fold's stream: the rallies and the set scores no void takes
 * back. The one count the display (`VolleyballDisplay.scoreEvents`) and a send's check share, so a tap's `base` and the
 * ledger's count are always the same measure.
 */
export const scoreEventsIn = (events: readonly VoidableEvent[]): number =>
  standing(events, RALLY, SUMMARY).length;

type Context = SportEventContext<VolleyballTypes>;
type Display = Context['display'];
type RallyTap = Extract<VolleyballTap, { readonly kind: 'rally' }>;

export function volleyballEventFor(
  tap: VolleyballTap,
  { bootstrap, display }: Context,
): SportEvent | null {
  const seats = seatsOf(bootstrap);
  if (seats === null) return null;
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'rally':
      return rallyEvent(seats, tap, display);
    case 'timeout':
      return { type: 'volleyball.timeout', payload: { by: seats[tap.side].entrantId } };
    case 'sub':
      return subEvent(seats[tap.side], tap, display);
    case 'sanction':
      return sanctionEvent(seats[tap.side], tap);
    case 'setScore':
      return { type: SUMMARY, payload: { home: tap.first, away: tap.second, partial: true } };
  }
}

/**
 * The answer to Who serves first? that a rally may carry: only where the pad needs one (`anchorNeeded`) and at the score it
 * was made at (`servingAt`, the display's count of score events then). With a pick standing, or a server the engine
 * names, the answer is stale or was never asked for; one made at another count was made to a score that no longer stands
 * (a co-scorer's rally landed first: the deciding set's side-out answers instead, ruling 180). Either is dropped here,
 * whatever the caller held, so the engine is never handed a `serving` it would take as an anchor at a score it was not
 * made at.
 */
const answered = (tap: RallyTap, display: Display): PadSide | null =>
  display.anchorNeeded && tap.servingAt === display.scoreEvents ? tap.serving : null;

/**
 * A rally won by `tap.side`: `wonBy`, and `serving` (the side that served) only when the scorer said so: the held answer
 * (`tap.serving`), else this phone's Start pick while it is the server shown. The engine's own belief is never stamped
 * (its drift check would check itself). A stamp is valid only at the score it was made at, so a rally that names one
 * carries `base`, the display's count of score events, for its first send to judge whether the score has moved; so does a
 * rally naming a `server`, which is the engine's belief at that score (a co-scorer's side-out landing first moves the serve to
 * the other pair, and the name would then credit the wrong player). `server`
 * is beach's alone, and only the one the engine names from the declared pair order (rulings 173, 188), so indoor never
 * sends it and a deciding-set rally answered by the toss carries none (ruling 189). Never `scorer` (ruling 172).
 */
function rallyEvent(
  seats: NonNullable<ReturnType<typeof seatsOf>>,
  tap: RallyTap,
  display: Display,
): SportEvent {
  const serving = answered(tap, display) ?? (display.serverPicked ? display.serving : null);
  const server = display.beach && !display.serverPicked ? display.serverPersonId : null;
  const payload = {
    wonBy: seats[tap.side].entrantId,
    ...(serving === null ? {} : { serving: seats[serving].entrantId }),
    ...(server === null ? {} : { server }),
  };
  return serving === null && server === null
    ? { type: RALLY, payload }
    : { type: RALLY, payload, base: display.scoreEvents };
}

/** Whether `id` is on the side's sheet: a person is named by the id the bootstrap gave, never typed. */
const listed = (seat: BootstrapSide, id: string): boolean =>
  seat.lineup.some((row) => row.personId === id);

/** A substitution, in a match that records them, naming only people the side lists (ruling 182). */
function subEvent(
  seat: BootstrapSide,
  tap: Extract<VolleyballTap, { readonly kind: 'sub' }>,
  display: Display,
): SportEvent | null {
  if (!display.records.substitutions) return null;
  const named = [tap.off, tap.on].flatMap((id) => (id === undefined ? [] : [id]));
  if (!named.every((id) => listed(seat, id))) return null;
  const { off, on } = tap;
  return {
    type: 'volleyball.sub',
    payload: {
      by: seat.entrantId,
      ...(off === undefined ? {} : { off }),
      ...(on === undefined ? {} : { on }),
    },
  };
}

/** A sanction against the side, or one of its people; a person the side does not list is refused. */
function sanctionEvent(
  seat: BootstrapSide,
  tap: Extract<VolleyballTap, { readonly kind: 'sanction' }>,
): SportEvent | null {
  const { person } = tap;
  if (person !== null && !listed(seat, person)) return null;
  const payload = {
    by: seat.entrantId,
    level: tap.level,
    ...(person === null ? {} : { person }),
  };
  return { type: 'volleyball.sanction', payload };
}

/**
 * The payload to send for a queued tap (as `tableTennisPayloadForSend`): a rally holding the answer to Who serves first?
 * (or the Start pick) goes without `serving` at its first send when
 *
 *  - it carries a `base` and the ledger's count of score events is not that `base`: a count that moved is a score that
 *    moved, and the engine would take the stamp as an anchor at a score it was not made at; or
 *  - it carries no `base` (a queue file from before it existed) and a rally that carries `serving` already stands.
 *
 * An undone point does not count as played. A tap that has been sent before is judged in the same way unless the ledger
 * holds its copy (`copied`): the web matches a resend by its key and never compares payloads. The rest is
 * `payloadForFirstSend`'s. Over one ledger the answer is one payload, however often it is asked.
 */
export function volleyballPayloadForSend(
  queued: QueuedEvent,
  ledger: readonly LedgerEvent[],
  copied: boolean,
): unknown {
  const sent = payloadForFirstSend(
    queued,
    () =>
      queued.base === undefined
        ? standing(ledger, RALLY).some(namesServing)
        : scoreEventsIn(ledger) !== queued.base,
    copied,
  );
  return serverStale(queued, sent, ledger, copied) ? withoutServer(sent) : sent;
}

/**
 * A beach `server` was the engine's belief at the count the tap was made at (`base`): once the count has moved (a co-scorer's
 * rally landed first) the name may credit the wrong player, so it is dropped at a first send, as `serving` is. A tap whose
 * copy the ledger holds keeps what it was sent with, and one with no `base` (never made with a server) is left alone.
 */
function serverStale(
  queued: QueuedEvent,
  sent: unknown,
  ledger: readonly LedgerEvent[],
  copied: boolean,
): boolean {
  if (copied || queued.base === undefined) return false;
  return isRecord(sent) && 'server' in sent && scoreEventsIn(ledger) !== queued.base;
}

function withoutServer(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const { server: _dropped, ...rest } = payload;
  return rest;
}

const namesServing = ({ payload }: LedgerEvent) => isRecord(payload) && 'serving' in payload;
