import { describe, expect, it } from 'vitest';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { picksFor, withPick } from '@/domain/scoring/cricketPicks';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import {
  FIRST_INNINGS_8,
  MATCH,
  OPENING,
  OVER_ONE_DONE,
  TIED_KO,
  ball,
  ledgerOf,
  player,
  superOverOf,
  toss,
  type Spec,
} from '../../../test/cricketLedger';

// Cricket's pending picks (S2-4 spec §4.1 to §4.6, §6; plan Task 5): written for the display's next ball, keyed to its
// innings (`i1`…, `s1`…) and its over or ball, and dropped once that innings or over is past. Every key is written out.

function displayOf(specs: readonly Spec[], picks: PendingPicks = NO_PICKS) {
  const folded = foldCricket({
    bootstrap: MATCH,
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

const DOT_ONE = [
  ...OPENING,
  ball({ over: 0, ballInOver: 1, striker: H(1), nonStriker: H(2), bowler: A(11) }),
];

describe('withPick', () => {
  it('writes the openers of the innings due', () => {
    const display = displayOf([toss('H', 'bat')]);
    expect(
      withPick(NO_PICKS, display, { kind: 'openers', striker: H(1), nonStriker: H(2) }),
    ).toStrictEqual({
      'openers.i1': [H(1), H(2)],
    });
  });

  it('writes the bowler of the over due, counted from 0', () => {
    expect(withPick(NO_PICKS, displayOf(OPENING), { kind: 'bowler', bowler: A(11) })).toStrictEqual(
      {
        'bowler.i1.0': [A(11)],
      },
    );
    expect(
      withPick(NO_PICKS, displayOf(OVER_ONE_DONE), { kind: 'bowler', bowler: A(10) }),
    ).toStrictEqual({
      'bowler.i1.1': [A(10)],
    });
  });

  it('writes a side’s order, before the toss too', () => {
    expect(
      withPick(NO_PICKS, displayOf([]), { kind: 'order', side: 'second', ids: [A(2), A(1)] }),
    ).toStrictEqual({
      'order.second': [A(2), A(1)],
    });
  });

  it('writes nothing that needs an innings before the toss', () => {
    const before = displayOf([]);
    expect(withPick(NO_PICKS, before, { kind: 'openers', striker: H(1), nonStriker: H(2) })).toBe(
      NO_PICKS,
    );
    expect(withPick(NO_PICKS, before, { kind: 'swap' })).toBe(NO_PICKS);
  });

  it('a swap writes the display’s crease reversed for the next ball, and a second swap puts it back', () => {
    const once = withPick(NO_PICKS, displayOf(DOT_ONE), { kind: 'swap' });
    expect(once).toStrictEqual({ 'swap.i1.1': [H(2), H(1)] });
    const swapped = displayOf(DOT_ONE, once);
    expect(swapped.crease?.striker.id).toBe(H(2));
    const twice = withPick(once, swapped, { kind: 'swap' });
    expect(twice).toStrictEqual({ 'swap.i1.1': [H(1), H(2)] });
    expect(displayOf(DOT_ONE, twice).crease?.striker.id).toBe(H(1));
  });

  // The controller's ruling (Batch 2 fix round 1): keyed to the deliveries, a wide counts though no legal ball moved.
  it('a swap after a wide is keyed to the delivery count, not the legal balls', () => {
    const wide = [
      ...DOT_ONE,
      ball({
        over: 0,
        ballInOver: 2,
        striker: H(1),
        nonStriker: H(2),
        bowler: A(11),
        extras: { kind: 'wide', runs: 1 },
      }),
    ];
    expect(withPick(NO_PICKS, displayOf(wide), { kind: 'swap' })).toStrictEqual({
      'swap.i1.2': [H(2), H(1)],
    });
  });

  it('writes a super over’s replacement for its innings', () => {
    const out = displayOf([...TIED_KO, ...superOverOf('A', H(11), [{ out: true }])]);
    expect(withPick(NO_PICKS, out, { kind: 'incoming', batter: A(3) })).toStrictEqual({
      'incoming.s1': [A(3)],
    });
  });

  it('drops the keys of an innings already past, and keeps the orders', () => {
    const picks = {
      'order.first': [H(2), H(1)],
      'openers.i1': [H(1), H(2)],
      'bowler.i1.1': [A(10)],
      'swap.i1.7': [H(2), H(1)],
      'openers.i2': [A(1), A(2)],
    };
    const next = withPick(picks, displayOf(FIRST_INNINGS_8), { kind: 'bowler', bowler: H(11) });
    expect(next).toStrictEqual({
      'order.first': [H(2), H(1)],
      'openers.i2': [A(1), A(2)],
      'bowler.i2.0': [H(11)],
    });
  });

  it('drops an over and a ball already bowled in the innings now, and keeps the rest of it', () => {
    const picks = {
      'openers.i1': [H(1), H(2)],
      'bowler.i1.0': [A(11)],
      'bowler.i1.1': [A(10)],
      'swap.i1.5': [H(2), H(1)],
      'swap.i1.6': [H(1), H(2)],
    };
    const next = withPick(picks, displayOf(OVER_ONE_DONE), {
      kind: 'order',
      side: 'first',
      ids: [H(1)],
    });
    expect(next).toStrictEqual({
      'openers.i1': [H(1), H(2)],
      'bowler.i1.1': [A(10)],
      'swap.i1.6': [H(1), H(2)],
      'order.first': [H(1)],
    });
  });

  it('every main innings is before every super-over innings', () => {
    const picks = {
      'openers.i2': [A(1), A(2)],
      'bowler.i2.1': [H(10)],
      'openers.s1': [A(1), A(2)],
    };
    expect(withPick(picks, displayOf(TIED_KO), { kind: 'bowler', bowler: H(11) })).toStrictEqual({
      'openers.s1': [A(1), A(2)],
      'bowler.s1.0': [H(11)],
    });
  });
});

describe('picksFor', () => {
  it('reads the picks for the display’s next ball, each one the match allows', () => {
    const picks = {
      'order.second': [A(3)],
      'openers.i1': [H(1), H(2)],
      'bowler.i1.0': [A(11)],
      'bowler.i1.1': [A(10)],
    };
    const now = picksFor(picks, displayOf(OPENING, picks));
    expect(now.openers).toStrictEqual({ striker: H(1), nonStriker: H(2) });
    expect(now.bowler).toBe(A(11));
    expect(now.incoming).toBeNull();
    expect(now.swap).toBeNull();
    expect(now.order.second.slice(0, 3)).toStrictEqual([A(3), A(1), A(2)]);
    expect(now.order.first[0]).toBe(H(1));
  });

  it('an openers’ pick of one batter twice, or of three, is none; a bowler’s of two is none', () => {
    const twice = { 'openers.i1': [H(1), H(1)] };
    expect(picksFor(twice, displayOf(OPENING, twice)).openers).toBeNull();
    const three = { 'openers.i1': [H(1), H(2), H(3)], 'bowler.i1.0': [A(11), A(10)] };
    const now = picksFor(three, displayOf(OPENING, three));
    expect(now.openers).toBeNull();
    expect(now.bowler).toBeNull();
  });

  it('an order naming a batter twice keeps the first', () => {
    const picks = { 'order.first': [H(3), H(3), H(1)] };
    const order = picksFor(picks, displayOf(OPENING, picks)).order.first;
    expect(order.slice(0, 3)).toStrictEqual([H(3), H(1), H(2)]);
    expect(order).toHaveLength(11);
  });

  it('the openers apply only before the innings opens, and a replacement only in a super over', () => {
    const picks = { 'openers.i1': [H(1), H(2)], 'incoming.i1': [H(3)] };
    const now = picksFor(picks, displayOf(DOT_ONE, picks));
    expect(now.openers).toBeNull();
    expect(now.incoming).toBeNull();
  });
});
