import { describe, expect, it } from 'vitest';
import type { BootCache } from '@/domain/scoring/queue';
import { step } from '@/domain/scoring/scoringMatch';
import type { MatchState } from '@/domain/scoring/scoringMatchState';
import { SINGLES } from '../../../test/badmintonLedger';
import { AT, NOW, ready, savesOf } from '../../../test/scoringMatchFixtures';

// The queue saves, numbered (plan S2-1 Task 9 review, item 4): "not recorded" is true only once a save issued AFTER
// the failed one has landed, because a save issued before it may still be in the file's way.

const FIRST = { kind: 'rally', side: 'first' } as const;
const SECOND = { kind: 'rally', side: 'second' } as const;

describe('the saves a step asks for', () => {
  it('are numbered one after another from 1, a save of the tap and then the next tap’s', () => {
    const one = step(ready(), { kind: 'tap', tap: FIRST, key: 'k1', at: AT }, NOW);
    expect(savesOf(one.effects).map((save) => save.n)).toEqual([1]);
    const two = step(one.state, { kind: 'tap', tap: SECOND, key: 'k2', at: AT }, NOW);
    expect(savesOf(two.effects).map((save) => save.n)).toEqual([2]);
  });

  it('the re-save of a failed save is a save like any other: numbered after the failure, and again at each retry', () => {
    const one = step(ready(), { kind: 'tap', tap: FIRST, key: 'k1', at: AT }, NOW);
    const failed = step(one.state, { kind: 'saveFailed', key: 'k1' }, NOW);
    expect(savesOf(failed.effects).map((save) => [save.n, save.queue?.pending.length])).toEqual([
      [2, 0],
    ]);
    const again = step(failed.state, { kind: 'saveFailed', key: null }, NOW);
    expect(savesOf(again.effects)).toEqual([]);
    const due = step(again.state, { kind: 'tick' }, NOW + 5000);
    expect(savesOf(due.effects).map((save) => save.n)).toEqual([3]);
  });
});

