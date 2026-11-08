import { describe, expect, it } from 'vitest';
import { needsResync, reading, resyncTap } from '@/domain/scoring/footballClock';
import { footballSport } from '@/domain/scoring/footballSport';
import type { FootballTap, FootballTypes } from '@/domain/scoring/footballTypes';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step, wakeAt } from '@/domain/scoring/scoringMatch';
import { copiesOf } from '@/domain/scoring/scoringMatchAsk';
import {
  foldQueue,
  foldRead,
  type MatchEvent,
  type MatchHeld,
  type MatchState,
} from '@/domain/scoring/scoringMatchState';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { savesOf, sendsOf } from '../../../test/scoringMatchFixtures';
import {
  at,
  clock,
  ledgerOf,
  MATCH,
  PHONE_LINK,
  start,
  type Spec,
} from '../../../test/footballLedger';

// A Start that waited, through the match runtime (S2-5 design §7.2 at 8aafcca2; the controller's ruling of 2026-11-08,
// from the phone review's I1 and I2). Its payload is never changed after it is queued: the phone's own reading counts
// the wait once, the server's copy of a Start whose answer was lost is still known by its payload, and a Start accepted
// late is followed by a resync tap. Every expected value is written out, never computed by the code under test.

/** When the phone tapped Start, by its own clock. */
const T = Date.parse('2026-11-07T14:30:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
/** The server's clock runs 5 min ahead of the phone's: a reading on the phone's own anchor never sees it. */
const OFFSET = 300_000;

const QUEUE: MatchQueue = {
  fixtureId: MATCH.fixtureId,
  label: 'Home FC v Away FC',
  pending: [],
  ownEventIds: [],
  dead: null,
};

function readyOn(specs: readonly Spec[]): MatchState<FootballTypes> {
  const held: MatchHeld<FootballTypes> = {
    sport: footballSport,
    queue: QUEUE,
    ledger: ledgerOf(specs),
    bootstrap: MATCH,
    toss: null,
    judge: 'fold',
    foreground: true,
    rulesVersion: 1,
    decidedAt: null,
  };
  return step(openMatch(held, T).state, { kind: 'fetched', events: [] }, T).state;
}

/** The phone's reading of the match clock at `deviceMs`, as the screen reads it. */
function readingAt(state: MatchState<FootballTypes>, deviceMs: number): number {
  const fold = foldRead(state);
  if (fold === null || fold.kind !== 'folded') throw new Error('did not fold');
  return reading(fold.display.clock.anchor, { deviceMs, offsetMs: OFFSET });
}

function anchorOf(state: MatchState<FootballTypes>) {
  const fold = foldRead(state);
  if (fold === null || fold.kind !== 'folded') throw new Error('did not fold');
  return fold.display.clock.anchor;
}

/**
 * `event` stepped at `atMs`, and every save it asked for landed at `savedAtMs` (the pump sends nothing while a save is
 * owed): the state, and the send the step or its saves let go.
 */
function landed(
  state: MatchState<FootballTypes>,
  event: MatchEvent<FootballTypes>,
  atMs: number,
  savedAtMs: number = atMs,
) {
  const made = step(state, event, atMs);
  let next = made.state;
  const sends = sendsOf(made.effects);
  const owed = savesOf(made.effects);
  for (let save = owed.shift(); save !== undefined; save = owed.shift()) {
    const saved = step(next, { kind: 'saved', n: save.n }, savedAtMs);
    next = saved.state;
    sends.push(...sendsOf(saved.effects));
    owed.push(...savesOf(saved.effects));
  }
  return { state: next, send: sends[0] };
}

/** A tap made at `atMs`, its save landed at `savedAtMs`: the state and the send the save let go. */
const tapAndSave = (
  state: MatchState<FootballTypes>,
  tap: FootballTap,
  key: string,
  atMs: number,
  savedAtMs: number,
) => landed(state, { kind: 'tap', tap, key, at: iso(atMs) }, atMs, savedAtMs);

const accepted = (seq: number, eventId: string) =>
  ({ kind: 'accepted', seq, eventId, rulesVersion: 1 }) as const;

const KICK_START: FootballTap = { kind: 'clock', running: true, elapsed: 0 };

describe('a Start that waited is counted once on this phone (I1)', () => {
  it('tapped at T and first sent at T+60 s, it reads 90 at T+90 s while in flight and once accepted', () => {
    const { state, send } = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T + 60_000);
    expect(send?.body.payload).toEqual({ running: true, at: at('H1', 0) });
    expect(readingAt(state, T + 90_000)).toBe(90);
    const answered = landed(
      state,
      { kind: 'answered', sent: send!.sent, answer: accepted(2, 'ev-own-2') },
      T + 60_000,
    );
    expect(readingAt(answered.state, T + 90_000)).toBe(90);
  });
});

