import { describe, expect, it } from 'vitest';
import { foldFootball } from '@/domain/scoring/footballFold';
import type { FootballTypes } from '@/domain/scoring/footballTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFold } from '@/domain/scoring/scoringSport';
import type { LedgerEvent } from '@/domain/scoring/wire';
import {
  at,
  BROWSER_LINK,
  PHONE_LINK,
  clock,
  goal,
  MATCH,
  period,
  queuedOf,
  start,
  voiding,
  type Spec,
} from '../../../test/footballLedger';

/**
 * A clock correction (the controller's fix-round ruling I1, 2026-11-08, superseding ruling 9): a running clock event
 * after a running one in the same period, with no Pause between, whoever sent it. History and the last-tap line say it
 * in the Correct's words, and Undo takes it back alone, as any tap. It reads the same over this phone's stand-ins and over
 * the server's copies, recorded on arrival, so a cold start says what the session said. Every expected value is written
 * out from the ruling, never computed by the fold.
 */

/** When this phone tapped Start, by its own clock: the stand-in for its accepted Start keeps that time. */
const T = Date.parse('2026-11-07T14:30:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** An event as the ledger holds it: by the browser unless `link` says (null: this phone's stand-in). */
function event(
  seq: number,
  spec: Spec,
  recordedAtMs: number,
  link: string | null = BROWSER_LINK,
): LedgerEvent {
  return {
    id: `ev-${seq}`,
    seq,
    type: spec.type,
    payload: spec.payload,
    recordedAt: iso(recordedAtMs),
    voids: spec.voids ?? null,
    deviceLinkId: link,
  };
}

/** The match started on the console; this phone's Start at 0:00, tapped at T and accepted 120 s later (its stand-in). */
const STARTED = event(1, start(), T - 60_000);
const OWN_START = event(2, clock(true, at('H1', 0)), T, null);
/** The resync tapped when the Start was accepted, 120 s after it was tapped: running at 2:00. */
const RESYNC = clock(true, at('H1', 120));

function folded(
  ledger: readonly LedgerEvent[],
  queued: readonly QueuedEvent[],
  ownEventIds: readonly string[],
) {
  const fold: SportFold<FootballTypes> = foldFootball({
    bootstrap: MATCH,
    ledger,
    queued,
    ownEventIds,
    toss: null,
  });
  if (fold.kind !== 'folded') throw new Error(`unfoldable: ${fold.reason}`);
  return fold;
}

/** History's rows, oldest first, as the keys they are said in, and whether each was undone. */
const rowsOf = (fold: ReturnType<typeof folded>) =>
  [...fold.history]
    .reverse()
    .flatMap((group) => [...group.rows].reverse())
    .map((row) => ({ key: row.said.key, undone: row.undone }));

/** The server's copies of the late Start and its resync: both recorded on arrival, 120 s after the tap, by this phone. */
const START_COPY = event(2, clock(true, at('H1', 0)), T + 120_000, PHONE_LINK);
const RESYNC_COPY = event(3, RESYNC, T + 120_500, PHONE_LINK);

const CORRECTED = 'scoring.football.last.clockCorrect';

describe('a resync is a clock correction (ruling I1)', () => {
  it('as the server’s copies: History shows the Start, then a correction, and the last-tap line is the correction', () => {
    const fold = folded([STARTED, START_COPY, RESYNC_COPY], [], ['ev-2', 'ev-3']);
    expect(rowsOf(fold)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: 'scoring.football.last.clockStart', undone: false },
      { key: CORRECTED, undone: false },
    ]);
    expect(fold.display.lastTap).toEqual({ kind: 'clockCorrect', at: at('H1', 120) });
    expect(fold.display.clock.anchor).toEqual({
      period: 'H1',
      elapsed: 120,
      running: true,
      atMs: T + 120_500,
      base: 'server',
    });
  });

  it('the same on another phone, which owns neither', () => {
    const fold = folded([STARTED, START_COPY, RESYNC_COPY], [], []);
    expect(rowsOf(fold).map((row) => row.key)).toEqual([
      'scoring.football.last.start',
      'scoring.football.last.clockStart',
      CORRECTED,
    ]);
  });

  it('as this phone’s stand-ins, and while the resync still waits to be sent: the same lines', () => {
    const accepted = event(3, RESYNC, T + 120_000, null);
    const standIns = folded([STARTED, OWN_START, accepted], [], ['ev-2', 'ev-3']);
    const waiting = folded(
      [STARTED, OWN_START],
      [queuedOf('k-resync', RESYNC, iso(T + 120_000))],
      ['ev-2'],
    );
    for (const fold of [standIns, waiting]) {
      expect(rowsOf(fold).map((row) => row.key)).toEqual([
        'scoring.football.last.start',
        'scoring.football.last.clockStart',
        CORRECTED,
      ]);
      expect(fold.display.lastTap).toEqual({ kind: 'clockCorrect', at: at('H1', 120) });
    }
  });

  it('Undo after a late Start voids only the correction: the Start stands, the correction is struck', () => {
    const undo = queuedOf('k-undo', voiding('ev-3'), iso(T + 130_000));
    const fold = folded([STARTED, START_COPY, RESYNC_COPY], [undo], ['ev-2', 'ev-3']);
    expect(rowsOf(fold)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: 'scoring.football.last.clockStart', undone: false },
      { key: CORRECTED, undone: true },
    ]);
    expect(fold.display.lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'clockCorrect', at: at('H1', 120) },
    });
    expect(fold.display.clock.anchor).toMatchObject({ period: 'H1', elapsed: 0, running: true });
    expect(fold.display.undoable).toBe(true);
  });

  it('a Correct the console sends while the clock runs is a correction too; a Pause and a Start after it are not', () => {
    const corrected = event(3, clock(true, at('H1', 90)), T + 30_000);
    const paused = event(4, clock(false, at('H1', 100)), T + 40_000);
    const restarted = event(5, clock(true, at('H1', 100)), T + 50_000);
    const fold = folded([STARTED, OWN_START, corrected, paused, restarted], [], ['ev-2']);
    expect(rowsOf(fold).map((row) => row.key)).toEqual([
      'scoring.football.last.start',
      'scoring.football.last.clockStart',
      CORRECTED,
      'scoring.football.last.clockPause',
      'scoring.football.last.clockStart',
    ]);
  });

  it('a running clock event after Half-time is the second half’s Start, not a correction', () => {
    const paused = event(3, clock(false, at('H1', 2700)), T + 60_000);
    const ht = event(4, period('HT', at('H1', 2700)), T + 61_000);
    const second = event(5, clock(true, at('H2', 0)), T + 600_000);
    const fold = folded([STARTED, OWN_START, paused, ht, second], [], []);
    expect(rowsOf(fold).at(-1)?.key).toBe('scoring.football.last.clockStart');
  });

  it('a goal on another device after the correction: the correction is not this phone’s to undo', () => {
    const console = event(4, goal({ by: 'A', at: at('H1', 150) }), T + 150_000);
    const fold = folded([STARTED, START_COPY, RESYNC_COPY, console], [], ['ev-2', 'ev-3']);
    expect(rowsOf(fold).map((row) => row.key)).toContain(CORRECTED);
    expect(fold.display.undoable).toBe(false);
  });
});
