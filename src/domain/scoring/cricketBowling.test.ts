import { describe, expect, it } from 'vitest';
import {
  OVER_TOTALS,
  bowlerRows,
  bowlerStep,
  changeRows,
  changeStep,
  chooseBowler,
  chooseChange,
} from '@/domain/scoring/cricketBowling';
import { flowChoice, moreFlow, standingFlow } from '@/domain/scoring/cricketFlow';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { MORE_CHANGE, MORE_SWAP, moreStep } from '@/domain/scoring/cricketMore';
import { withPick } from '@/domain/scoring/cricketPicks';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  AWAY_BOWLERS,
  DOT,
  KO_2,
  MATCH,
  ONE,
  OPENING,
  OVER_ONE_DONE,
  T20,
  TIED_KO,
  ball,
  bowlerChange,
  inningsOf,
  ledgerOf,
  player,
  superOverOf,
  times,
  toss,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// The next bowler, a mid-over change and a strike swap (S2-4 spec §4.4, rulings 75 and 84; plan Task 13). The reasons and
// their words are the spec's; who may bowl is the engine's (`eligibleBowlers`, `eligibleChangeBowlers`), folded here by
// the real engine from a ledger, never computed by the code under test.

function displayOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = MATCH,
  picks: PendingPicks = NO_PICKS,
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

/** Four overs a bowler, as a T20: a bowler of the last over is not yet out of overs. */
const FOUR_EACH = withCfg(MATCH, T20);
/** Three overs, one a bowler: after two, the first over's bowler is out of overs and did not bowl the last. */
const THREE_OVERS = withCfg(MATCH, { ...KO_2, ballsPerInnings: 18 });
/** Two fielders only: after two overs nobody may bowl the third. */
const TWO_FIELDERS: Bootstrap = {
  ...THREE_OVERS,
  sides: {
    ...MATCH.sides,
    away: { ...AWAY, lineup: AWAY.lineup.filter((row) => (row.orderNo ?? 0) <= 2) },
  },
};

const rowOf = (rows: ReturnType<typeof bowlerRows>, id: string) =>
  rows.find((one) => one.id === id);

