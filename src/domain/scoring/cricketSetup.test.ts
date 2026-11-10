import { describe, expect, it } from 'vitest';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { moved, setupStep, setupView } from '@/domain/scoring/cricketSetup';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  ALL_OUT_FIRST,
  MATCH,
  NO_AWAY_PLAYERS,
  OPENING,
  ledgerOf,
  player,
  toss,
  type Spec,
} from '../../../test/cricketLedger';

// Cricket's setup before the first ball (S2-4 spec §4.1, owner ruling 83; plan Task 10): which step the screen asks, read
// off the display (which holds the pending picks), and what each step shows. The players and their order are the
// fixture's team sheet (`test/cricketLedger.ts`): 1 to 11 start in that order, the 12th and the coach do not.

function displayOf(
  specs: readonly Spec[],
  picks: PendingPicks = NO_PICKS,
  bootstrap: Bootstrap = MATCH,
) {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);
const homeName = (n: number) => `Home Player ${n}`;
const awayName = (n: number) => `Away Player ${n}`;
const ELEVEN = Array.from({ length: 11 }, (_, i) => i + 1);

const TOSSED = [toss('H', 'bat')];
const OPENERS = { 'openers.i1': [H(1), H(2)] };
const BOWLER = { 'bowler.i1.0': [A(11)] };

describe('setupStep', () => {
  it('asks the toss before anything', () => {
    expect(setupStep(displayOf([]))).toBe('toss');
  });

  it('after the toss asks the batting order until the openers are picked', () => {
    expect(setupStep(displayOf(TOSSED))).toBe('order');
    expect(setupStep(displayOf(TOSSED, { 'order.first': [H(3), H(1)] }))).toBe('order');
  });

  it('then the first bowler, then it is ready', () => {
    expect(setupStep(displayOf(TOSSED, OPENERS))).toBe('bowler');
    expect(setupStep(displayOf(TOSSED, { ...OPENERS, ...BOWLER }))).toBe('ready');
  });

  it('a later innings with no openers asks the openers, not the order', () => {
    expect(setupStep(displayOf(ALL_OUT_FIRST))).toBe('openers');
  });

  it('a side with no players entered is ready at once: it scores over totals (spec §4.10)', () => {
    expect(setupStep(displayOf(TOSSED, NO_PICKS, NO_AWAY_PLAYERS))).toBe('ready');
  });

  it('an openers pick the engine does not allow (a bench player) is no pick: the order is asked', () => {
    expect(setupStep(displayOf(TOSSED, { 'openers.i1': [H(12), H(1)] }))).toBe('order');
  });
});

describe('setupView', () => {
  it('names the teams for the toss, home first, and no sides before it', () => {
    const view = setupView(displayOf([]));
    expect(view.teams).toEqual([
      { id: 'first', label: 'Home CC' },
      { id: 'second', label: 'Away CC' },
    ]);
    expect([view.batting, view.fielding, view.order, view.bowlers]).toEqual([null, null, [], []]);
  });

  it('the order lists starters only, Opener on the first two', () => {
    const view = setupView(displayOf(TOSSED));
    expect(view.batting).toEqual({ id: 'first', label: 'Home CC' });
    expect(view.order.map((one) => one.name)).toEqual(ELEVEN.map(homeName));
    expect(view.order.map((one) => one.opener)).toEqual(ELEVEN.map((n) => n <= 2));
    expect(view.nextOpeners).toEqual({ striker: H(1), nonStriker: H(2) });
  });

  it('a toss won and put in to bowl gives the other side the bat', () => {
    const view = setupView(displayOf([toss('H', 'bowl')]));
    expect([view.batting?.label, view.fielding?.label]).toEqual(['Away CC', 'Home CC']);
    expect(view.order.map((one) => one.name)).toEqual(ELEVEN.map(awayName));
    expect(view.bowlers.map((one) => one.name)).toEqual(ELEVEN.map(homeName));
  });

  it('a reordered order is the order shown, and the openers follow it', () => {
    const view = setupView(displayOf(TOSSED, { 'order.first': [H(3), H(1)] }));
    expect(view.order.slice(0, 4).map((one) => [one.id, one.opener])).toEqual([
      [H(3), true],
      [H(1), true],
      [H(2), false],
      [H(4), false],
    ]);
    expect(view.nextOpeners).toEqual({ striker: H(3), nonStriker: H(1) });
  });

  it('shows the openers picked, the striker first, and none before the pick', () => {
    expect(setupView(displayOf(TOSSED)).openers).toBeNull();
    expect(setupView(displayOf(TOSSED, { 'openers.i1': [H(2), H(1)] })).openers).toEqual({
      striker: { id: H(2), name: homeName(2) },
      nonStriker: { id: H(1), name: homeName(1) },
    });
  });

  it('offers the fielding side’s starters to bowl, the one picked marked', () => {
    const before = setupView(displayOf(TOSSED, OPENERS));
    expect(before.fielding).toEqual({ id: 'second', label: 'Away CC' });
    expect(before.bowlers.map((one) => one.name)).toEqual(ELEVEN.map(awayName));
    expect(before.bowlers.filter((one) => one.chosen)).toEqual([]);
    const after = setupView(displayOf(TOSSED, { ...OPENERS, ...BOWLER }));
    expect(after.bowlers.filter((one) => one.chosen).map((one) => one.id)).toEqual([A(11)]);
  });

  it('names no openers for an order of fewer than two', () => {
    const view = setupView(displayOf(TOSSED, NO_PICKS, NO_AWAY_PLAYERS));
    expect(view.bowlers).toEqual([]);
    const lone = setupView(displayOf([toss('A', 'bat')], NO_PICKS, NO_AWAY_PLAYERS));
    expect([lone.order, lone.nextOpeners]).toEqual([[], null]);
  });

  it('is read off a match under way the same way: the side batting now', () => {
    expect(setupView(displayOf(OPENING)).batting).toEqual({ id: 'first', label: 'Home CC' });
  });
});

describe('moved', () => {
  const IDS = ['a', 'b', 'c'];

  it('moves a batter one place up or down', () => {
    expect(moved(IDS, 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moved(IDS, 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the order as it was for a move off either end', () => {
    expect(moved(IDS, 0, -1)).toEqual(IDS);
    expect(moved(IDS, 2, 3)).toEqual(IDS);
    expect(moved(IDS, -1, 0)).toEqual(IDS);
    expect(moved(IDS, 3, 2)).toEqual(IDS);
  });
});