describe('a Start accepted late is followed by a resync tap (design §7.2)', () => {
  /** Kicked off on the console, paused at 10:00; the phone taps Start at 10:00 while the server is out. */
  const PAUSED_AT_600: readonly Spec[] = [
    start(),
    clock(true, at('H1', 0)),
    clock(false, at('H1', 600)),
  ];
  const RESTART: FootballTap = { kind: 'clock', running: true, elapsed: 600 };

  function acceptedLate() {
    const { state, send } = tapAndSave(readyOn(PAUSED_AT_600), RESTART, 'k-start', T, T + 120_000);
    const answer = { kind: 'answered', sent: send!.sent, answer: accepted(4, 'ev-own-4') } as const;
    return { state: landed(state, answer, T + 120_000).state, send };
  }

  it('the Start goes as it was tapped, at 10:00, and is accepted 120 s later: a resync is due', () => {
    const { send } = acceptedLate();
    expect(send?.body.payload).toEqual({ running: true, at: at('H1', 600) });
    expect(needsResync({ createdAtMs: T, running: true, period: 'H1' }, T + 120_000, false)).toBe(
      true,
    );
  });

  it('the resync is a clock event at 12:00 made then, and the phone reads 12:10 ten seconds on: the wait counted once', () => {
    const { state } = acceptedLate();
    const tap = resyncTap(anchorOf(state), { deviceMs: T + 120_000, offsetMs: OFFSET });
    expect(tap).toEqual({ kind: 'clock', running: true, elapsed: 720 });
    const resynced = tapAndSave(state, tap, 'k-resync', T + 120_000, T + 120_000);
    expect(resynced.send?.body.payload).toEqual({ running: true, at: at('H1', 720) });
    expect(readingAt(resynced.state, T + 130_000)).toBe(730);
  });
});

describe('the server’s copy of a Start whose answer was lost is still its copy (I2)', () => {
  it('the retry sends the same payload, and a read holding the copy finds it: the fold holds one Start', () => {
    const first = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T + 60_000);
    const lost = landed(
      first.state,
      { kind: 'answered', sent: first.send!.sent, answer: { kind: 'offline' } },
      T + 61_000,
    );
    expect(lost.send).toBeUndefined();
    const retryAt = wakeAt(lost.state, T + 61_000);
    if (retryAt === null) throw new Error('no retry planned');
    const retried = landed(lost.state, { kind: 'tick' }, retryAt);
    const again = retried.send;
    expect(again?.body.idempotency_key).toBe('k-start');
    expect(again?.body.payload).toEqual({ running: true, at: at('H1', 0) });
    // The first POST landed: the server holds it at seq 2, by this phone's link, its keys in Postgres's order.
    const copy: LedgerEvent = {
      id: 'ev-2',
      seq: 2,
      type: 'football.clock',
      payload: { at: { elapsed: 0, period: 'H1' }, running: true },
      recordedAt: iso(T + 60_000 + OFFSET),
      voids: null,
      deviceLinkId: PHONE_LINK,
    };
    const read = step(retried.state, { kind: 'fetched', events: [copy] }, retryAt + 1_000).state;
    expect(copiesOf(read, read.sync.ledger).get('k-start')?.id).toBe('ev-2');
    expect(foldQueue(read)).toEqual([]);
    expect(anchorOf(read)).toEqual({
      period: 'H1',
      elapsed: 0,
      running: true,
      atMs: T + 60_000 + OFFSET,
      base: 'server',
    });
  });
});
