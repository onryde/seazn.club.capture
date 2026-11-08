import type { EventEnvelope } from '@seazn/engine/core';
import {
  CricketBall,
  CricketBowlerChange,
  CricketInningsSummary,
  CricketRetire,
  CricketToss,
  type CricketBallEv,
} from '@seazn/engine/sports/cricket';
import type {
  CricketBallTap,
  CricketMoreType,
  CricketTap,
  CricketUndoneTap,
} from '@/domain/scoring/cricketTypes';
import type { PadSide } from '@/domain/scoring/padView';
import type { EventFacts } from '@/domain/scoring/setBasedLedgerHistory';
import type { Seats } from '@/domain/scoring/setBasedSides';

/**
 * A cricket event as the tap that recorded it (S2-4 plan Task 5), the one vocabulary the last-tap line and History speak:
 * the engine's own schemas read each payload (the fold has already taken it), and an event no tap makes (the console's
 * player lines, a lineup change) is null here. The words are the dictionary's (`cricketHistory.ts`).
 */

export const BALL = 'cricket.ball';
export const SUPER_OVER_BALL = 'cricket.superover.ball';

/** The types More records, each read as itself. */
export const MORE_TYPES: readonly CricketMoreType[] = [
  'cricket.innings.declare',
  'cricket.innings.close',
  'cricket.interruption',
  'cricket.revise',
  'cricket.newball',
  'cricket.powerplay',
  'cricket.followon',
  'cricket.match.close',
  'cricket.review',
];

/** What an event did, as the tap that records it; null for one no tap of the pad's makes. */
export function doneOf(envelope: EventEnvelope, seats: Seats): CricketTap | null {
  const { type, payload } = envelope;
  if (type === 'core.start') return { kind: 'start' };
  if (type === 'cricket.toss') return tossDone(payload, seats);
  if (type === BALL || type === SUPER_OVER_BALL) return ballDone(payload);
  if (type === 'cricket.innings.summary') return summaryDone(payload);
  if (type === 'cricket.retire') return retireDone(payload);
  if (type === 'cricket.bowler.change') return changeDone(payload);
  const more = MORE_TYPES.find((one) => one === type);
  return more === undefined ? null : { kind: 'more', type: more, payload };
}

function tossDone(payload: unknown, seats: Seats): CricketTap | null {
  const toss = CricketToss.safeParse(payload);
  if (!toss.success) return null;
  const wonBy = sideOfEntrant(seats, toss.data.wonBy);
  return wonBy === null ? null : { kind: 'toss', wonBy, elected: toss.data.elected };
}

function ballDone(payload: unknown): CricketTap | null {
  const ball = CricketBall.safeParse(payload);
  return ball.success ? { kind: 'ball', ball: ballTapOf(ball.data) } : null;
}

/** A ball's payload as the tap: who bats and bowls is the display's, so only what happened on it. */
export function ballTapOf(ball: CricketBallEv): CricketBallTap {
  const { wicket } = ball;
  return {
    bat: ball.runs.bat,
    extra: ball.runs.extras ?? null,
    boundary: ball.boundary ?? null,
    wicket:
      wicket === undefined
        ? null
        : {
            kind: wicket.kind,
            out: wicket.out,
            fielder: wicket.fielder ?? null,
            fielderAssist: wicket.fielderAssist ?? null,
            incoming: wicket.incoming ?? null,
          },
  };
}

function summaryDone(payload: unknown): CricketTap | null {
  const summary = CricketInningsSummary.safeParse(payload);
  if (!summary.success) return null;
  const { runs, wickets, legalBalls } = summary.data;
  return { kind: 'summary', runs, wickets, legalBalls };
}

function retireDone(payload: unknown): CricketTap | null {
  const retire = CricketRetire.safeParse(payload);
  if (!retire.success) return null;
  const { person, reason, incoming } = retire.data;
  return { kind: 'retire', person, reason, incoming: incoming ?? null };
}

function changeDone(payload: unknown): CricketTap | null {
  const change = CricketBowlerChange.safeParse(payload);
  if (!change.success) return null;
  return { kind: 'bowlerChange', bowler: change.data.bowler, reason: change.data.reason ?? null };
}

const sideOfEntrant = (seats: Seats, entrantId: string): PadSide | null => {
  if (entrantId === seats.first.entrantId) return 'first';
  return entrantId === seats.second.entrantId ? 'second' : null;
};

/** The tap Undo takes back, as the last-tap line names it, or null for the toss and the start (whose Undo shows no line). */
export function undoneTap(did: CricketTap): CricketUndoneTap | null {
  return did.kind === 'toss' || did.kind === 'start' ? null : did;
}

/**
 * The shared last-tap reader (`lastTapOf`) takes the set-based sports' facts beside each event; cricket's line reads only
 * what the event did, so every event carries these.
 */
export const CRICKET_FACTS: EventFacts = {
  game: 1,
  after: { first: 0, second: 0 },
  won: 'none',
  sanctionedPerson: null,
};
