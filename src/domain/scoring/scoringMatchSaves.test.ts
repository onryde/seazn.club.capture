import { describe, expect, it } from 'vitest';
import { step } from '@/domain/scoring/scoringMatch';
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