describe('a refused save’s debt', () => {
  function twoTapsThenTheFirstFails() {
    const first = step(ready(), { kind: 'tap', tap: FIRST, key: 'k1', at: AT }, NOW);
    const second = step(first.state, { kind: 'tap', tap: SECOND, key: 'k2', at: AT }, NOW);
    return step(second.state, { kind: 'saveFailed', key: 'k1' }, NOW);
  }

  it('is not paid by a save issued before the failure: it lands, and the line still says it could not save', () => {
    const failed = twoTapsThenTheFirstFails();
    expect(
      savesOf(failed.effects).map((save) => [save.n, save.queue?.pending.map((t) => t.key)]),
    ).toEqual([[3, ['k2']]]);
    const early = step(failed.state, { kind: 'saved', n: 2 }, NOW);
    expect(early.state.saveOwed).not.toBeNull();
    expect(early.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.savePending' });
  });

  it('is paid by the save issued after it: only then is the tap "not recorded"', () => {
    const failed = twoTapsThenTheFirstFails();
    const early = step(failed.state, { kind: 'saved', n: 2 }, NOW);
    const paid = step(early.state, { kind: 'saved', n: 3 }, NOW);
    expect(paid.state.saveOwed).toBeNull();
    expect(paid.state.line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notSaved' });
  });

  it('is paid by a later save of the queue that is not its own re-save: any save after the failure', () => {
    const failed = twoTapsThenTheFirstFails();
    const third = step(failed.state, { kind: 'tap', tap: SECOND, key: 'k3', at: AT }, NOW);
    expect(savesOf(third.effects).map((save) => save.n)).toEqual([4]);
    const paid = step(third.state, { kind: 'saved', n: 4 }, NOW);
    expect(paid.state.saveOwed).toBeNull();
  });
});

// Pending picks (S2-4 plan Task 3, Review Focus 3) go with the boot cache, so a kill between an over's end and its first
// ball keeps them. A second `setPicks` equal to the picks held saves nothing.
describe('the boot cache and the pending picks', () => {
  it('setPicks saves the boot cache once', () => {
    const picks = { 'order.first': ['p-sharma'], 'bowler.i1.1': ['p-chen'] };
    const one = step(ready(), { kind: 'setPicks', picks }, NOW);
    expect(savesOf(one.effects)).toEqual([
      {
        kind: 'save',
        n: 1,
        queue: null,
        boot: { bootstrap: SINGLES, toss: null, picks },
        ledger: null,
        tap: null,
      },
    ]);
    const same = { 'bowler.i1.1': ['p-chen'], 'order.first': ['p-sharma'] };
    const two = step(one.state, { kind: 'setPicks', picks: same }, NOW);
    expect(savesOf(two.effects)).toEqual([]);
  });

  it('a sender with no screen keeps no boot cache, picks or not', () => {
    const trusting = ready({ judge: 'trust' });
    const result = step(trusting, { kind: 'setPicks', picks: { 'order.first': ['p-1'] } }, NOW);
    expect(savesOf(result.effects)).toEqual([]);
  });
});

// S2-4 Batch 2 fix round 1 (review M1): a boot cache that was not written is saved again once, as the state holds it
// then; if that save fails too, the line says the scorer's choice was not saved. A cache of the bootstrap alone stays
// quiet (it costs a reopen a network read, never a choice), and a boot save made anew starts the count again.
describe('a refused boot save', () => {
  const PICKS = { 'order.first': ['p-sharma'], 'bowler.i1.1': ['p-chen'] };
  const LATER = { 'order.first': ['p-chen'] };
  const NOT_SAVED = { kind: 'refusal', key: 'scoring.refusal.choiceNotSaved' };

  function picked() {
    return step(ready(), { kind: 'setPicks', picks: PICKS }, NOW).state;
  }

  /** The boot cache a state holds, as a save of it carries it (the same bootstrap, pick and picks). */
  function holding(state: MatchState): BootCache {
    if (state.bootstrap === null) throw new Error('expected a bootstrap');
    return { bootstrap: state.bootstrap, toss: state.toss, picks: state.picks };
  }

  it('is saved again once, with the picks held, and the line is left alone', () => {
    const failed = step(picked(), { kind: 'bootSaveFailed' }, NOW);
    expect(savesOf(failed.effects)).toEqual([
      {
        kind: 'save',
        n: 2,
        queue: null,
        boot: { bootstrap: SINGLES, toss: null, picks: PICKS },
        ledger: null,
        tap: null,
      },
    ]);
    expect(failed.state.line).toBeNull();
    expect(failed.state.saving).toBe(0);
  });

  it('refused twice, it is not saved a third time and the line says the choice was not saved', () => {
    const once = step(picked(), { kind: 'bootSaveFailed' }, NOW);
    const twice = step(once.state, { kind: 'bootSaveFailed' }, NOW);
    expect(savesOf(twice.effects)).toEqual([]);
    expect(twice.state.line).toEqual(NOT_SAVED);
  });

  it('holding no choice of the scorer’s, refused twice it is quiet', () => {
    const once = step(ready(), { kind: 'bootSaveFailed' }, NOW);
    expect(savesOf(once.effects).map((save) => save.boot?.picks)).toEqual([{}]);
    const twice = step(once.state, { kind: 'bootSaveFailed' }, NOW);
    expect(twice.state.line).toBeNull();
  });

  it('a boot save made anew after a refusal starts again: one more refusal is saved again, not said', () => {
    const once = step(picked(), { kind: 'bootSaveFailed' }, NOW);
    const moved = step(once.state, { kind: 'setPicks', picks: { 'order.first': ['p-chen'] } }, NOW);
    expect(savesOf(moved.effects).map((save) => save.boot?.picks)).toEqual([
      { 'order.first': ['p-chen'] },
    ]);
    const again = step(moved.state, { kind: 'bootSaveFailed' }, NOW);
    expect(savesOf(again.effects)).toHaveLength(1);
    expect(again.state.line).toBeNull();
  });

  it('a sender with no screen keeps no boot cache: nothing is saved again', () => {
    const failed = step(ready({ judge: 'trust' }), { kind: 'bootSaveFailed' }, NOW);
    expect(savesOf(failed.effects)).toEqual([]);
  });

  // Batch 2 re-review N1: the serve pick (badminton, table tennis, chess) is a choice of the scorer's on its own.
  it('a serve pick held alone, no pending picks, refused twice, is said too', () => {
    const tossed = step(ready({}, []), { kind: 'pickServer', side: 'second' }, NOW).state;
    expect([tossed.toss, tossed.picks]).toEqual(['second', {}]);
    const once = step(tossed, { kind: 'bootSaveFailed' }, NOW);
    const twice = step(once.state, { kind: 'bootSaveFailed' }, NOW);
    expect(twice.state.line).toEqual(NOT_SAVED);
  });

  // Batch 2 re-review N2: the line always says something true (AGENTS §6). A boot cache written after the line said the
  // choice was not saved (a retry still queued behind a newer save, or a fresh pick on a disk that has recovered) means
  // it is saved now, so the line goes.
  it('said, a boot save that lands clears the line: the choice is saved now', () => {
    const once = step(picked(), { kind: 'bootSaveFailed' }, NOW);
    const twice = step(once.state, { kind: 'bootSaveFailed' }, NOW);
    expect(twice.state.line).toEqual(NOT_SAVED);
    const saved = step(twice.state, { kind: 'bootSaved', boot: holding(twice.state) }, NOW);
    expect(saved.state.line).toBeNull();
    expect(savesOf(saved.effects)).toEqual([]);
  });

  // Batch 3 fix round 1, M4: a landed save proves only what it carried. One that carried an older choice leaves the line.
  it('said, a boot save that lands with an older choice leaves the line: the choice held is not on disk', () => {
    const once = step(picked(), { kind: 'bootSaveFailed' }, NOW);
    const twice = step(once.state, { kind: 'bootSaveFailed' }, NOW);
    const older = { ...holding(twice.state), picks: {} };
    const stale = step(twice.state, { kind: 'bootSaved', boot: older }, NOW);
    expect(stale.state.line).toEqual(NOT_SAVED);
  });

  // M4: the saver is serial. S1 and S2 are asked for; S1 fails, so its retry R1 queues behind S2; S2 lands with the choice
  // held; R1 then fails. The choice is on disk (S2's), so R1's failure says nothing and asks for no save: the latest wins.
  it('a retry that fails after a newer save has landed says nothing and saves nothing: the latest save wins', () => {
    const s1 = step(ready(), { kind: 'setPicks', picks: PICKS }, NOW);
    const s2 = step(s1.state, { kind: 'setPicks', picks: LATER }, NOW);
    const s2Boot = savesOf(s2.effects)[0]?.boot;
    if (s2Boot == null) throw new Error('expected S2 to save the boot cache');
    const s1Failed = step(s2.state, { kind: 'bootSaveFailed' }, NOW);
    expect(savesOf(s1Failed.effects).map((save) => save.boot?.picks)).toEqual([LATER]);
    const s2Landed = step(s1Failed.state, { kind: 'bootSaved', boot: s2Boot }, NOW);
    const r1Failed = step(s2Landed.state, { kind: 'bootSaveFailed' }, NOW);
    expect(r1Failed.state.line).toBeNull();
    expect(savesOf(r1Failed.effects)).toEqual([]);
    // A later choice not yet on disk is a debt again: its refusal is retried as before.
    const s3 = step(r1Failed.state, { kind: 'setPicks', picks: PICKS }, NOW);
    expect(savesOf(step(s3.state, { kind: 'bootSaveFailed' }, NOW).effects)).toHaveLength(1);
  });

  it('a boot save that lands leaves any other line alone', () => {
    const COUNTED = { kind: 'note', key: 'scoring.pad.countedOnce' } as const;
    const NOT_NOW = { kind: 'refusal', key: 'scoring.refusal.notNow' } as const;
    for (const words of [COUNTED, NOT_NOW]) {
      const said = step(picked(), { kind: 'say', words }, NOW);
      const landed = { kind: 'bootSaved', boot: holding(said.state) } as const;
      expect(step(said.state, landed, NOW).state.line).toEqual(words);
    }
    const quiet = picked();
    expect(step(quiet, { kind: 'bootSaved', boot: holding(quiet) }, NOW).state.line).toBeNull();
  });
});
