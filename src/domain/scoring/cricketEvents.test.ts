import { cricketPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import { cricketEventFor, cricketPayloadForSend } from '@/domain/scoring/cricketEvents';
import { foldCricket } from '@/domain/scoring/cricketFold';
import type { CricketBallTap, CricketTap, CricketWicketTap } from '@/domain/scoring/cricketTypes';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { SportEvent } from '@/domain/scoring/scoringSport';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  HOME,
  MATCH,
  OPENING,
  OVER_ONE_DONE,
  TIED_KO,
  ball,
  ledgerOf,
  player,
  queuedOf,
  toss,
  type Spec,
} from '../../../test/cricketLedger';

// A cricket tap as the event the server records (S2-4 spec §4.2 to §4.10; plan Task 6). Every payload is written out from
// the spec and the engine's schema, and each ball is checked against the engine itself: it must be a tap the fold takes.

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);

/** The first innings ready: `H-p1` and `H-p2` open, `A-p11` bowls the first over. */
const READY: PendingPicks = { 'openers.i1': [H(1), H(2)], 'bowler.i1.0': [A(11)] };

function displayOf(specs: readonly Spec[], picks: PendingPicks) {
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

function eventOf(
  specs: readonly Spec[],
  tap: CricketTap,
  picks: PendingPicks = NO_PICKS,
  bootstrap: Bootstrap = MATCH,
) {
  return cricketEventFor(tap, { bootstrap, display: displayOf(specs, picks) });
}

/** Whether the engine takes `event` on top of the ledger, as `legalQueued` judges a queued tap. */
function taken(specs: readonly Spec[], event: SportEvent | null, picks: PendingPicks): boolean {
  if (event === null) return false;
  const folded = foldCricket({
    bootstrap: MATCH,
    ledger: ledgerOf(specs),
    queued: [queuedOf('q-tap', event)],
    ownEventIds: [],
    toss: null,
    picks,
  });
  return folded.kind === 'folded' && folded.legalQueued.includes('q-tap');
}

const tapOf = (ball: Partial<CricketBallTap>): CricketTap => ({
  kind: 'ball',
  ball: { bat: 0, extra: null, boundary: null, wicket: null, ...ball },
});

const out = (wicket: Partial<CricketWicketTap> & Pick<CricketWicketTap, 'kind' | 'out'>) => ({
  fielder: null,
  fielderAssist: null,
  incoming: null,
  ...wicket,
});

/** The payload of a ball event, read as an object. */
function payloadOf(event: SportEvent | null): Record<string, unknown> {
  if (event === null) throw new Error('no event');
  return event.payload as Record<string, unknown>;
}

describe('the toss and Start', () => {
  it('names the toss winner by the entrant in the seat tapped', () => {
    expect(eventOf([], { kind: 'toss', wonBy: 'first', elected: 'bowl' })).toStrictEqual({
      type: 'cricket.toss',
      payload: { wonBy: 'ent-home', elected: 'bowl' },
    });
    expect(eventOf([], { kind: 'toss', wonBy: 'second', elected: 'bat' })).toStrictEqual({
      type: 'cricket.toss',
      payload: { wonBy: 'ent-away', elected: 'bat' },
    });
  });

  it('a toss with a seat empty is no event', () => {
    const noAway = { ...MATCH, sides: { home: HOME, away: null } };
    const display = displayOf([], NO_PICKS);
    const tap: CricketTap = { kind: 'toss', wonBy: 'first', elected: 'bat' };
    expect(cricketEventFor(tap, { bootstrap: noAway, display })).toBeNull();
  });

  it('Start is core.start with nothing in it', () => {
    expect(eventOf([toss('H', 'bat')], { kind: 'start' })).toStrictEqual({
      type: 'core.start',
      payload: {},
    });
  });
});

describe('a ball', () => {
  it('the first ball names the openers, the bowler, over 0 and ball 1', () => {
    const event = eventOf(OPENING, tapOf({}), READY);
    expect(event).toStrictEqual({
      type: 'cricket.ball',
      payload: {
        over: 0,
        ballInOver: 1,
        striker: H(1),
        nonStriker: H(2),
        bowler: A(11),
        runs: { bat: 0 },
      },
    });
    expect(taken(OPENING, event, READY)).toBe(true);
  });

  it('the over and the ball in it count legal balls only, from 0 and from 1', () => {
    const picks = { 'bowler.i1.1': [A(10)] };
    expect(payloadOf(eventOf(OVER_ONE_DONE, tapOf({}), picks))).toMatchObject({
      over: 1,
      ballInOver: 1,
      striker: H(2),
      nonStriker: H(1),
      bowler: A(10),
    });
    const wide = ball({
      over: 0,
      ballInOver: 1,
      striker: H(1),
      nonStriker: H(2),
      bowler: A(11),
      extras: { kind: 'wide', runs: 1 },
    });
    expect(payloadOf(eventOf([...OPENING, wide], tapOf({})))).toMatchObject({
      over: 0,
      ballInOver: 1,
    });
    const dot = ball({ over: 0, ballInOver: 1, striker: H(1), nonStriker: H(2), bowler: A(11) });
    expect(payloadOf(eventOf([...OPENING, dot, wide], tapOf({})))).toMatchObject({
      over: 0,
      ballInOver: 2,
    });
  });

  it('a wide with two run sends extras {kind: wide, runs: 3}', () => {
    const wide = tapOf({ extra: { kind: 'wide', runs: cricketPadRules.wideDefaultRuns + 2 } });
    const event = eventOf(OPENING, wide, READY);
    expect(payloadOf(event).runs).toStrictEqual({ bat: 0, extras: { kind: 'wide', runs: 3 } });
    expect(taken(OPENING, event, READY)).toBe(true);
  });

  // Preflight F13: the no-ball sheet's 4 and 6 off the bat are boundaries, as the web sends them (W7).
  it('a no-ball 4 off the bat sends bat 4, extras {noball, runs: 1} and boundary 4, and the same for a 6', () => {
    const noBall = { kind: 'noball', runs: cricketPadRules.noBallDefaultRuns } as const;
    const four = payloadOf(eventOf(OPENING, tapOf({ bat: 4, extra: noBall }), READY));
    expect(four.runs).toStrictEqual({ bat: 4, extras: { kind: 'noball', runs: 1 } });
    expect(four.boundary).toBe(4);
    const six = payloadOf(eventOf(OPENING, tapOf({ bat: 6, extra: noBall }), READY));
    expect(six.runs).toStrictEqual({ bat: 6, extras: { kind: 'noball', runs: 1 } });
    expect(six.boundary).toBe(6);
    const two = payloadOf(eventOf(OPENING, tapOf({ bat: 2, extra: noBall }), READY));
    expect(two).not.toHaveProperty('boundary');
  });

  // Ruling 73: the 4 and 6 keys are boundaries; More's all-run 4 or 6 is not.
  it('an all-run 4 carries no boundary; the 4 key does', () => {
    const allRun = payloadOf(eventOf(OPENING, tapOf({ bat: 4 }), READY));
    expect(allRun.runs).toStrictEqual({ bat: 4 });
    expect(allRun).not.toHaveProperty('boundary');
    const key = payloadOf(eventOf(OPENING, tapOf({ bat: 6, boundary: 6 }), READY));
    expect(key.runs).toStrictEqual({ bat: 6 });
    expect(key.boundary).toBe(6);
  });

  // §4.2: a penalty is the ball's one extra, on a fair ball, with the runs off the bat; the engine counts the ball legal.
  it('penalty rides a fair ball only', () => {
    const penalty = tapOf({
      bat: 1,
      extra: { kind: 'penalty', runs: cricketPadRules.penaltyRuns },
    });
    const event = eventOf(OPENING, penalty, READY);
    expect(payloadOf(event).runs).toStrictEqual({ bat: 1, extras: { kind: 'penalty', runs: 5 } });
    expect(taken(OPENING, event, READY)).toBe(true);
    const after = [...OPENING, { type: 'cricket.ball', payload: payloadOf(event) }];
    expect(payloadOf(eventOf(after, tapOf({}), READY))).toMatchObject({ over: 0, ballInOver: 2 });
  });

  it('freeHit is never sent, on the free hit itself either', () => {
    const noBall = ball({
      over: 0,
      ballInOver: 1,
      striker: H(1),
      nonStriker: H(2),
      bowler: A(11),
      extras: { kind: 'noball', runs: 1 },
    });
    const specs = [...OPENING, noBall];
    expect(displayOf(specs, NO_PICKS).freeHit).toBe(true);
    const event = eventOf(specs, tapOf({ bat: 1 }));
    expect(payloadOf(event)).not.toHaveProperty('freeHit');
    expect(taken(specs, event, NO_PICKS)).toBe(true);
  });

  // Preflight F6, rulings 76 and 84: the swap is the pair reversed on the next ball, and gone once that ball is bowled.
  it('a swap pick reverses the pair on the next ball only', () => {
    const dot = ball({ over: 0, ballInOver: 1, striker: H(1), nonStriker: H(2), bowler: A(11) });
    const specs = [...OPENING, dot];
    const picks = { 'swap.i1.1': [H(2), H(1)] };
    const swapped = eventOf(specs, tapOf({ bat: 1 }), picks);
    expect(payloadOf(swapped)).toMatchObject({ ballInOver: 2, striker: H(2), nonStriker: H(1) });
    expect(taken(specs, swapped, picks)).toBe(true);
    const next = [...specs, { type: 'cricket.ball', payload: payloadOf(swapped) }];
    expect(payloadOf(eventOf(next, tapOf({}), picks))).toMatchObject({
      ballInOver: 3,
      striker: H(1),
      nonStriker: H(2),
    });
  });

  // The controller's ruling (Batch 2 fix round 1): a swap is keyed to the innings' deliveries, legal and illegal, so the
  // delivery after it, whatever it is, uses it up. Each delivery below has one run run, so the batters cross: the ball
  // after it is the fold's pair, H-p1 on strike, and never the swap again (a legal-ball key reversed it twice).
  it.each([
    ['a wide with one run run', { extra: { kind: 'wide', runs: 2 } }],
    ['a no-ball with 1 off the bat', { bat: 1, extra: { kind: 'noball', runs: 1 } }],
    ['a legal single', { bat: 1 }],
  ] as const)('a swap, then %s: the next ball is reversed once only', (_, delivery) => {
    const dot = ball({ over: 0, ballInOver: 1, striker: H(1), nonStriker: H(2), bowler: A(11) });
    const specs = [...OPENING, dot];
    const picks = { 'swap.i1.1': [H(2), H(1)] };
    const swapped = eventOf(specs, tapOf(delivery), picks);
    expect(payloadOf(swapped)).toMatchObject({ striker: H(2), nonStriker: H(1) });
    expect(taken(specs, swapped, picks)).toBe(true);
    const next = [...specs, { type: 'cricket.ball', payload: payloadOf(swapped) }];
    expect(displayOf(next, picks).deliveries).toBe(2);
    expect(payloadOf(eventOf(next, tapOf({}), picks))).toMatchObject({
      striker: H(1),
      nonStriker: H(2),
    });
  });

  it('a ball is no event while the openers or the bowler are not known', () => {
    expect(eventOf([], tapOf({}))).toBeNull();
    expect(eventOf(OPENING, tapOf({}))).toBeNull();
    expect(eventOf(OPENING, tapOf({}), { 'openers.i1': [H(1), H(2)] })).toBeNull();
    expect(eventOf(OVER_ONE_DONE, tapOf({}))).toBeNull();
  });
});

describe('a wicket', () => {
  // §4.3: the engine refuses a bowlerCredited that does not match the kind, so the pad never asks.
  it('bowlerCredited is false for a run out and true for bowled', () => {
    const bowled = payloadOf(
      eventOf(
        OPENING,
        tapOf({ wicket: out({ kind: 'bowled', out: H(1), incoming: H(3) }) }),
        READY,
      ),
    );
    expect(bowled.wicket).toStrictEqual({
      kind: 'bowled',
      out: H(1),
      incoming: H(3),
      bowlerCredited: true,
    });
    const runOut = out({
      kind: 'runout',
      out: H(2),
      fielder: A(4),
      fielderAssist: A(2),
      incoming: H(3),
    });
    const event = eventOf(OPENING, tapOf({ bat: 1, wicket: runOut }), READY);
    expect(payloadOf(event).wicket).toStrictEqual({
      kind: 'runout',
      out: H(2),
      fielder: A(4),
      fielderAssist: A(2),
      incoming: H(3),
      bowlerCredited: false,
    });
    expect(taken(OPENING, event, READY)).toBe(true);
  });

  it('a caught names its fielder, and a wicket with no batter picked to come in names none', () => {
    const caught = payloadOf(
      eventOf(OPENING, tapOf({ wicket: out({ kind: 'caught', out: H(1), fielder: A(5) }) }), READY),
    );
    expect(caught.wicket).toStrictEqual({
      kind: 'caught',
      out: H(1),
      fielder: A(5),
      bowlerCredited: true,
    });
  });

  it('the incoming batter is sent on a main-innings wicket, the phone’s order and not the sheet’s', () => {
    const event = eventOf(
      OPENING,
      tapOf({ wicket: out({ kind: 'lbw', out: H(1), incoming: H(7) }) }),
      READY,
    );
    expect(payloadOf(event).wicket).toMatchObject({ incoming: H(7) });
    expect(taken(OPENING, event, READY)).toBe(true);
    const next = [...OPENING, { type: 'cricket.ball', payload: payloadOf(event) }];
    expect(payloadOf(eventOf(next, tapOf({}), READY))).toMatchObject({
      striker: H(7),
      nonStriker: H(2),
    });
  });

  // §4.6: in a super over `wicket.incoming` is ignored, and the next ball names the replacement at the empty end.
  it('a super over’s second batter rides the next ball, not incoming', () => {
    const picks = { 'openers.s1': [A(1), A(2)], 'bowler.s1.0': [H(11)] };
    const first = eventOf(
      TIED_KO,
      tapOf({ wicket: out({ kind: 'bowled', out: A(1), incoming: A(3) }) }),
      picks,
    );
    expect(first?.type).toBe('cricket.superover.ball');
    expect(payloadOf(first)).toMatchObject({
      over: 0,
      ballInOver: 1,
      striker: A(1),
      nonStriker: A(2),
      bowler: H(11),
    });
    expect(payloadOf(first).wicket).toStrictEqual({
      kind: 'bowled',
      out: A(1),
      bowlerCredited: true,
    });
    expect(taken(TIED_KO, first, picks)).toBe(true);
    const after = [...TIED_KO, { type: 'cricket.superover.ball', payload: payloadOf(first) }];
    expect(eventOf(after, tapOf({}), picks)).toBeNull();
    const withIncoming = { ...picks, 'incoming.s1': [A(3)] };
    const second = eventOf(after, tapOf({ bat: 1 }), withIncoming);
    expect(second?.type).toBe('cricket.superover.ball');
    expect(payloadOf(second)).toMatchObject({
      ballInOver: 2,
      striker: A(3),
      nonStriker: A(2),
      bowler: H(11),
    });
    expect(taken(after, second, withIncoming)).toBe(true);
  });
});

describe('the other taps', () => {
  it('over totals are the innings’ running totals, partial', () => {
    const tap: CricketTap = { kind: 'summary', runs: 14, wickets: 1, legalBalls: 12 };
    expect(eventOf(OPENING, tap)).toStrictEqual({
      type: 'cricket.innings.summary',
      payload: { runs: 14, wickets: 1, legalBalls: 12, partial: true },
    });
  });

  it('a retirement names the incoming batter only when one is chosen', () => {
    expect(
      eventOf(OPENING, { kind: 'retire', person: H(1), reason: 'hurt', incoming: H(4) }),
    ).toStrictEqual({
      type: 'cricket.retire',
      payload: { person: H(1), reason: 'hurt', incoming: H(4) },
    });
    expect(
      eventOf(OPENING, { kind: 'retire', person: H(1), reason: 'out', incoming: null }),
    ).toStrictEqual({
      type: 'cricket.retire',
      payload: { person: H(1), reason: 'out' },
    });
  });

  it('a change of bowler names the reason only when one is said', () => {
    expect(
      eventOf(OPENING, { kind: 'bowlerChange', bowler: A(9), reason: 'incapacitated' }),
    ).toStrictEqual({
      type: 'cricket.bowler.change',
      payload: { bowler: A(9), reason: 'incapacitated' },
    });
    expect(eventOf(OPENING, { kind: 'bowlerChange', bowler: A(9), reason: null })).toStrictEqual({
      type: 'cricket.bowler.change',
      payload: { bowler: A(9) },
    });
  });

  it('a More item is its own type with the engine’s payload', () => {
    const tap: CricketTap = {
      kind: 'more',
      type: 'cricket.innings.close',
      payload: { reason: 'weather' },
    };
    expect(eventOf(OPENING, tap)).toStrictEqual({
      type: 'cricket.innings.close',
      payload: { reason: 'weather' },
    });
  });
});

describe('what is never sent', () => {
  /** One tap of every kind; the record's type makes a new kind fail to compile here until it is swept. */
  const EVERY_KIND: Record<CricketTap['kind'], CricketTap> = {
    toss: { kind: 'toss', wonBy: 'first', elected: 'bat' },
    start: { kind: 'start' },
    ball: tapOf({ bat: 4, boundary: 4 }),
    summary: { kind: 'summary', runs: 4, wickets: 0, legalBalls: 6 },
    retire: { kind: 'retire', person: H(1), reason: 'hurt', incoming: null },
    more: { kind: 'more', type: 'cricket.newball', payload: {} },
    bowlerChange: { kind: 'bowlerChange', bowler: A(10), reason: null },
  };

  // Preflight D5: the sweep counts what it swept, so an empty sweep fails rather than passes.
  it('never core.forfeit, core.settle or core.abandon, nor a freeHit, from any tap', () => {
    let swept = 0;
    for (const tap of Object.values(EVERY_KIND)) {
      const event = eventOf(OPENING, tap, READY);
      expect(event).not.toBeNull();
      expect(['core.forfeit', 'core.settle', 'core.abandon']).not.toContain(event?.type);
      expect(event?.payload).not.toHaveProperty('freeHit');
      swept += 1;
    }
    expect(swept).toBe(7);
  });

  // Review Focus 1: a resend is what was queued; a ball a co-scorer took first is dropped by the fold, never moved on.
  it('payloadForSend never moves over or ballInOver', () => {
    const queued = queuedOf(
      'q-1',
      ball({ over: 0, ballInOver: 2, striker: H(1), nonStriker: H(2), bowler: A(11) }),
    );
    const ledger = ledgerOf(OVER_ONE_DONE);
    expect(cricketPayloadForSend(queued, ledger, false)).toBe(queued.payload);
    expect(cricketPayloadForSend(queued, ledger, true)).toBe(queued.payload);
    expect(cricketPayloadForSend(queued, [], false)).toMatchObject({ over: 0, ballInOver: 2 });
  });
});
