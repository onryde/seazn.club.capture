import { cricketPadRules } from '@seazn/engine/pad';
import { cricket } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { ballEventOf } from '@/domain/scoring/cricketEvents';
import { KEEPER_POSITION, KEEPER_ROLE, foldCricket } from '@/domain/scoring/cricketFold';
import { flowChoice, flowStep, standingFlow } from '@/domain/scoring/cricketFlow';
import { withPick, withoutStalePicks } from '@/domain/scoring/cricketPicks';
import type { CricketBallTap, CricketDisplay } from '@/domain/scoring/cricketTypes';
import {
  chooseWicket,
  endsInnings,
  fieldersFor,
  startWicket,
  wicketKinds,
  wicketStep,
  type WicketFlow,
} from '@/domain/scoring/cricketWicket';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  AWAY_BOWLERS,
  DOT,
  FIRST_INNINGS_8,
  HOME_BOWLERS,
  MATCH,
  NO_BALL,
  ONE,
  OPENING,
  OUT,
  TIED_KO,
  inningsOf,
  retire,
  ledgerOf,
  player,
  superBall,
  superOverOf,
  times,
  type Spec,
} from '../../../test/cricketLedger';

// The wicket steps (S2-4 spec §4.3; plan Task 12). Every set is copied from the spec or read from the engine's own export
// (its count asserted); every recorded ball is folded by the real engine, never checked against the code under test.

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

/** One dot ball of the first over: H-p1 on strike, H-p2 at the other end, A-p11 bowling. */
const DOT_ONE: readonly Spec[] = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [DOT])];
const FAIR: CricketBallTap = { bat: 0, extra: null, boundary: null, wicket: null };
const WIDE_BASE: CricketBallTap = {
  bat: 0,
  extra: { kind: 'wide', runs: 1 },
  boundary: null,
  wicket: null,
};
const NO_BALL_BASE: CricketBallTap = {
  bat: 0,
  extra: { kind: 'noball', runs: 1 },
  boundary: null,
  wicket: null,
};
const BYE_BASE: CricketBallTap = {
  bat: 0,
  extra: { kind: 'bye', runs: 0 },
  boundary: null,
  wicket: null,
};

/** Answer the steps in turn; the last answer's outcome. */
function answer(display: CricketDisplay, base: CricketBallTap, ...ids: readonly string[]) {
  let flow: WicketFlow = startWicket(base);
  const steps: string[] = [];
  for (const id of ids) {
    steps.push(wicketStep(flow, display).name);
    const outcome = chooseWicket(flow, display, id);
    if (outcome === null) throw new Error(`${id} refused at ${steps.at(-1)}`);
    if ('done' in outcome) return { steps, done: outcome.done, flow };
    flow = outcome.next;
  }
  return { steps, done: null, flow, next: wicketStep(flow, display) };
}

/** The display once `ball` is recorded after `specs`: the engine's fold of it. */
function after(specs: readonly Spec[], ball: CricketBallTap, bootstrap: Bootstrap = MATCH) {
  const event = ballEventOf(ball, displayOf(specs, bootstrap));
  if (event === null) throw new Error('no event');
  return displayOf([...specs, { type: event.type, payload: event.payload }], bootstrap);
}

const sorted = (kinds: readonly string[]) => [...kinds].sort();

describe('wicketKinds', () => {
  it('a fair ball offers every kind but retired and timed out', () => {
    expect(wicketKinds(displayOf(DOT_ONE), null)).toEqual([
      'bowled',
      'caught',
      'lbw',
      'runout',
      'stumped',
      'hitwicket',
      'obstructed',
      'hitballtwice',
    ]);
  });

  it('a free hit offers run out and obstructing only', () => {
    const freeHit = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [NO_BALL])]);
    expect(freeHit.freeHit).toBe(true);
    expect(sorted(wicketKinds(freeHit, null))).toEqual(['obstructed', 'runout']);
  });

  it('a wide offers hit wicket, obstructing, run out, stumped', () => {
    expect(sorted(wicketKinds(displayOf(DOT_ONE), WIDE_BASE.extra))).toEqual([
      'hitwicket',
      'obstructed',
      'runout',
      'stumped',
    ]);
  });

  it('a no-ball offers exactly noBallDismissalKinds', () => {
    const kinds = wicketKinds(displayOf(DOT_ONE), NO_BALL_BASE.extra);
    expect(sorted(kinds)).toEqual(sorted(cricketPadRules.noBallDismissalKinds));
    expect(kinds).toHaveLength(3);
  });
});

