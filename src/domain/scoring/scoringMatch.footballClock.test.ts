import { describe, expect, it } from 'vitest';
import { needsResync, reading, resyncTap } from '@/domain/scoring/footballClock';
import { NO_RESYNC, resyncStep, type ResyncMemory } from '@/domain/scoring/footballResync';
import { footballSport } from '@/domain/scoring/footballSport';
import type { FootballTap, FootballTypes } from '@/domain/scoring/footballTypes';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step, wakeAt } from '@/domain/scoring/scoringMatch';
import { copiesOf } from '@/domain/scoring/scoringMatchAsk';
import {
  foldQueue,
  foldRead,
  ownIds,
  resolved,
  type MatchEffect,
  type MatchEvent,
  type MatchHeld,
  type MatchState,
} from '@/domain/scoring/scoringMatchState';
import { isAsking } from '@/domain/scoring/sync';
import type { LedgerEvent } from '@/domain/scoring/wire';
import { savesOf, sendsOf } from '../../../test/scoringMatchFixtures';
import {
  at,
  BROWSER_LINK,
  clock,
  eventId,
  ledgerOf,
  MATCH,
  period,
  PHONE_LINK,
  start,
  voiding,
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

function readyOn(
  specs: readonly Spec[],
  queue: MatchQueue = QUEUE,
  deviceLinkId?: string,
): MatchState<FootballTypes> {
  const held: MatchHeld<FootballTypes> = {
    sport: footballSport,
    queue,
    ledger: ledgerOf(specs, { deviceLinkId }),
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
  /** The Start as this phone tapped it: what the resync is built from. */
  const OWN_START = { createdAtMs: T, running: true, period: 'H1', elapsed: 600 };

  function acceptedLate() {
    const { state, send } = tapAndSave(readyOn(PAUSED_AT_600), RESTART, 'k-start', T, T + 120_000);
    const answer = { kind: 'answered', sent: send!.sent, answer: accepted(4, 'ev-own-4') } as const;
    return { state: landed(state, answer, T + 120_000).state, send };
  }

  it('the Start goes as it was tapped, at 10:00, and is accepted 120 s later: a resync is due', () => {
    const { send } = acceptedLate();
    expect(send?.body.payload).toEqual({ running: true, at: at('H1', 600) });
    expect(needsResync(OWN_START, T + 120_000, false)).toBe(true);
  });

  it('the resync is a clock event at 12:00 made then, and the phone reads 12:10 ten seconds on: the wait counted once', () => {
    const { state } = acceptedLate();
    expect(readingAt(state, T + 120_000)).toBe(720);
    const tap = resyncTap(OWN_START, T + 120_000);
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

  // The probe of the controller's ruling 2 (Batch C, N1): once the copy is read back, the display's anchor is the
  // copy's, recorded at its arrival, so it reads short by the wait. The resync is built from the Start's own tap.
  it('the probe: read back 63 s after the tap the display reads 3, and the resync built from the Start reads 63', () => {
    const first = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T + 60_000);
    const lost = landed(
      first.state,
      { kind: 'answered', sent: first.send!.sent, answer: { kind: 'offline' } },
      T + 62_000,
    );
    // The retry goes at 63 s, and the read that comes back with it holds the first POST's copy at the seq it was sent at.
    expect(wakeAt(lost.state, T + 62_000)).toBe(T + 63_000);
    const retried = landed(lost.state, { kind: 'tick' }, T + 63_000);
    expect(retried.send?.body.idempotency_key).toBe('k-start');
    const copy: LedgerEvent = {
      id: 'ev-2',
      seq: 2,
      type: 'football.clock',
      payload: { at: { elapsed: 0, period: 'H1' }, running: true },
      recordedAt: iso(T + 60_000 + OFFSET),
      voids: null,
      deviceLinkId: PHONE_LINK,
    };
    const read = step(retried.state, { kind: 'fetched', events: [copy] }, T + 63_000).state;
    expect(copiesOf(read, read.sync.ledger).get('k-start')?.id).toBe('ev-2');
    expect(readingAt(read, T + 63_000)).toBe(3);
    const own = { createdAtMs: T, running: true, period: 'H1', elapsed: 0 };
    expect(resyncTap(own, T + 63_000)).toEqual({ kind: 'clock', running: true, elapsed: 63 });
  });
});

// The controller's ruling 2 (Batch C): the hook watches for this phone's running Start leaving the queue, accepted or
// read back, and taps one resync built from the Start's own tap when `needsResync` says so. `resyncStep` is that watch,
// pure: what it remembers of each Start, and the resync taps due on a state.
describe('the resync watch (ruling 2)', () => {
  /** The watch run over each state in turn, at its time: the memory after the last, and every resync it asked for. */
  function watch(
    states: readonly (readonly [MatchState<FootballTypes>, number])[],
    from: ResyncMemory = NO_RESYNC,
  ) {
    let memory = from;
    const taps: FootballTap[] = [];
    for (const [state, at] of states) {
      const stepped = resyncStep(memory, state, { deviceMs: at, offsetMs: null });
      memory = stepped.memory;
      taps.push(...stepped.taps);
    }
    return { memory, taps };
  }

  /** Kick-off tapped at T while the server is out, sent when it is back at `sentAt`; and the server's answer then. */
  function sentLate(sentAt: number) {
    const tapped = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, sentAt);
    const answer = {
      kind: 'answered',
      sent: tapped.send!.sent,
      answer: accepted(2, 'ev-own-2'),
    } as const;
    return { tapped, accepted: landed(tapped.state, answer, sentAt).state };
  }

  it('a Start accepted 120 s after its tap asks for one resync, at its own stamp plus 120 s', () => {
    const { tapped, accepted: done } = sentLate(T + 120_000);
    const { taps } = watch([
      [tapped.state, T + 120_000],
      [done, T + 120_000],
    ]);
    expect(taps).toEqual([{ kind: 'clock', running: true, elapsed: 120 }]);
  });

  it('a Start accepted 2 s after its tap asks for none', () => {
    const { tapped, accepted: done } = sentLate(T + 2_000);
    expect(
      watch([
        [tapped.state, T + 2_000],
        [done, T + 2_000],
      ]).taps,
    ).toEqual([]);
  });

  it('the same state watched twice asks once: each Start is decided once', () => {
    const { tapped, accepted: done } = sentLate(T + 120_000);
    const { taps } = watch([
      [tapped.state, T + 120_000],
      [done, T + 120_000],
      [done, T + 121_000],
    ]);
    expect(taps).toHaveLength(1);
  });

  /** Kick-off tapped at T, sent at 60 s with its answer lost, retried at 120 s and its copy read back then. */
  function readBack() {
    const first = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T + 60_000);
    const lost = landed(
      first.state,
      { kind: 'answered', sent: first.send!.sent, answer: { kind: 'offline' } },
      T + 119_000,
    );
    const retried = landed(lost.state, { kind: 'tick' }, T + 120_000);
    const copy: LedgerEvent = {
      id: 'ev-2',
      seq: 2,
      type: 'football.clock',
      payload: { at: { elapsed: 0, period: 'H1' }, running: true },
      recordedAt: iso(T + 60_000),
      voids: null,
      deviceLinkId: PHONE_LINK,
    };
    const read = step(retried.state, { kind: 'fetched', events: [copy] }, T + 120_000).state;
    const answer = {
      kind: 'answered',
      sent: retried.send!.sent,
      answer: accepted(2, 'ev-2'),
    } as const;
    return { first: first.state, read, done: landed(read, answer, T + 121_000).state };
  }

  it('a Start whose answer was lost and whose copy is read back 120 s on asks once, then not again when the retry is answered', () => {
    const { first, read, done } = readBack();
    expect(read.sync.queue.pending.map((tap) => tap.key)).toEqual(['k-start']);
    const { taps } = watch([
      [first, T],
      [read, T + 120_000],
      [read, T + 120_000],
      [done, T + 121_000],
    ]);
    expect(taps).toEqual([{ kind: 'clock', running: true, elapsed: 120 }]);
  });

  it('a period marker standing after the Start asks for none: it stopped every screen’s clock already', () => {
    const { tapped, accepted: done } = sentLate(T + 120_000);
    const ht = {
      id: 'ev-3',
      seq: 3,
      type: 'football.period',
      payload: period('HT', at('H1', 2700)).payload,
      recordedAt: iso(T + 120_000),
      voids: null,
      deviceLinkId: 'link-console',
    } satisfies LedgerEvent;
    const later = step(done, { kind: 'fetched', events: [ht] }, T + 120_000).state;
    expect(later.sync.ledger.map((event) => event.type)).toContain('football.period');
    expect(
      watch([
        [tapped.state, T],
        [later, T + 120_000],
      ]).taps,
    ).toEqual([]);
  });

  // A resync is a running clock tap too, made while the clock runs: no Start. Accepted late itself (the queue paced it
  // behind a retry), it asks for nothing more, or one late Start would chain resyncs.
  it('the resync itself is no Start: accepted 5 s after it was tapped, it asks for nothing more', () => {
    const { tapped, accepted: done } = sentLate(T + 120_000);
    const first = watch([
      [tapped.state, T + 120_000],
      [done, T + 120_000],
    ]);
    const resync = first.taps[0];
    if (resync === undefined) throw new Error('no resync');
    const queued = tapAndSave(done, resync, 'k-resync', T + 120_000, T + 125_000);
    const answer = {
      kind: 'answered',
      sent: queued.send!.sent,
      answer: accepted(3, 'ev-own-3'),
    } as const;
    const settled = landed(queued.state, answer, T + 125_000).state;
    expect(settled.sync.queue.pending).toEqual([]);
    const after = watch(
      [
        [queued.state, T + 120_000],
        [settled, T + 125_000],
      ],
      first.memory,
    );
    expect(after.taps).toEqual([]);
  });

  it('a Start after a Pause is one: the clock it starts was stopped', () => {
    const paused = readyOn([start(), clock(true, at('H1', 0)), clock(false, at('H1', 600))]);
    const restart: FootballTap = { kind: 'clock', running: true, elapsed: 600 };
    const tapped = tapAndSave(paused, restart, 'k-start', T, T + 120_000);
    const answer = {
      kind: 'answered',
      sent: tapped.send!.sent,
      answer: accepted(4, 'ev-own-4'),
    } as const;
    const done = landed(tapped.state, answer, T + 120_000).state;
    expect(
      watch([
        [tapped.state, T],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([{ kind: 'clock', running: true, elapsed: 720 }]);
  });

  it('a Pause accepted 120 s after its tap asks for none: it is no Start', () => {
    const running = readyOn([start(), clock(true, at('H1', 0))]);
    const pause: FootballTap = { kind: 'clock', running: false, elapsed: 600 };
    const tapped = tapAndSave(running, pause, 'k-pause', T, T + 120_000);
    const answer = {
      kind: 'answered',
      sent: tapped.send!.sent,
      answer: accepted(3, 'ev-own-3'),
    } as const;
    const done = landed(tapped.state, answer, T + 120_000).state;
    expect(done.sync.queue.pending).toEqual([]);
    expect(
      watch([
        [tapped.state, T],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([]);
  });

  it('a Start with this phone’s Pause queued behind it asks for none: the Pause moves every clock', () => {
    const sent = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T + 120_000);
    const pause: FootballTap = { kind: 'clock', running: false, elapsed: 10 };
    const paused = tapAndSave(sent.state, pause, 'k-pause', T + 10_000, T + 120_000);
    expect(paused.send).toBeUndefined();
    const answer = {
      kind: 'answered',
      sent: sent.send!.sent,
      answer: accepted(2, 'ev-own-2'),
    } as const;
    const done = landed(paused.state, answer, T + 120_000).state;
    expect(done.sync.queue.pending.map((tap) => tap.key)).toEqual(['k-pause']);
    expect(
      watch([
        [sent.state, T],
        [paused.state, T + 10_000],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([]);
  });

  it('a Start taken back while it was in flight asks for none when it is accepted', () => {
    const sent = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T + 120_000);
    const undone = landed(
      sent.state,
      { kind: 'undo', key: 'k-undo', at: iso(T + 60_000) },
      T + 60_000,
    );
    expect(undone.state.sync.queue.pending.map((tap) => tap.voidsKey)).toEqual([
      undefined,
      'k-start',
    ]);
    const answer = {
      kind: 'answered',
      sent: sent.send!.sent,
      answer: accepted(2, 'ev-own-2'),
    } as const;
    const done = landed(undone.state, answer, T + 120_000).state;
    expect(
      watch([
        [sent.state, T],
        [undone.state, T + 60_000],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([]);
  });

  const answered = (send: { readonly sent: unknown } | undefined, seq: number, id: string) =>
    ({
      kind: 'answered',
      sent: send!.sent,
      answer: accepted(seq, id),
    }) as MatchEvent<FootballTypes>;

  it('a Correct of a stopped clock accepted 120 s late asks for none: it starts nothing', () => {
    const stopped = readyOn([start(), clock(true, at('H1', 0)), clock(false, at('H1', 600))]);
    const correct: FootballTap = { kind: 'clock', running: false, elapsed: 660 };
    const tapped = tapAndSave(stopped, correct, 'k-correct', T, T + 120_000);
    const done = landed(tapped.state, answered(tapped.send, 4, 'ev-own-4'), T + 120_000).state;
    expect(done.sync.queue.pending).toEqual([]);
    expect(
      watch([
        [tapped.state, T],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([]);
  });

  it('a Start after the console’s Start was taken back starts the clock: accepted late, it asks for a resync', () => {
    const undone = readyOn([start(), clock(true, at('H1', 0)), voiding(eventId(2))]);
    const tapped = tapAndSave(undone, KICK_START, 'k-start', T, T + 120_000);
    const done = landed(tapped.state, answered(tapped.send, 4, 'ev-own-4'), T + 120_000).state;
    expect(
      watch([
        [tapped.state, T],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([{ kind: 'clock', running: true, elapsed: 120 }]);
  });

  // The watch sees the states React renders, which may skip some: here only the one the second Start was tapped in
  // (the first Start's void still queued before it) and the one it left the queue in.
  it('a Start taken back in flight, then a Start again: the second, accepted 120 s after its tap, asks for a resync', () => {
    const sent = tapAndSave(readyOn([start()]), KICK_START, 'k-start', T, T);
    const undone = landed(
      sent.state,
      { kind: 'undo', key: 'k-undo', at: iso(T + 1_000) },
      T + 1_000,
    );
    const again = tapAndSave(undone.state, KICK_START, 'k-again', T + 2_000, T + 2_000);
    expect(again.state.sync.queue.pending.map((tap) => tap.key)).toEqual([
      'k-start',
      'k-undo',
      'k-again',
    ]);
    // The first Start is accepted, then its void, then the second Start.
    const first = landed(again.state, answered(sent.send, 2, 'ev-own-2'), T + 120_000);
    const voided = landed(first.state, answered(first.send, 3, 'ev-own-3'), T + 120_000);
    const second = landed(voided.state, answered(voided.send, 4, 'ev-own-4'), T + 122_000);
    expect(second.state.sync.queue.pending).toEqual([]);
    expect(
      watch([
        [again.state, T + 2_000],
        [second.state, T + 122_000],
      ]).taps,
    ).toEqual([{ kind: 'clock', running: true, elapsed: 120 }]);
  });

  it('a Start taken back before it was sent asks for none, though this phone’s Pause stands in the ledger', () => {
    // Written from this phone: its link, and the Pause's id among its own.
    const own: MatchQueue = { ...QUEUE, ownEventIds: [eventId(3)] };
    const specs = [start(), clock(true, at('H1', 0)), clock(false, at('H1', 600))];
    const paused = readyOn(specs, own, PHONE_LINK);
    expect(ownIds(paused)).toEqual([eventId(3)]);
    const restart: FootballTap = { kind: 'clock', running: true, elapsed: 600 };
    const tapped = step(paused, { kind: 'tap', tap: restart, key: 'k-start', at: iso(T) }, T);
    const undone = step(
      tapped.state,
      { kind: 'undo', key: 'k-undo', at: iso(T + 1_000) },
      T + 1_000,
    );
    expect(undone.state.sync.queue.pending).toEqual([]);
    expect(
      watch([
        [tapped.state, T],
        [undone.state, T + 125_000],
      ]).taps,
    ).toEqual([]);
  });

  it('a Start taken back before it was sent, then a Correct of the stopped clock accepted 120 s on: none', () => {
    const paused = readyOn([start(), clock(true, at('H1', 0)), clock(false, at('H1', 600))]);
    const restart: FootballTap = { kind: 'clock', running: true, elapsed: 600 };
    const tapped = step(paused, { kind: 'tap', tap: restart, key: 'k-start', at: iso(T) }, T);
    const undone = landed(
      tapped.state,
      { kind: 'undo', key: 'k-undo', at: iso(T + 1_000) },
      T + 1_000,
    );
    expect(undone.state.sync.queue.pending).toEqual([]);
    // The Start's own save lands late: nothing of it is left to send.
    const settled = savesOf(tapped.effects).reduce(
      (state, save) => step(state, { kind: 'saved', n: save.n }, T + 1_000).state,
      undone.state,
    );
    const correct: FootballTap = { kind: 'clock', running: false, elapsed: 660 };
    const sent = tapAndSave(settled, correct, 'k-correct', T + 2_000, T + 120_000);
    expect(sent.send).toBeDefined();
    const done = landed(sent.state, answered(sent.send, 4, 'ev-own-4'), T + 120_000).state;
    expect(done.sync.queue.pending).toEqual([]);
    expect(
      watch([
        [tapped.state, T],
        [done, T + 120_000],
      ]).taps,
    ).toEqual([]);
  });

  it('a Start that leaves the queue untaken (taken back before it was sent) asks for none', () => {
    // Its save has not landed, so nothing was sent: Undo takes it out of the queue.
    const tapped = step(
      readyOn([start()]),
      { kind: 'tap', tap: KICK_START, key: 'k-start', at: iso(T) },
      T,
    );
    const undone = step(
      tapped.state,
      { kind: 'undo', key: 'k-undo', at: iso(T + 1_000) },
      T + 1_000,
    );
    expect(undone.state.sync.queue.pending).toEqual([]);
    expect(
      watch([
        [tapped.state, T],
        [undone.state, T + 125_000],
      ]).taps,
    ).toEqual([]);
  });
});

// The controller's ruling, final review (2026-11-08), from the reviewer's probe: a queued clock tap of this phone's that
// another screen's later clock event or period marker overtook in its period is withdrawn at its send: never sent, out
// of the queue, said in the record, and no resync. One that was raised but not overtaken reads from its own stamp, and
// its resync from its first sighting. Every number below is written out: T is the phone's tap, the server runs OFFSET
// ahead, and the browser is the other screen.
// Run once for a second phone's link and once for the organiser's console, which the web writes with `device_link_id`
// null (web append-event.ts:661): neither is this phone, so both overtake (N1 of the final re-review).
describe.each([
  ['a second phone', BROWSER_LINK],
  ['the organiser’s console (no device link)', null],
])('a clock tap %s overtook is withdrawn (final review)', (_who, otherLink) => {
  /** An event the browser recorded, `afterTapMs` after the phone's tap by the server's clock. */
  const browser = (seq: number, spec: Spec, afterTapMs: number): LedgerEvent => ({
    id: `ev-${seq}`,
    seq,
    type: spec.type,
    payload: spec.payload,
    recordedAt: iso(T + OFFSET + afterTapMs),
    voids: null,
    deviceLinkId: otherLink,
  });

  /** `event` stepped at `atMs`, every save it asked for landed then: the state, and every effect on the way. */
  function run(state: MatchState<FootballTypes>, event: MatchEvent<FootballTypes>, atMs: number) {
    const made = step(state, event, atMs);
    let next = made.state;
    const effects: MatchEffect[] = [...made.effects];
    const owed = savesOf(made.effects);
    for (let save = owed.shift(); save !== undefined; save = owed.shift()) {
      const saved = step(next, { kind: 'saved', n: save.n }, atMs);
      next = saved.state;
      effects.push(...saved.effects);
      owed.push(...savesOf(saved.effects));
    }
    return { state: next, effects };
  }

  /** The phone, offline, taps `tap` at T over `specs`: its one send at T comes to nothing. */
  function offlineTap(specs: readonly Spec[], tap: FootballTap, key = 'k-clock') {
    const tapped = run(readyOn(specs), { kind: 'tap', tap, key, at: iso(T) }, T);
    const sent = sendsOf(tapped.effects)[0]!;
    const answer = { kind: 'answered', sent: sent.sent, answer: { kind: 'offline' } } as const;
    return run(tapped.state, answer, T + 1_000).state;
  }

  /** Back at `atMs`: the read brings `events`, the reconnect question (if asked) is answered Send, and the send is due. */
  function backWith(state: MatchState<FootballTypes>, events: LedgerEvent[], atMs: number) {
    const read = run(state, { kind: 'fetched', events }, atMs);
    const asked = isAsking(read.state.sync)
      ? run(read.state, { kind: 'answerAsk', answer: 'send' }, atMs)
      : read;
    const due = Math.max(wakeAt(asked.state, atMs) ?? atMs, atMs);
    const sent = run(asked.state, { kind: 'tick' }, due);
    const effects = [...read.effects, ...(asked === read ? [] : asked.effects), ...sent.effects];
    return { read: read.state, state: sent.state, effects };
  }

  const withdrawnOf = (effects: readonly MatchEffect[]) =>
    effects.flatMap((effect) => (effect.kind === 'withdrawn' ? [effect.line] : []));

  /** The watch over the states the match went through, as the hook runs it: the resyncs it asked for. */
  function resyncsOver(states: readonly (readonly [MatchState<FootballTypes>, number])[]) {
    let memory = NO_RESYNC;
    const taps: FootballTap[] = [];
    for (const [state, atMs] of states) {
      const stepped = resyncStep(memory, state, { deviceMs: atMs, offsetMs: null });
      memory = stepped.memory;
      taps.push(...stepped.taps);
    }
    return taps;
  }

  it('the probe: the console starts 1 s after the phone’s Start and scores at 10:00; back at 12:01, every screen reads 12:00', () => {
    const waiting = offlineTap([start()], KICK_START);
    const back = backWith(
      waiting,
      [
        browser(2, clock(true, at('H1', 0)), 1_000),
        browser(
          3,
          { type: 'football.goal', payload: { by: 'ent-home', at: at('H1', 600) } },
          601_000,
        ),
      ],
      T + 721_000,
    );
    // While it waits after the read, the phone already reads the console's clock, not its own Start.
    expect(readingAt(back.read, T + 721_000)).toBe(720);
    expect(sendsOf(back.effects)).toEqual([]);
    expect(withdrawnOf(back.effects)).toEqual([
      { event: 'scoring.football.clockTapWithdrawn', fields: { phase: 'H1' } },
    ]);
    expect(back.state.sync.queue.pending).toEqual([]);
    expect(readingAt(back.state, T + 721_000)).toBe(720);
    expect(anchorOf(back.state)?.base).toBe('server');
    expect(
      resyncsOver([
        [waiting, T + 1_000],
        [back.read, T + 721_000],
        [back.state, T + 721_000],
      ]),
    ).toEqual([]);
    const fold = foldRead(back.state);
    if (fold === null || fold.kind !== 'folded') throw new Error('did not fold');
    expect(fold.display.lastTap?.kind).toBe('goal');
    // History, oldest first: the start, the console's Start and its goal; no correction, and nothing of the phone's.
    const said = [...fold.history]
      .reverse()
      .flatMap((group) => [...group.rows].reverse())
      .map((row) => [typeof row.said === 'string' ? row.said : row.said.key, row.by]);
    expect(said).toEqual([
      ['scoring.football.last.start', 'otherScorer'],
      ['scoring.football.last.clockStart', 'otherScorer'],
      ['scoring.football.last.goal', 'otherScorer'],
    ]);
  });

  it('an H1 Start overtaken by the console’s Half-time is withdrawn, and the break stays Half-time', () => {
    const paused = [start(), clock(true, at('H1', 0)), clock(false, at('H1', 600))];
    const waiting = offlineTap(paused, { kind: 'clock', running: true, elapsed: 600 });
    const back = backWith(
      waiting,
      [browser(4, period('HT', at('H1', 2700)), 300_000)],
      T + 400_000,
    );
    expect(foldRead(back.read)?.kind === 'folded' && foldRead(back.read)).toMatchObject({
      display: { clock: { justEnded: 'H1', anchor: null } },
    });
    expect(sendsOf(back.effects)).toEqual([]);
    expect(withdrawnOf(back.effects)).toEqual([
      { event: 'scoring.football.clockTapWithdrawn', fields: { phase: 'H1' } },
    ]);
    expect(foldRead(back.state)).toMatchObject({
      display: { clock: { justEnded: 'H1', anchor: null } },
    });
  });

  // The taps below are made at T + 1.5 s, inside the retry's wait (the offline answer at T + 1 s put the next try at
  // T + 2 s), so the Start is not in flight when they are made.
  it('a goal queued behind the withdrawn Start goes once the queue without the Start is saved, not before', () => {
    const waiting = offlineTap([start()], KICK_START);
    const goalTap: FootballTap = {
      kind: 'goal',
      side: 'first',
      scorer: null,
      assist: null,
      penalty: false,
      stamp: at('H1', 1),
    };
    const behind = run(
      waiting,
      { kind: 'tap', tap: goalTap, key: 'k-goal', at: iso(T + 1_500) },
      T + 1_500,
    );
    expect(sendsOf(behind.effects)).toEqual([]);
    const console = [browser(2, clock(true, at('H1', 0)), 1_000)];
    const read = run(behind.state, { kind: 'fetched', events: console }, T + 60_000).state;
    // The console wrote while the taps waited: the reconnect question, answered Send. That step withdraws the Start and
    // sends nothing: it saves the queue without it first.
    expect(isAsking(read.sync)).toBe(true);
    const withdrew = step(read, { kind: 'answerAsk', answer: 'send' }, T + 60_000);
    expect(withdrawnOf(withdrew.effects)).toEqual([
      { event: 'scoring.football.clockTapWithdrawn', fields: { phase: 'H1' } },
    ]);
    expect(sendsOf(withdrew.effects)).toEqual([]);
    const saves = savesOf(withdrew.effects);
    expect(saves.map((save) => save.queue?.pending.map((tap) => tap.key))).toEqual([['k-goal']]);
    const landed = step(withdrew.state, { kind: 'saved', n: saves[0]!.n }, T + 60_000);
    expect(sendsOf(landed.effects).map((send) => send.body.idempotency_key)).toEqual(['k-goal']);
  });

  it('an Undo waiting on the withdrawn Start goes with it: nothing is sent', () => {
    const waiting = offlineTap([start()], KICK_START);
    const undone = run(waiting, { kind: 'undo', key: 'k-undo', at: iso(T + 1_500) }, T + 1_500);
    expect(undone.state.sync.queue.pending.map((tap) => [tap.key, tap.voidsKey])).toEqual([
      ['k-clock', undefined],
      ['k-undo', 'k-clock'],
    ]);
    const back = backWith(undone.state, [browser(2, clock(true, at('H1', 0)), 1_000)], T + 60_000);
    expect(withdrawnOf(back.effects)).toHaveLength(1);
    expect(sendsOf(back.effects)).toEqual([]);
    expect(back.state.sync.queue.pending).toEqual([]);
  });

  // A tap never sent yet is judged by the fold on every read (`revalidate`): an overtaken one is kept for its send to
  // withdraw, never dropped as no longer legal.
  it('a Pause never sent yet, overtaken by the console’s Pause, is kept until its send and then withdrawn', () => {
    const goalTap: FootballTap = {
      kind: 'goal',
      side: 'first',
      scorer: null,
      assist: null,
      penalty: false,
      stamp: at('H1', 1),
    };
    const waiting = offlineTap([start(), clock(true, at('H1', 0))], goalTap, 'k-goal');
    const pause: FootballTap = { kind: 'clock', running: false, elapsed: 1 };
    const behind = run(
      waiting,
      { kind: 'tap', tap: pause, key: 'k-pause', at: iso(T + 1_500) },
      T + 1_500,
    );
    expect(behind.state.sync.queue.pending.map((tap) => [tap.key, tap.attempts])).toEqual([
      ['k-goal', 1],
      ['k-pause', 0],
    ]);
    const back = backWith(
      behind.state,
      [browser(3, clock(false, at('H1', 590)), 590_000)],
      T + 600_000,
    );
    expect(back.state.sync.queue.pending.map((tap) => tap.key)).toEqual(['k-goal', 'k-pause']);
    const sent = sendsOf(back.effects);
    expect(sent.map((send) => send.body.idempotency_key)).toEqual(['k-goal']);
    const answer = {
      kind: 'answered',
      sent: sent[0]!.sent,
      answer: accepted(4, 'ev-own-4'),
    } as const;
    const goalIn = run(back.state, answer, T + 600_000);
    expect(withdrawnOf(goalIn.effects)).toEqual([
      { event: 'scoring.football.clockTapWithdrawn', fields: { phase: 'H1' } },
    ]);
    expect(sendsOf(goalIn.effects)).toEqual([]);
    expect(goalIn.state.sync.queue.pending).toEqual([]);
  });

  it('raised but not overtaken (a console goal at 10:00, no clock event): it reads from its own 0:00, and resyncs to 12:00', () => {
    const waiting = offlineTap([start()], KICK_START);
    const goalAt600 = { type: 'football.goal', payload: { by: 'ent-home', at: at('H1', 600) } };
    const back = backWith(waiting, [browser(2, goalAt600, 601_000)], T + 720_000);
    // Waiting after the read: 12:00 from its own 0:00 at T, not 22:00 from the 10:00 the send will raise it to.
    expect(readingAt(back.read, T + 720_000)).toBe(720);
    expect(sendsOf(back.effects).map((send) => send.body.payload)).toEqual([
      { running: true, at: at('H1', 600) },
    ]);
    const sent = sendsOf(back.effects)[0]!;
    const answer = { kind: 'answered', sent: sent.sent, answer: accepted(3, 'ev-own-3') } as const;
    const accepted3 = run(back.state, answer, T + 720_000).state;
    expect(
      resyncsOver([
        [waiting, T + 1_000],
        [back.read, T + 720_000],
        [back.state, T + 720_000],
        [accepted3, T + 720_000],
      ]),
    ).toEqual([{ kind: 'clock', running: true, elapsed: 720 }]);
  });
});

// Ruling 149 (F5 on build 1039): a tap is stamped on the server's clock once an offset is known, and its stand-in in the
// ledger and its queue entry say so, so the clock anchored on it is read on the server's clock, where a wall clock moved
// after the tap cannot reach it. With no offset known it is the phone's own, and read on the phone's own clock.
describe('the clock a tap was stamped on (ruling 149)', () => {
  /** The phone's steady clock after a jump of +4:05 the return followed, and the offset the next answer formed. */
  const JUMP = 245_000;

  /** Kick-off tapped at T on the clock `stampedOn` names, sent and accepted at once. */
  function kickOff(stampedOn?: 'server') {
    const tapped = landed(
      readyOn([start()]),
      {
        kind: 'tap',
        tap: KICK_START,
        key: 'k-start',
        at: iso(T),
        ...(stampedOn === undefined ? {} : { stampedOn }),
      },
      T,
    );
    const answer = {
      kind: 'answered',
      sent: tapped.send!.sent,
      answer: accepted(2, 'ev-own-2'),
    } as const;
    return { queued: tapped.state, done: landed(tapped.state, answer, T).state };
  }

  it('a server-stamped Start, queued and accepted: its anchor is the server’s, and a jump the offset follows moves nothing', () => {
    const { queued, done } = kickOff('server');
    expect(queued.sync.queue.pending[0]?.stampedOn).toBe('server');
    expect(anchorOf(queued)?.base).toBe('server');
    expect(done.sync.ledger.at(-1)).toMatchObject({ id: 'ev-own-2', stampedOn: 'server' });
    expect(anchorOf(done)?.base).toBe('server');
    const fold = foldRead(done);
    if (fold === null || fold.kind !== 'folded') throw new Error('did not fold');
    expect(
      reading(fold.display.clock.anchor, { deviceMs: T + JUMP + 40_000, offsetMs: -JUMP }),
    ).toBe(40);
  });

  it('a Start with no mark, queued and accepted: its anchor is the phone’s own clock, and the offset cancels', () => {
    const { queued, done } = kickOff();
    expect(queued.sync.queue.pending[0]).not.toHaveProperty('stampedOn');
    expect(anchorOf(queued)?.base).toBe('device');
    expect(done.sync.ledger.at(-1)).not.toHaveProperty('stampedOn');
    expect(anchorOf(done)?.base).toBe('device');
    expect(readingAt(done, T + 40_000)).toBe(40);
  });

  it('an Undo that waited for its tap’s answer keeps its own stamp’s clock when it is made a plain void', () => {
    const waiting = {
      key: 'k-undo',
      type: 'core.void',
      payload: { event_id: '' },
      rulesVersion: 1,
      createdAt: iso(T),
      stampedOn: 'server',
      attempts: 0,
      voidsKey: 'k-start',
    } as const;
    expect(resolved(waiting, 'ev-own-2')).toMatchObject({ createdAt: iso(T), stampedOn: 'server' });
    const { stampedOn: _, ...own } = waiting;
    expect(resolved(own, 'ev-own-2')).not.toHaveProperty('stampedOn');
  });

  /** Kick-off tapped at T on `stampedOn`'s clock, then sent and accepted 120 s later. */
  function lateKickOff(stampedOn?: 'server') {
    const tapped = landed(
      readyOn([start()]),
      {
        kind: 'tap',
        tap: KICK_START,
        key: 'k-start',
        at: iso(T),
        ...(stampedOn === undefined ? {} : { stampedOn }),
      },
      T,
      T + 120_000,
    );
    const answer = {
      kind: 'answered',
      sent: tapped.send!.sent,
      answer: accepted(2, 'ev-own-2'),
    } as const;
    return { queued: tapped.state, done: landed(tapped.state, answer, T + 120_000).state };
  }

  function resyncsAt(
    states: readonly MatchState<FootballTypes>[],
    now: { deviceMs: number; offsetMs: number | null },
  ) {
    let memory = NO_RESYNC;
    const taps: FootballTap[] = [];
    for (const state of states) {
      const stepped = resyncStep(memory, state, now);
      memory = stepped.memory;
      taps.push(...stepped.taps);
    }
    return taps;
  }

  it('a server-stamped Start accepted late: its wait is read on the server’s clock, across a jump the offset follows', () => {
    const { queued, done } = lateKickOff('server');
    expect(resyncsAt([queued, done], { deviceMs: T + JUMP + 120_000, offsetMs: -JUMP })).toEqual([
      { kind: 'clock', running: true, elapsed: 120 },
    ]);
  });

  it('a Start with no mark accepted late: its wait is read on the phone’s own clock, whatever the offset formed since', () => {
    const { queued, done } = lateKickOff();
    expect(resyncsAt([queued, done], { deviceMs: T + 120_000, offsetMs: -OFFSET })).toEqual([
      { kind: 'clock', running: true, elapsed: 120 },
    ]);
  });
});
