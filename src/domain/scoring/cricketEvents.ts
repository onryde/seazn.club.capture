import { cricketPadRules } from '@seazn/engine/pad';
import { BALL, SUPER_OVER_BALL } from '@/domain/scoring/cricketDone';
import type {
  CricketBallTap,
  CricketDisplay,
  CricketTap,
  CricketTypes,
  CricketWicketTap,
} from '@/domain/scoring/cricketTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportEvent, SportEventContext } from '@/domain/scoring/scoringSport';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import type { LedgerEvent } from '@/domain/scoring/wire';

/**
 * A cricket tap as the event the server records (S2-4 spec §4.2 to §4.10; plan Task 6). Who bats and bowls, the over and
 * the ball in it are read off the display, which already carries every pending pick (the openers, the over's bowler, a
 * hand swap, a super over's replacement), so a ball names exactly what the scorer sees. The engine judges whether the
 * event is legal now (`foldCricket`'s `legalQueued`); this decides only what the tap is, and refuses (null) a tap that
 * names what the match does not have. No tap ends the match by force: nothing here writes `core.forfeit`, `core.settle`
 * or `core.abandon`.
 */
export function cricketEventFor(
  tap: CricketTap,
  { bootstrap, display }: SportEventContext<CricketTypes>,
): SportEvent | null {
  switch (tap.kind) {
    case 'toss': {
      const seats = seatsOf(bootstrap);
      if (seats === null) return null;
      return {
        type: 'cricket.toss',
        payload: { wonBy: seats[tap.wonBy].entrantId, elected: tap.elected },
      };
    }
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'ball':
      return ballEvent(tap.ball, display);
    case 'summary':
      return summaryEvent(tap);
    case 'retire':
      return retireEvent(tap);
    case 'more':
      return { type: tap.type, payload: tap.payload };
    case 'bowlerChange':
      return bowlerChangeEvent(tap);
  }
}

/**
 * A ball: the over and the ball in it from the legal balls bowled (both checked strictly by the server), the pair and the
 * bowler from the display. `freeHit` is never sent (the server refuses it unless one is pending, §4.2). Null while the
 * crease or the bowler is not known.
 */
function ballEvent(ball: CricketBallTap, display: CricketDisplay): SportEvent | null {
  const { innings, crease, bowler } = display;
  if (innings === null || crease === null || bowler === null) return null;
  const { ballsPerOver } = display.cfg;
  const extras = ball.extra === null ? {} : { extras: ball.extra };
  const wicket = ball.wicket === null ? {} : { wicket: wicketOf(ball.wicket, innings.superOver) };
  const boundary = boundaryOf(ball);
  return {
    type: innings.superOver ? SUPER_OVER_BALL : BALL,
    payload: {
      over: Math.floor(innings.legalBalls / ballsPerOver),
      ballInOver: (innings.legalBalls % ballsPerOver) + 1,
      striker: crease.striker.id,
      nonStriker: crease.nonStriker.id,
      bowler: bowler.id,
      runs: { bat: ball.bat, ...extras },
      ...wicket,
      ...(boundary === null ? {} : { boundary }),
    },
  };
}

/**
 * The boundary: the 4 and 6 keys (ruling 73), and a no-ball's 4 or 6 off the bat, which the no-ball sheet offers only as
 * boundaries (preflight F13; the web sends the same). An all-run 4 or 6 is More's and carries none.
 */
function boundaryOf(ball: CricketBallTap): 4 | 6 | null {
  if (ball.boundary !== null) return ball.boundary;
  const offTheBat = ball.extra?.kind === 'noball' && (ball.bat === 4 || ball.bat === 6);
  return offTheBat ? ball.bat : null;
}

/**
 * A dismissal. `bowlerCredited` follows the kind (the engine refuses one that does not, §4.3). `incoming` names the next
 * batter on a main-innings wicket, whose order is the phone's own; a super over ignores it, and its next ball names the
 * replacement (§4.6), so it is never sent there.
 */
function wicketOf(wicket: CricketWicketTap, superOver: boolean): Record<string, unknown> {
  const incoming = superOver || wicket.incoming === null ? {} : { incoming: wicket.incoming };
  return {
    kind: wicket.kind,
    out: wicket.out,
    ...(wicket.fielder === null ? {} : { fielder: wicket.fielder }),
    ...(wicket.fielderAssist === null ? {} : { fielderAssist: wicket.fielderAssist }),
    ...incoming,
    bowlerCredited: cricketPadRules.bowlerCreditedKinds.includes(wicket.kind),
  };
}

/** Over totals (§4.10): the innings' running totals, never closing it by themselves. */
function summaryEvent(tap: Extract<CricketTap, { readonly kind: 'summary' }>): SportEvent {
  const { runs, wickets, legalBalls } = tap;
  return {
    type: 'cricket.innings.summary',
    payload: { runs, wickets, legalBalls, partial: true },
  };
}

function retireEvent(tap: Extract<CricketTap, { readonly kind: 'retire' }>): SportEvent {
  const incoming = tap.incoming === null ? {} : { incoming: tap.incoming };
  return {
    type: 'cricket.retire',
    payload: { person: tap.person, reason: tap.reason, ...incoming },
  };
}

function bowlerChangeEvent(
  tap: Extract<CricketTap, { readonly kind: 'bowlerChange' }>,
): SportEvent {
  const reason = tap.reason === null ? {} : { reason: tap.reason };
  return { type: 'cricket.bowler.change', payload: { bowler: tap.bowler, ...reason } };
}

/**
 * The payload to send for a queued tap: what was queued, whether it is the first send or a resend. A ball is never
 * restamped to a later over or ball (Review Focus 1): if a co-scorer recorded that ball first, this one is a different
 * delivery the engine now refuses, and the fold leaves it out of `legalQueued` rather than file it as the next.
 */
export function cricketPayloadForSend(
  queued: QueuedEvent,
  _ledger: readonly LedgerEvent[],
  _copied: boolean,
): unknown {
  return queued.payload;
}
