import { cricketPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import { cricketEventFor } from '@/domain/scoring/cricketEvents';
import {
  boundaryOf,
  extrasChoice,
  extrasSheet,
  isBoundary,
  runBall,
} from '@/domain/scoring/cricketExtras';
import { foldCricket } from '@/domain/scoring/cricketFold';
import type { CricketBallTap } from '@/domain/scoring/cricketTypes';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { MATCH, OPENING, ball, ledgerOf, player, type Spec } from '../../../test/cricketLedger';

// The run keys and the extras sheets (S2-4 spec §4.2, rulings 73, 79, 80; plan Task 11). Every option is written out as
// the spec lists it; the runs a choice records are the engine's arithmetic (a wide's own run counted in `extras.runs`),
// checked by folding the ball, never by calling the code under test for the expectation.

/** One dot ball bowled: the crease and the bowler are the fold's, so the next ball's event can be built. */
const DOT_ONE: readonly Spec[] = [
  ...OPENING,
  ball({
    over: 0,
    ballInOver: 1,
    striker: player('H', 1),
    nonStriker: player('H', 2),
    bowler: player('A', 11),
  }),
];

function displayOf(specs: readonly Spec[] = DOT_ONE) {
  const folded = foldCricket({
    bootstrap: MATCH,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks: NO_PICKS,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

/** The innings' runs once `tap` is folded after a dot ball: the engine's sum, read off the fold. */
function runsAfter(tap: CricketBallTap): number {
  const event = cricketEventFor(
    { kind: 'ball', ball: tap },
    { bootstrap: MATCH, display: displayOf() },
  );
  if (event === null) throw new Error('no event');
  return displayOf([...DOT_ONE, { type: event.type, payload: event.payload }]).innings?.runs ?? -1;
}

const ids = (kind: Parameters<typeof extrasSheet>[0]) =>
  extrasSheet(kind).options.map((option) => option.id);

describe('the run keys', () => {
  it('a 4 records a boundary 4, a 6 a boundary 6, and 0 to 3 no boundary', () => {
    expect([0, 1, 2, 3, 4, 6].map((runs) => [runBall(runs).bat, runBall(runs).boundary])).toEqual([
      [0, null],
      [1, null],
      [2, null],
      [3, null],
      [4, 4],
      [6, 6],
    ]);
    expect(runBall(4)).toEqual({ bat: 4, extra: null, boundary: 4, wicket: null });
  });

  // Batch 4 review M2: the set is the engine's, not a copy. The tap's `boundary` type is 4 | 6, so a third value in the
  // engine's set would need the type widened: this goes red first.
  it('the boundaries are the engine’s 4 and 6, and any other runs are none', () => {
    expect(cricketPadRules.boundaryValues).toEqual([4, 6]);
    expect([4, 6].map(isBoundary)).toEqual([true, true]);
    expect([0, 1, 2, 3, 5, 7].map(isBoundary)).toEqual(Array.from({ length: 6 }, () => false));
    expect([5, 7].map((runs) => boundaryOf(runs))).toEqual([null, null]);
  });
});

describe('extrasSheet', () => {
  it('the wide sheet asks the runs run, 0 to 4, then + Out', () => {
    expect(ids('wide')).toEqual(['ran.0', 'ran.1', 'ran.2', 'ran.3', 'ran.4', 'out']);
  });

  it('the no-ball sheet offers bat 0, 1, 2, 3, 4, 6 and runs run 1–4, ten options, then + Out', () => {
    const options = extrasSheet('noball').options;
    const runs = options.filter((option) => option.id !== 'out');
    expect(runs.map((option) => [option.id, option.label, option.group])).toEqual([
      ['bat.0', '0', 'scoring.cricket.extras.bat'],
      ['bat.1', '1', 'scoring.cricket.extras.bat'],
      ['bat.2', '2', 'scoring.cricket.extras.bat'],
      ['bat.3', '3', 'scoring.cricket.extras.bat'],
      ['bat.4', '4', 'scoring.cricket.extras.bat'],
      ['bat.6', '6', 'scoring.cricket.extras.bat'],
      ['ran.1', '1', 'scoring.cricket.extras.byesRun'],
      ['ran.2', '2', 'scoring.cricket.extras.byesRun'],
      ['ran.3', '3', 'scoring.cricket.extras.byesRun'],
      ['ran.4', '4', 'scoring.cricket.extras.byesRun'],
    ]);
    expect(runs).toHaveLength(10);
    expect(options.at(-1)).toMatchObject({
      id: 'out',
      label: { key: 'scoring.cricket.extras.out' },
      tone: 'standard',
    });
  });

  // Owner, 2026-11-10: the no-ball's run keys are byes; the wide's keep "Runs run", a bye's and a leg-bye's "Runs".
  it('names each sheet’s run group: no-ball byes run, wide runs run, bye and leg-bye runs', () => {
    const group = (kind: 'wide' | 'noball' | 'bye' | 'legbye') =>
      extrasSheet(kind).options.find((option) => option.id === 'ran.1')?.group;
    expect([group('noball'), group('wide'), group('bye'), group('legbye')]).toEqual([
      'scoring.cricket.extras.byesRun',
      'scoring.cricket.extras.ran',
      'scoring.cricket.extras.runs',
      'scoring.cricket.extras.runs',
    ]);
  });

  it('a bye and a leg-bye ask 1 to 4, then + Out', () => {
    expect(ids('bye')).toEqual(['ran.1', 'ran.2', 'ran.3', 'ran.4', 'out']);
    expect(ids('legbye')).toEqual(['ran.1', 'ran.2', 'ran.3', 'ran.4', 'out']);
  });

  it('each sheet is titled by its key and names its step', () => {
    expect(
      (['wide', 'noball', 'bye', 'legbye'] as const).map((kind) => {
        const step = extrasSheet(kind);
        return [step.name, step.title.key];
      }),
    ).toEqual([
      ['extras.wide', 'scoring.cricket.key.wide'],
      ['extras.noball', 'scoring.cricket.key.noBall'],
      ['extras.bye', 'scoring.cricket.key.bye'],
      ['extras.legbye', 'scoring.cricket.key.legBye'],
    ]);
  });
});

describe('extrasChoice', () => {
  it('Wide then 2 records runs 3: the wide’s own run and the two run, one wide extra', () => {
    const ball = extrasChoice('wide', 'ran.2');
    expect(ball).toEqual({
      bat: 0,
      extra: { kind: 'wide', runs: 3 },
      boundary: null,
      wicket: null,
    });
    expect(runsAfter(ball!)).toBe(3);
  });

  it('Wide then 0 records the wide’s run alone', () => {
    expect(extrasChoice('wide', 'ran.0')).toEqual({
      bat: 0,
      extra: { kind: 'wide', runs: 1 },
      boundary: null,
      wicket: null,
    });
  });

  it('No-ball then 4 off the bat records bat 4, a no-ball and boundary 4', () => {
    const ball = extrasChoice('noball', 'bat.4');
    expect(ball).toEqual({ bat: 4, extra: { kind: 'noball', runs: 1 }, boundary: 4, wicket: null });
    expect(runsAfter(ball!)).toBe(5);
  });

  it('No-ball then 2 off the bat carries no boundary; no-ball then 3 run is one no-ball extra of 4', () => {
    expect(extrasChoice('noball', 'bat.2')).toEqual({
      bat: 2,
      extra: { kind: 'noball', runs: 1 },
      boundary: null,
      wicket: null,
    });
    const ran = extrasChoice('noball', 'ran.3');
    expect(ran).toEqual({
      bat: 0,
      extra: { kind: 'noball', runs: 4 },
      boundary: null,
      wicket: null,
    });
    expect(runsAfter(ran!)).toBe(4);
  });

  it('a bye of 2 and a leg-bye of 4 are their runs', () => {
    expect(extrasChoice('bye', 'ran.2')).toEqual({
      bat: 0,
      extra: { kind: 'bye', runs: 2 },
      boundary: null,
      wicket: null,
    });
    expect(runsAfter(extrasChoice('legbye', 'ran.4')!)).toBe(4);
  });

  it('+ Out and an id no sheet offers are no ball', () => {
    expect(extrasChoice('wide', 'out')).toBeNull();
    expect(extrasChoice('bye', 'ran.0')).toBeNull();
    expect(extrasChoice('noball', 'ran.0')).toBeNull();
    expect(extrasChoice('noball', 'bat.5')).toBeNull();
    expect(extrasChoice('wide', 'ran.5')).toBeNull();
  });
});