describe('fieldersFor', () => {
  it('stumped offers the keeper only', () => {
    expect(fieldersFor('stumped', displayOf(DOT_ONE)).map((one) => one.id)).toEqual([A(2)]);
  });

  it('stumped without a keeper offers the side without the bowler', () => {
    const noKeeper: Bootstrap = {
      ...MATCH,
      sides: {
        ...MATCH.sides,
        away: { ...AWAY, lineup: AWAY.lineup.map(({ roles: _roles, ...row }) => row) },
      },
    };
    const ids = fieldersFor('stumped', displayOf(DOT_ONE, noKeeper)).map((one) => one.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(A));
  });

  it('caught offers the whole fielding side, the bowler too', () => {
    expect(fieldersFor('caught', displayOf(DOT_ONE))).toHaveLength(11);
  });

  it('the keeper keys are in the engine’s position catalog (F17, W10)', () => {
    const catalog = JSON.stringify(cricket.positions);
    expect(catalog).toContain(`"${KEEPER_ROLE}"`);
    expect(catalog).toContain(`"${KEEPER_POSITION}"`);
  });
});

describe('the steps', () => {
  it('run out asks who, fielder, assist, runs, then the next batter', () => {
    const run = answer(displayOf(DOT_ONE), FAIR, 'runout', H(2), A(5), 'none', '1');
    expect(run.steps).toEqual([
      'wicket.kind',
      'wicket.who',
      'wicket.fielder',
      'wicket.assist',
      'wicket.completed',
    ]);
    expect(run.next?.name).toBe('wicket.incoming');
  });

  it('bowled asks the next batter only; lbw too', () => {
    expect(answer(displayOf(DOT_ONE), FAIR, 'bowled').next?.name).toBe('wicket.incoming');
    const lbw = answer(displayOf(DOT_ONE), FAIR, 'lbw', H(3));
    expect(lbw.done?.wicket).toEqual({
      kind: 'lbw',
      out: H(1),
      fielder: null,
      fielderAssist: null,
      incoming: H(3),
    });
  });

  it('who is out names each end: on strike, the non-striker', () => {
    const { next } = answer(displayOf(DOT_ONE), FAIR, 'runout');
    expect(next?.options.map((one) => [one.id, one.note])).toEqual([
      [H(1), { key: 'scoring.cricket.board.onStrike' }],
      [H(2), { key: 'scoring.cricket.wicket.nonStriker' }],
    ]);
  });

  it('caught asks the fielder, required: no “No fielder” row', () => {
    const { next } = answer(displayOf(DOT_ONE), FAIR, 'caught');
    expect(next?.name).toBe('wicket.fielder');
    expect(next?.options.map((one) => one.id)).not.toContain('none');
  });

  it('obstructing may name no fielder', () => {
    const { next } = answer(displayOf(DOT_ONE), FAIR, 'obstructed', H(1));
    expect(next?.options.at(-1)?.id).toBe('none');
    const done = answer(displayOf(DOT_ONE), FAIR, 'obstructed', H(1), 'none', H(3)).done;
    expect(done?.wicket).toEqual({
      kind: 'obstructed',
      out: H(1),
      fielder: null,
      fielderAssist: null,
      incoming: H(3),
    });
  });

  it('assist cannot be the fielder: greyed, with its reason', () => {
    const { next } = answer(displayOf(DOT_ONE), FAIR, 'runout', H(1), A(5));
    const same = next?.options.find((one) => one.id === A(5));
    expect([same?.disabled, same?.note]).toEqual([
      true,
      { key: 'scoring.cricket.wicket.isFielder' },
    ]);
    expect(
      chooseWicket(
        answer(displayOf(DOT_ONE), FAIR, 'runout', H(1), A(5)).flow,
        displayOf(DOT_ONE),
        A(5),
      ),
    ).toBeNull();
  });

  it('a run out’s completed runs go to the bat on a fair ball, to the extra’s runs off a wide or a no-ball, and to a bye’s runs', () => {
    const display = displayOf(DOT_ONE);
    const out = (base: CricketBallTap) =>
      answer(display, base, 'runout', H(1), A(5), 'none', '2', H(3)).done!;
    const fair = out(FAIR);
    const wide = out(WIDE_BASE);
    const noBall = out(NO_BALL_BASE);
    const bye = out(BYE_BASE);
    expect([fair.bat, fair.extra]).toEqual([2, null]);
    expect([wide.bat, wide.extra]).toEqual([0, { kind: 'wide', runs: 3 }]);
    expect([noBall.bat, noBall.extra]).toEqual([0, { kind: 'noball', runs: 3 }]);
    expect([bye.bat, bye.extra]).toEqual([0, { kind: 'bye', runs: 2 }]);
    // Each folds: the engine adds the runs, one wicket down, A-p5 credited.
    for (const [ball, runs] of [
      [fair, 2],
      [wide, 3],
      [noBall, 3],
      [bye, 2],
    ] as const) {
      expect([after(DOT_ONE, ball).innings?.runs, after(DOT_ONE, ball).innings?.wickets]).toEqual([
        runs,
        1,
      ]);
    }
  });
});

