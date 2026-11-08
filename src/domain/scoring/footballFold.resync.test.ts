import { describe, expect, it } from 'vitest';
import { foldFootball } from '@/domain/scoring/footballFold';
import type { FootballTypes } from '@/domain/scoring/footballTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFold } from '@/domain/scoring/scoringSport';
import type { LedgerEvent } from '@/domain/scoring/wire';
import {
  at,
  BROWSER_LINK,
  clock,
  goal,
  MATCH,
  queuedOf,
  start,
  voiding,
  type Spec,
} from '../../../test/footballLedger';

/**
 * A resync is not a scorer action (the controller's ruling 9, Batch C): the running clock event this phone taps after a
 * Start accepted late re-anchors every screen, and the scorer never pressed it. History and the last-tap line pass it,
 * and Undo passes it too: Undo of the Start it follows takes both back, the resync first. Every expected value is written
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

describe('a resync is not a scorer action (ruling 9)', () => {
  it('History after a late Start shows one Start line: the resync waiting to be sent is not one', () => {
    const fold = folded(
      [STARTED, OWN_START],
      [queuedOf('k-resync', RESYNC, iso(T + 120_000))],
      ['ev-2'],
    );
    expect(rowsOf(fold)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: 'scoring.football.last.clockStart', undone: false },
    ]);
    expect(fold.display.lastTap).toEqual({ kind: 'clock', running: true, at: at('H1', 0) });
  });

  it('and once the resync is accepted too: still one Start line, and the clock reads on from the resync', () => {
    const accepted = event(3, RESYNC, T + 120_000, null);
    const fold = folded([STARTED, OWN_START, accepted], [], ['ev-2', 'ev-3']);
    expect(
      rowsOf(fold).filter((row) => row.key === 'scoring.football.last.clockStart'),
    ).toHaveLength(1);
    expect(fold.display.lastTap).toEqual({ kind: 'clock', running: true, at: at('H1', 0) });
    expect(fold.display.clock.anchor).toEqual({
      period: 'H1',
      elapsed: 120,
      running: true,
      atMs: T + 120_000,
      base: 'device',
    });
  });

  it('Undo of the Start it follows takes both back, the resync first', () => {
    const accepted = event(3, RESYNC, T + 120_000, null);
    expect(folded([STARTED, OWN_START, accepted], [], ['ev-2', 'ev-3']).display.undoPlan).toBe(
      'withStart',
    );
  });

  it('after that Undo, History shows the Start undone and no resync line; the last-tap line says the Start was undone', () => {
    const accepted = event(3, RESYNC, T + 120_000, null);
    const undone = [
      queuedOf('k-undo-1', voiding('ev-3'), iso(T + 130_000)),
      queuedOf('k-undo-2', voiding('ev-2'), iso(T + 130_000)),
    ];
    const fold = folded([STARTED, OWN_START, accepted], undone, ['ev-2', 'ev-3']);
    expect(rowsOf(fold)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: 'scoring.football.last.clockStart', undone: true },
    ]);
    expect(fold.display.lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'clock', running: true, at: at('H1', 0) },
    });
    expect(fold.display.clock.anchor).toBeNull();
  });

  it('a goal recorded while the Start waited sits under the resync: Undo passes the resync to the goal', () => {
    const goalAt = event(3, goal({ by: 'H', scorer: 'H-p9', at: at('H1', 30) }), T + 120_000, null);
    const accepted = event(4, RESYNC, T + 120_000, null);
    const fold = folded([STARTED, OWN_START, goalAt, accepted], [], ['ev-2', 'ev-3', 'ev-4']);
    expect(fold.display.undoPlan).toBe('pastResync');
    expect(fold.display.lastTap).toMatchObject({ kind: 'goal', side: 'first' });
  });

  it('a Correct of +1 min while running is the scorer’s: History shows it and Undo takes it alone', () => {
    const corrected = event(3, clock(true, at('H1', 90)), T + 30_000, null);
    const fold = folded([STARTED, OWN_START, corrected], [], ['ev-2', 'ev-3']);
    expect(
      rowsOf(fold).filter((row) => row.key === 'scoring.football.last.clockStart'),
    ).toHaveLength(2);
    expect(fold.display.undoPlan).toBe('plain');
  });

  it('with no resync on top Undo is plain, and with nothing of this phone’s too', () => {
    expect(folded([STARTED, OWN_START], [], ['ev-2']).display.undoPlan).toBe('plain');
    expect(folded([STARTED], [], []).display.undoPlan).toBe('plain');
  });

  it('a resync another device stands on is still passed over by History, but Undo is the generic one’s to refuse', () => {
    const accepted = event(3, RESYNC, T + 120_000, null);
    const console = event(4, goal({ by: 'A', at: at('H1', 150) }), T + 150_000);
    const fold = folded([STARTED, OWN_START, accepted, console], [], ['ev-2', 'ev-3']);
    expect(
      rowsOf(fold).filter((row) => row.key === 'scoring.football.last.clockStart'),
    ).toHaveLength(1);
    expect(fold.display.undoable).toBe(false);
  });
});
