import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportEvent, SportEventContext } from '@/domain/scoring/scoringSport';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import { isBreakKind, isSeenLevel } from '@/domain/scoring/tennisLedgerHistory';
import type { TennisDisplay, TennisTap, TennisTypes } from '@/domain/scoring/tennisTypes';
import type { BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * A pad tap as the event the server records (S2-7 Task 5; spec §3, rulings 215, 217-221), volleyball's twin
 * (`volleyballEvents`). The top half is `home`, the bottom `away`. The engine judges whether the event is legal now
 * (`foldTennis`'s `legalQueued`); this decides only what the tap is, and refuses (null) a tap that names what the match does
 * not have: an empty seat, a person the side does not list, a level or a break kind the pad does not send. The pad never
 * writes `core.forfeit`, `core.settle`, `core.abandon`, a sanction at level `default`, a point with `server`, `scorer` or
 * `meta`, a break with `person`, `duration` or `at`, or a `reason` on a sanction or an award (AGENTS §1; rulings 217, 218,
 * 220).
 */

type Context = SportEventContext<TennisTypes>;
type Seats = NonNullable<ReturnType<typeof seatsOf>>;

/** The levels a phone sends: the engine's ladder without `default`, which is the organiser's (ruling 218). */
const isSentLevel = (level: unknown): boolean => isSeenLevel(level) && level !== 'default';

export function tennisEventFor(tap: TennisTap, { bootstrap, display }: Context): SportEvent | null {
  const seats = seatsOf(bootstrap);
  if (seats === null) return null;
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'toss':
      return tossEvent(seats, tap.side, display);
    case 'point':
      return { type: 'tennis.point', payload: { by: seats[tap.side].entrantId } };
    case 'setScore':
      return setScoreEvent(tap);
    case 'violation':
      return violationEvent(seats, tap);
    case 'award':
      return { type: 'tennis.game.award', payload: { winner: seats[tap.side].entrantId } };
    case 'break':
      return breakEvent(seats, tap);
  }
}

/**
 * Who serves first, `{serving}` and nothing else (engine 8.0.0, ruling 233). Only at the Start screen, on a match with no
 * toss held: the engine would take a late toss and re-seat every serve already played, which is the organiser's call and
 * never the phone's (the controller's ruling 2), and a second pick over another scorer's would be refused anyway.
 */
function tossEvent(seats: Seats, side: PadSide, display: TennisDisplay): SportEvent | null {
  if (display.phase !== 'notStarted' || display.toss !== null) return null;
  return { type: 'tennis.toss', payload: { serving: seats[side].entrantId } };
}

/** A set's games, and the tie-break's points only for a set that had one. */
function setScoreEvent(tap: Extract<TennisTap, { readonly kind: 'setScore' }>): SportEvent {
  const { tb } = tap;
  return {
    type: 'tennis.set_summary',
    payload: {
      home: tap.first,
      away: tap.second,
      ...(tb === null ? {} : { tb: { home: tb.first, away: tb.second } }),
    },
  };
}

/** Whether `id` is on the side's sheet: a person is named by the id the bootstrap gave, never typed. */
const listed = (seat: BootstrapSide, id: string): boolean =>
  seat.lineup.some((row) => row.personId === id);

/** A violation against the side, or one of its players; a person the side does not list, or a level not sent, is refused. */
function violationEvent(
  seats: Seats,
  tap: Extract<TennisTap, { readonly kind: 'violation' }>,
): SportEvent | null {
  const seat = seats[tap.side];
  const { person } = tap;
  if (!isSentLevel(tap.level)) return null;
  if (person !== null && !listed(seat, person)) return null;
  return {
    type: 'tennis.sanction',
    payload: {
      by: seat.entrantId,
      level: tap.level,
      ...(person === null ? {} : { person }),
    },
  };
}

/** A break of a kind the engine lists, for a side, or for none ("Both / none": no `by`). */
function breakEvent(
  seats: Seats,
  tap: Extract<TennisTap, { readonly kind: 'break' }>,
): SportEvent | null {
  if (!isBreakKind(tap.breakKind)) return null;
  return {
    type: 'tennis.interruption',
    payload: {
      kind: tap.breakKind,
      ...(tap.side === null ? {} : { by: seats[tap.side].entrantId }),
    },
  };
}

/**
 * The payload to send for a queued tap: as queued. Tennis holds no anchor (ruling 216: no serve question, and a point is
 * `{by}` alone), so nothing in a payload can go stale between its making and its send, and over one ledger the answer is
 * one payload however often it is asked.
 */
export function tennisPayloadForSend(
  queued: QueuedEvent,
  _ledger: readonly LedgerEvent[],
  _copied: boolean,
  _send: unknown,
): unknown {
  return queued.payload;
}