describe('a bye’s + Out with no runs', () => {
  it('records the wicket on a ball with no extra: the engine refuses a bye of no runs', () => {
    const display = displayOf(DOT_ONE);
    const stumped = answer(display, BYE_BASE, 'stumped', A(2), H(3)).done!;
    const runOut = answer(
      display,
      { ...BYE_BASE, extra: { kind: 'legbye', runs: 0 } },
      'runout',
      H(1),
      A(5),
      'none',
      '0',
      H(3),
    ).done!;
    expect([stumped.bat, stumped.extra, runOut.bat, runOut.extra]).toEqual([0, null, 0, null]);
    for (const ball of [stumped, runOut]) {
      expect([after(DOT_ONE, ball).innings?.runs, after(DOT_ONE, ball).innings?.wickets]).toEqual([
        0, 1,
      ]);
    }
  });
});

describe('who walks in', () => {
  it('a wicket on the innings’ first ball asks who walks in: no ball has opened it yet', () => {
    const ready: PendingPicks = { 'openers.i1': [H(1), H(2)], 'bowler.i1.0': [A(11)] };
    const first = displayOf(OPENING, MATCH, ready);
    expect(first.crease?.striker.id).toBe(H(1));
    const { next } = answer(first, FAIR, 'bowled');
    expect([next?.name, next?.options[0]?.id]).toEqual(['wicket.incoming', H(3)]);
  });

  it('never offers a batter already out, nor the one staying in', () => {
    const oneDown = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [OUT])]);
    expect(oneDown.crease?.striker.id).toBe(H(3));
    const ids = answer(oneDown, FAIR, 'bowled').next?.options.map((one) => one.id);
    expect(ids).toEqual([4, 5, 6, 7, 8, 9, 10, 11].map(H));
  });

  it('a super over’s first wicket asks no next batter: its replacement rides the next ball', () => {
    const one = [...TIED_KO, ...superOverOf('A', H(11), [DOT])];
    expect(displayOf(one).innings?.superOver).toBe(true);
    expect(answer(displayOf(one), FAIR, 'bowled').done?.wicket?.incoming).toBeNull();
  });

  it('a run out on the chase’s last ball that ties it into a super over asks no next batter', () => {
    const chase = [
      ...FIRST_INNINGS_8,
      ...inningsOf('A', HOME_BOWLERS, [...times(7, ONE), ...times(4, DOT)]),
    ];
    expect([displayOf(chase).innings?.runs, displayOf(chase).innings?.legalBalls]).toEqual([7, 11]);
    const tie = answer(displayOf(chase), FAIR, 'runout', A(1), H(5), 'none', '1');
    expect(tie.done?.wicket?.incoming).toBeNull();
    expect(after(chase, tie.done!).innings?.superOver).toBe(true);
  });

  it('no incoming on the last ball of the innings', () => {
    const eleven = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(11, DOT))];
    expect(answer(displayOf(eleven), FAIR, 'bowled').done?.wicket?.incoming).toBeNull();
  });

  it('a wicket off a wide on the last legal ball still asks who walks in', () => {
    const eleven = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(11, DOT))];
    expect(answer(displayOf(eleven), WIDE_BASE, 'stumped', A(2)).next?.name).toBe(
      'wicket.incoming',
    );
  });

  it('no incoming at all out (players − 1)', () => {
    const nine = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(9, OUT))];
    expect(displayOf(nine).innings?.wickets).toBe(9);
    expect(answer(displayOf(nine), FAIR, 'bowled').done?.wicket?.incoming).toBeNull();
  });

  it('no incoming on the super over’s second wicket', () => {
    const one = [...TIED_KO, ...superOverOf('A', H(11), [OUT])];
    const display = displayOf(
      one,
      MATCH,
      withPick(NO_PICKS, displayOf(one), { kind: 'incoming', batter: A(3) }),
    );
    expect(display.innings?.superOver).toBe(true);
    expect(answer(display, FAIR, 'bowled').done?.wicket?.incoming).toBeNull();
  });

  it('a run out whose completed runs win the chase asks no next batter: needing 2, 2 completed; 0 completed asks', () => {
    const chase = [...FIRST_INNINGS_8, ...inningsOf('A', ['H-p11', 'H-p10'], times(7, ONE))];
    expect(displayOf(chase).innings?.chase?.need).toBe(2);
    expect(
      answer(displayOf(chase), FAIR, 'runout', A(1), H(5), 'none', '2').done?.wicket?.incoming,
    ).toBeNull();
    expect(answer(displayOf(chase), FAIR, 'runout', A(1), H(5), 'none', '0').next?.name).toBe(
      'wicket.incoming',
    );
  });

  it('endsInnings reads a refused ball as not ending, so the step is asked', () => {
    const refused: CricketBallTap = {
      ...FAIR,
      wicket: { kind: 'bowled', out: 'nobody', fielder: null, fielderAssist: null, incoming: null },
    };
    expect(endsInnings(displayOf(DOT_ONE), refused)).toBe(false);
  });

  it('a retired batter is offered, said Retired not out, never the suggestion', () => {
    const retired = displayOf([...DOT_ONE, retire(H(1), 'hurt', H(3))]);
    const { next } = answer(retired, FAIR, 'bowled');
    expect(next?.options.slice(0, 2).map((one) => [one.id, one.chosen === true, one.note])).toEqual(
      [
        [H(4), true, { key: 'scoring.cricket.wicket.nextInOrder' }],
        [H(1), false, { key: 'scoring.cricket.wicket.retired' }],
      ],
    );
  });

  it('the suggested batter follows the reordered order, marked chosen; the rest follow', () => {
    const before = displayOf(DOT_ONE);
    const order = [H(1), H(2), H(7), H(3), H(4), H(5), H(6), H(8), H(9), H(10), H(11)];
    const reordered = displayOf(
      DOT_ONE,
      MATCH,
      withPick(NO_PICKS, before, { kind: 'order', side: 'first', ids: order }),
    );
    const { next } = answer(reordered, FAIR, 'bowled');
    expect(next?.options.slice(0, 2).map((one) => [one.id, one.chosen === true])).toEqual([
      [H(7), true],
      [H(3), false],
    ]);
  });
});