describe('the over-end sheet', () => {
  it('greys the last over’s bowler with its reason, the others first and open, each with figures', () => {
    const display = displayOf(OVER_ONE_DONE, FOUR_EACH);
    const rows = bowlerRows(display);
    expect(rows.at(-1)).toMatchObject({ id: A(11), can: false, reason: 'lastOver', oversLeft: 3 });
    expect(rows[0]).toMatchObject({
      id: A(1),
      can: true,
      reason: null,
      figures: '0-0-0-0',
      oversLeft: 4,
    });
    expect(rowOf(rows, A(11))?.figures).toBe('1.0-0-6-0'); // the scorecard's overs, as the board says them
    const step = bowlerStep(display);
    expect(step.title).toEqual({ key: 'scoring.cricket.bowling.title', vars: { number: 2 } });
    expect(step.options.at(-1)).toMatchObject({
      id: A(11),
      disabled: true,
      note: { key: 'scoring.cricket.bowling.lastOver' },
    });
    expect(step.options[0]).toMatchObject({ id: A(1), note: '0-0-0-0' });
    expect(step.options[0]?.disabled).not.toBe(true);
  });

  it('those who may bowl come first: the opening bowler who bowled the last over goes to the end', () => {
    const one = [...OPENING, ...inningsOf('H', [A(1)], times(6, DOT))];
    const ids = bowlerRows(displayOf(one, FOUR_EACH)).map((row) => row.id);
    expect(ids).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1].map(A));
  });

  it('a bowler out of overs reads Out of overs (1)', () => {
    const two = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(12, DOT))];
    const rows = bowlerRows(displayOf(two, THREE_OVERS));
    expect(rowOf(rows, A(11))).toMatchObject({ can: false, reason: 'outOfOvers', oversLeft: 0 });
    expect(
      bowlerStep(displayOf(two, THREE_OVERS)).options.find((one) => one.id === A(11))?.note,
    ).toEqual({
      key: 'scoring.cricket.bowling.outOfOvers',
      vars: { max: 1 },
    });
  });

  it('a bowler both of the last over and out of overs reads Bowled the last over', () => {
    const two = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(12, DOT))];
    expect(rowOf(bowlerRows(displayOf(two, THREE_OVERS)), A(10))?.reason).toBe('lastOver');
  });

  it('a choice is a pick of the over’s bowler, held until its first ball, which names it', () => {
    const display = displayOf(OVER_ONE_DONE, FOUR_EACH);
    expect(display.needs).toBe('bowler');
    const pick = chooseBowler(display, A(9));
    expect(pick).toEqual({ kind: 'bowler', bowler: A(9) });
    const held = displayOf(OVER_ONE_DONE, FOUR_EACH, withPick(NO_PICKS, display, pick!));
    expect([held.needs, held.bowler?.id]).toEqual([null, A(9)]);
    expect(chooseBowler(display, A(11))).toBeNull();
    expect(chooseBowler(display, OVER_TOTALS)).toBeNull();
  });

  it('no eligible bowler after a ball says ask the organiser, with no over totals', () => {
    const two = [...OPENING, ...inningsOf('H', [A(1), A(2)], times(12, DOT))];
    const display = displayOf(two, TWO_FIELDERS);
    expect(bowlerRows(display).map((one) => one.can)).toEqual([false, false]);
    const step = bowlerStep(display);
    expect(step.body).toEqual({ key: 'scoring.cricket.bowling.none' });
    expect(step.options.map((one) => one.id)).toEqual([A(1), A(2)]);
  });

  it('no eligible bowler before the innings’ first ball offers over totals', () => {
    // The engine never has nobody to bowl an innings' first over (a quota is at least 1, and counts per innings): this
    // is the gate's other side, on the same display with no delivery yet.
    const two = [...OPENING, ...inningsOf('H', [A(1), A(2)], times(12, DOT))];
    const display = { ...displayOf(two, TWO_FIELDERS), deliveries: 0 };
    const step = bowlerStep(display);
    expect(step.body).toEqual({ key: 'scoring.cricket.bowling.none' });
    expect(step.options.at(-1)).toMatchObject({
      id: OVER_TOTALS,
      label: { key: 'scoring.cricket.bowling.totals' },
    });
  });
});

/** Two dots by A-p11, then A-p9 takes over: the over in progress, H-p1 still on strike. */
const SPLIT_START: readonly Spec[] = [
  ...OPENING,
  ...[1, 2].map((ballInOver) =>
    ball({ over: 0, ballInOver, striker: H(1), nonStriker: H(2), bowler: A(11) }),
  ),
];
const SPLIT_OVER: readonly Spec[] = [
  ...SPLIT_START,
  bowlerChange(A(9), 'incapacitated'),
  ...[3, 4, 5, 6].map((ballInOver) =>
    ball({ over: 0, ballInOver, striker: H(1), nonStriker: H(2), bowler: A(9) }),
  ),
];

describe('the sheet that stands by itself', () => {
  it('stands while an innings under way has an over due with no bowler, never at the setup’s', () => {
    expect(standingFlow(displayOf(OVER_ONE_DONE, FOUR_EACH))).toEqual({ kind: 'bowler' });
    const display = displayOf(OVER_ONE_DONE, FOUR_EACH);
    const picked = withPick(NO_PICKS, display, { kind: 'bowler', bowler: A(9) });
    expect(standingFlow(displayOf(OVER_ONE_DONE, FOUR_EACH, picked))).toBeNull();
    const setup = displayOf([toss('H', 'bat')], MATCH, { 'openers.i1': [H(1), H(2)] });
    expect([setup.stage, setup.needs]).toEqual(['setup', 'bowler']);
    expect(standingFlow(setup)).toBeNull();
  });
});

