import type {
  BadmintonDisplay,
  BadmintonSanction,
  BadmintonTap,
} from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import type { Bootstrap, BootstrapSide } from '@/domain/scoring/wire';

/**
 * A pad tap as the event the server records (design §7.3; plan S2-1 Task 7). The top half is `home`, the bottom `away`
 * (layout A). The engine judges whether the event is legal now (`foldBadminton`'s `legalQueued`); this decides only
 * what the tap is, and refuses (null) a tap that names what the match does not have: an empty seat, a person who does
 * not play for the side, or an ending with no disqualification of that side waiting. The pad ends a match only that
 * way: it never writes `core.settle` or `core.abandon`, and `core.forfeit` only as a disqualification's ending.
 */
export type BadmintonEvent = { readonly type: string; readonly payload: unknown };

export type BadmintonEventContext = {
  readonly bootstrap: Bootstrap;
  readonly display: BadmintonDisplay;
  /** The side this phone picked to serve first on the Start screen, or null (none picked here). */
  readonly toss: PadSide | null;
};

type Seats = Readonly<Record<PadSide, BootstrapSide>>;

/** The two seats, top first, or null while either has no entrant (a bye, a match waiting on a result). */
export function seatsOf(bootstrap: Bootstrap): Seats | null {
  const { home, away } = bootstrap.sides;
  return home === null || away === null ? null : { first: home, second: away };
}

export function badmintonEventFor(
  tap: BadmintonTap,
  { bootstrap, display, toss }: BadmintonEventContext,
): BadmintonEvent | null {
  const seats = seatsOf(bootstrap);
  if (seats === null) return null;
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'rally':
      return rallyEvent(seats, tap.side, display.phase === 'pre' ? toss : null);
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

/** The match's first rally names the toss side's entrant as serving, which anchors the first server (design §7.3). */
function rallyEvent(seats: Seats, side: PadSide, serving: PadSide | null): BadmintonEvent {
  const wonBy = seats[side].entrantId;
  const payload = serving === null ? { wonBy } : { wonBy, serving: seats[serving].entrantId };
  return { type: 'badminton.rally', payload };
}

/** The person by the id the bootstrap gave for the name the pad offered; a name the side does not have is refused. */
function sanctionEvent(seat: BootstrapSide, sanction: BadmintonSanction): BadmintonEvent | null {
  const member = seat.members.find((one) => one.fullName === sanction.person);
  if (member === undefined) return null;
  return {
    type: 'badminton.sanction',
    payload: { by: seat.entrantId, level: sanction.level, person: member.personId },
  };
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