// T19 device run D10 (Critical): the super over's first wicket left an end empty and nothing asked who takes it, so every
// ball after it was refused and the pad was stuck. Spec §4.6: "After the first wicket the Next batter step still asks,
// but its answer rides the next ball as its striker or nonStriker"; the second wicket ends it with no Next batter. The
// wicket's own steps ask none in a super over (the engine ignores `incoming` there), so the sheet stands after the ball,
// as the over's end's does, and keeps a pick the next ball carries (`incoming.<ordinal>`).
describe('the super over’s next batter (T19 D10)', () => {
  /** Away bats the super over first (A-p1 and A-p2), H-p11 bowling: a single puts A-p2 on strike, then A-p2 is bowled. */
  const ONE_DOWN = [...TIED_KO, ...superOverOf('A', H(11), [ONE, OUT])];
  const NEXT: PendingPicks = { 'incoming.s1': [A(3)] };
  /** The third ball, A-p3 in at the striker's end; bowled too when `out`. */
  const third = (out: boolean): Spec =>
    superBall({
      over: 0,
      ballInOver: 3,
      striker: A(3),
      nonStriker: A(1),
      bowler: H(11),
      ...(out ? { wicket: { kind: 'bowled', out: A(3), bowlerCredited: true } } : {}),
    });

  it('after the first wicket the next ball needs a batter, and the Next batter sheet stands over the pad', () => {
    const display = displayOf(ONE_DOWN);
    expect([display.stage, display.needs, display.crease, display.innings?.wickets]).toEqual([
      'live',
      'incoming',
      null,
      1,
    ]);
    const flow = standingFlow(display);
    expect(flow).toEqual({ kind: 'incoming' });
    const step = flowStep({ kind: 'incoming' }, display);
    expect(step.title).toEqual({ key: 'scoring.cricket.wicket.incoming' });
    // Not A-p1 (in) nor A-p2 (out): the order's next, A-p3, first and suggested.
    expect(step.options.map((one) => one.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11].map(A));
    expect(step.options[0]).toMatchObject({ id: A(3), chosen: true });
  });

  it('a batter chosen is kept, recording nothing: the crease fills and the sheet goes', () => {
    const display = displayOf(ONE_DOWN);
    expect(flowChoice({ kind: 'incoming' }, display, A(5))).toEqual({
      kind: 'pick',
      pick: { kind: 'incoming', batter: A(5) },
    });
    const picks = withPick(NO_PICKS, display, { kind: 'incoming', batter: A(5) });
    expect(picks).toEqual({ 'incoming.s1': [A(5)] });
    const filled = displayOf(ONE_DOWN, MATCH, picks);
    expect([filled.needs, filled.crease?.striker.id, filled.crease?.nonStriker.id]).toEqual([
      null,
      A(5),
      A(1),
    ]);
    expect(standingFlow(filled)).toBeNull();
  });

  it('offers nobody at the crease and nobody out: those choices keep nothing', () => {
    const display = displayOf(ONE_DOWN);
    expect(flowChoice({ kind: 'incoming' }, display, A(1))).toBeNull();
    expect(flowChoice({ kind: 'incoming' }, display, A(2))).toBeNull();
    expect(flowChoice({ kind: 'incoming' }, display, H(3))).toBeNull();
  });

  it('the engine takes the next ball with the pick at the empty end, and the pick then goes', () => {
    const next = displayOf([...ONE_DOWN, third(false)], MATCH, NEXT);
    expect([next.innings?.legalBalls, next.crease?.striker.id, next.needs]).toEqual([
      3,
      A(3),
      null,
    ]);
    // Carried: the crease is full again, so a later wicket asks afresh.
    expect(withoutStalePicks(NEXT, next)).toEqual({});
    expect(withoutStalePicks(NEXT, displayOf(ONE_DOWN, MATCH, NEXT))).toBe(NEXT);
  });

  it('the second wicket ends the side’s super over: no Next batter, the break before the other side’s', () => {
    const display = displayOf([...ONE_DOWN, third(true)], MATCH, NEXT);
    expect([display.stage, display.needs, display.innings?.batting]).toEqual([
      'superOverSetup',
      'openers',
      'first',
    ]);
    expect(standingFlow(display)).toBeNull();
  });

  it('a main innings never stands the sheet: its wicket’s own step names who walks in', () => {
    const oneDown = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, [OUT])]);
    expect([oneDown.needs, oneDown.crease?.striker.id]).toEqual([null, H(3)]);
    expect(standingFlow(oneDown)).toBeNull();
    // A retirement with nobody named: the engine walks the order, so no end is left empty either.
    const retired = displayOf([
      ...OPENING,
      ...inningsOf('H', AWAY_BOWLERS, [ONE]),
      retire(H(1), 'hurt'),
    ]);
    expect([retired.needs, retired.crease?.nonStriker.id]).toEqual([null, H(3)]);
  });

  it('a run out of the non-striker empties the other end: the sheet asks, and the pick takes that end', () => {
    const runOut = superBall({
      over: 0,
      ballInOver: 2,
      striker: A(2),
      nonStriker: A(1),
      bowler: H(11),
      wicket: { kind: 'runout', out: A(1), fielder: H(5), bowlerCredited: false },
    });
    const specs = [...TIED_KO, ...superOverOf('A', H(11), [ONE]), runOut];
    expect([displayOf(specs).needs, standingFlow(displayOf(specs))]).toEqual([
      'incoming',
      { kind: 'incoming' },
    ]);
    const filled = displayOf(specs, MATCH, NEXT);
    expect([filled.crease?.striker.id, filled.crease?.nonStriker.id]).toEqual([A(2), A(3)]);
    expect(withoutStalePicks(NEXT, filled)).toBe(NEXT);
  });

  it('an Undo of the first wicket after a batter was chosen drops the pick: the wicket again asks afresh', () => {
    const before = [...TIED_KO, ...superOverOf('A', H(11), [ONE])];
    const undone = displayOf(before, MATCH, NEXT);
    expect(undone.crease?.striker.id).toBe(A(2));
    expect(withoutStalePicks(NEXT, undone)).toEqual({});
  });
});