describe('a mid-over change (ruling 84)', () => {
  it('offers who may finish the over: not its bowler, nor one out of overs', () => {
    const ids = changeRows(displayOf(SPLIT_START, FOUR_EACH)).map((one) => one.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(A));
  });

  it('asks the bowler, then why, and records cricket.bowler.change', () => {
    const display = displayOf(SPLIT_START, FOUR_EACH);
    expect(changeStep(display, null).name).toBe('change.bowler');
    const reason = chooseChange(display, null, A(9));
    expect(reason).toEqual({ next: A(9) });
    const why = changeStep(display, A(9));
    expect([why.name, why.options.map((one) => one.id)]).toEqual([
      'change.reason',
      ['incapacitated', 'suspended', 'other'],
    ]);
    expect(chooseChange(display, A(9), 'incapacitated')).toEqual({
      done: { kind: 'bowlerChange', bowler: A(9), reason: 'incapacitated' },
    });
    expect(chooseChange(display, null, A(11))).toBeNull();
  });

  it('greys both bowlers of a split over for the next, each with its reason (prevOverBowlers)', () => {
    const rows = bowlerRows(displayOf(SPLIT_OVER, FOUR_EACH));
    expect([rowOf(rows, A(11))?.reason, rowOf(rows, A(9))?.reason]).toEqual([
      'lastOver',
      'lastOver',
    ]);
  });
});

describe('More (ruling 84)', () => {
  const ids = (display: ReturnType<typeof displayOf>) =>
    moreStep(display).options.map((one) => one.id);

  it('mid-over offers the change and the swap', () => {
    expect(ids(displayOf(SPLIT_START, FOUR_EACH))).toEqual([MORE_CHANGE, MORE_SWAP]);
  });

  it('at an over’s end offers no change: the next over’s bowler rides its first ball', () => {
    const display = displayOf(OVER_ONE_DONE, FOUR_EACH);
    const picked = displayOf(
      OVER_ONE_DONE,
      FOUR_EACH,
      withPick(NO_PICKS, display, { kind: 'bowler', bowler: A(9) }),
    );
    expect(ids(picked)).toEqual([MORE_SWAP]);
  });

  it('before the openers are in, More offers nothing', () => {
    expect(displayOf(OPENING).crease).toBeNull();
    expect(ids(displayOf(OPENING))).toEqual([]);
  });

  it('a choice More does not offer does nothing', () => {
    const superOver = displayOf([...TIED_KO, ...superOverOf('A', H(11), [DOT, ONE])]);
    expect(flowChoice(moreFlow(), superOver, MORE_SWAP)).toBeNull();
    expect(flowChoice(moreFlow(), superOver, MORE_CHANGE)).toBeNull();
    const mid = displayOf(SPLIT_START, FOUR_EACH);
    expect(flowChoice(moreFlow(), mid, MORE_SWAP)).toEqual({
      kind: 'pick',
      pick: { kind: 'swap' },
    });
    expect(flowChoice(moreFlow(), mid, MORE_CHANGE)).toEqual({
      kind: 'next',
      flow: { kind: 'change', bowler: null },
    });
  });

  it('no Swap strike in a super over, nor a change', () => {
    const superOver = displayOf([...TIED_KO, ...superOverOf('A', H(11), [DOT, ONE])]);
    expect(superOver.innings?.superOver).toBe(true);
    expect(ids(superOver)).toEqual([]);
  });

  it('Swap strike is a swap pick: the next ball names the pair reversed', () => {
    const display = displayOf(SPLIT_START, FOUR_EACH);
    const swapped = displayOf(
      SPLIT_START,
      FOUR_EACH,
      withPick(NO_PICKS, display, { kind: 'swap' }),
    );
    expect([swapped.crease?.striker.id, swapped.crease?.nonStriker.id]).toEqual([H(2), H(1)]);
  });
});
