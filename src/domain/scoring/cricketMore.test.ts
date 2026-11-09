import { cricket, type CricketState } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { ballEventOf } from '@/domain/scoring/cricketEvents';
import { entryStep, entryTap } from '@/domain/scoring/cricketEntry';
import {
  flowChoice,
  flowStep,
  moreFlow,
  standingFlow,
  type CricketFlow,
} from '@/domain/scoring/cricketFlow';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { cricketMoreItems, moreStep } from '@/domain/scoring/cricketMore';
import type { CricketDisplay, CricketTap } from '@/domain/scoring/cricketTypes';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY_BOWLERS,
  DOT,
  FOUR,
  HOME_BOWLERS,
  LEAGUE_2,
  MATCH,
  ONE,
  OPENING,
  OUT,
  TIED_KO,
  TWO_INNINGS,
  declare,
  entrant,
  inningsOf,
  ledgerOf,
  player,
  superOverOf,
  times,
  toss,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// More (S2-4 spec §4.8, amended by preflight F20; ruling 79; plan Task 15): each row shown only when the engine would take
// it now, read from the fold and the format, and each row's steps to the event it records. Expected lists are the
// spec's table; the events' shapes are the engine's schemas.

function displayOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = MATCH,
  picks: PendingPicks = NO_PICKS,
): CricketDisplay {
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

/** Nine bowlers' overs a side for an unlimited innings: A-p11 and A-p10 in turn. */
const ALTERNATE = Array.from({ length: 20 }, (_, over) => (over % 2 === 0 ? A(11) : A(10)));

/** A one-innings knockout (two overs a side), two balls into the first over: H-p2 on strike after the single. */
const MID: readonly Spec[] = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, DOT])];
/** Two innings a side, unlimited overs, the same two balls. */
const TWO = withCfg(MATCH, TWO_INNINGS);

const items = (display: CricketDisplay) => cricketMoreItems(display);

/** Choose `ids` in turn from `flow`, each on the step the last one led to; the outcome of the last. */
function chosen(display: CricketDisplay, flow: CricketFlow, ids: readonly string[]) {
  let now = flow;
  for (const id of ids.slice(0, -1)) {
    const outcome = flowChoice(now, display, id);
    if (outcome?.kind !== 'next')
      throw new Error(`${id} did not lead on: ${JSON.stringify(outcome)}`);
    now = outcome.flow;
  }
  return { flow: now, outcome: flowChoice(now, display, ids.at(-1) ?? '') };
}

const tapOf = (display: CricketDisplay, ids: readonly string[]): CricketTap | null => {
  const { outcome } = chosen(display, moreFlow(), ids);
  return outcome?.kind === 'tap' ? outcome.tap : null;
};

describe('which rows More shows (§4.8)', () => {
  it('mid-innings in a one-innings limited match: Other runs first, then the rest the engine takes now', () => {
    expect(items(displayOf(MID))).toEqual([
      'otherRuns',
      'swapStrike',
      'changeBowler',
      'retire',
      'review',
      'newBall',
      'powerplay',
      'interruption',
      'revise',
      'close',
    ]);
  });

  it('mid-innings in two innings a side: Declare and the draw, no powerplay (no quota), no Revise', () => {
    expect(items(displayOf(MID, TWO))).toEqual([
      'otherRuns',
      'swapStrike',
      'changeBowler',
      'retire',
      'review',
      'newBall',
      'interruption',
      'declare',
      'close',
      'matchClose',
    ]);
  });

  it('Declare is hidden in a one-innings match', () => {
    expect(items(displayOf(MID))).not.toContain('declare');
  });

  it('Revise is hidden in two innings, and with no quota', () => {
    expect(items(displayOf(MID, TWO))).not.toContain('revise');
    const unlimited = withCfg(MATCH, { ballsPerInnings: null, minOversForResult: 0 });
    expect(items(displayOf(MID, unlimited))).not.toContain('revise');
    expect(items(displayOf(MID, unlimited))).not.toContain('powerplay');
  });

  it('Revise is hidden in two innings a side even with an overs limit (the engine refuses it), where a powerplay is not', () => {
    const limited = displayOf(MID, withCfg(MATCH, { ...TWO_INNINGS, ballsPerInnings: 120 }));
    expect(limited.state.quota).toBe(120);
    expect(items(limited)).not.toContain('revise');
    expect(items(limited)).toContain('powerplay');
  });

  it('More is empty in a super over', () => {
    const superOver = displayOf([...TIED_KO, ...superOverOf('A', H(11), [DOT, ONE])]);
    expect(superOver.innings?.superOver).toBe(true);
    expect(items(superOver)).toEqual([]);
    expect(moreStep(superOver).options).toEqual([]);
  });

  // Batch 4 fix round, concern 2 (carried to Task 18): the standing over-end sheet is the only sheet that shows More beside
  // Players, and no point of a super over stands it. Its bowler is the break card's pick (so the sheet's "no bowler" is
  // never the case once the innings is live), and its one over ends the innings. So the sheet's More has no super-over case
  // to be shown or pressed: not before the first ball, mid-over, or after the sixth.
  it('no point of a super over stands the over-end sheet, so its More never has a super over to show in', () => {
    const picks = {
      'openers.s1': [A(1), A(2)],
      'bowler.s1.0': [H(11)],
      'begin.s1': ['second'],
      'openers.s2': [H(1), H(2)],
      'bowler.s2.0': [A(11)],
      'begin.s2': ['first'],
    };
    const balls = [
      ...superOverOf('A', H(11), times(6, DOT)),
      ...superOverOf('H', A(11), times(6, DOT)),
    ];
    const prefixes = Array.from({ length: balls.length + 1 }, (_, n) => [
      ...TIED_KO,
      ...balls.slice(0, n),
    ]);
    const stages = prefixes.map((specs) => {
      const display = displayOf(specs, MATCH, picks);
      return [display.stage, display.needs, standingFlow(display)];
    });
    expect(stages).toHaveLength(13);
    // The picks make both innings live: the sheet is absent because nothing is due, not because the innings is waiting.
    expect(stages.filter(([stage]) => stage === 'live').length).toBeGreaterThan(8);
    expect(stages.every(([, , standing]) => standing === null)).toBe(true);
    // Control: the same sheet does stand in a main innings, at an over's end with no bowler picked.
    const mainOverEnd = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(6, DOT))]);
    expect(standingFlow(mainOverEnd)).toEqual({ kind: 'bowler' });
  });

  it('before an innings’ first ball, only what needs no innings open: a ball, the swap, rain, a revision', () => {
    const picks = { 'openers.i1': [H(1), H(2)], 'bowler.i1.0': [A(11)] };
    const before = displayOf(OPENING, MATCH, picks);
    expect([before.stage, before.needs, before.deliveries]).toEqual(['live', null, 0]);
    expect(items(before)).toEqual(['otherRuns', 'swapStrike', 'interruption', 'revise']);
  });

  it('at an over’s end with no bowler picked: no other runs (no bowler), no change', () => {
    const end = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(6, DOT))]);
    expect(end.needs).toBe('bowler');
    expect(items(end)).not.toContain('otherRuns');
    expect(items(end)).not.toContain('changeBowler');
    expect(items(end)).toContain('retire');
  });

  it('once the match is decided, nothing', () => {
    const tied = displayOf(TIED_KO, withCfg(MATCH, LEAGUE_2));
    expect(tied.stage).toBe('decided');
    expect(items(tied)).toEqual([]);
  });

  it('a new ball once at a point of the innings: again a ball later', () => {
    const newBall: Spec = { type: 'cricket.newball', payload: {} };
    const taken = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, DOT]), newBall];
    expect(items(displayOf(taken))).not.toContain('newBall');
    const balls = inningsOf('H', AWAY_BOWLERS, [ONE, DOT, DOT]);
    const later = [...OPENING, ...balls.slice(0, 2), newBall, ...balls.slice(2)];
    expect(items(displayOf(later))).toContain('newBall');
  });

  it('the follow-on: never with it off, never while the second innings is open, never once the third has begun', () => {
    const big = [...OPENING, ...inningsOf('H', ALTERNATE, times(54, FOUR)), declare()];
    const allOut = inningsOf('A', HOME_BOWLERS, times(10, OUT));
    const off = withCfg(MATCH, { ...TWO_INNINGS, followOn: { enabled: false, lead: 200 } });
    expect(items(displayOf([...big, ...allOut], off))).not.toContain('followOn');
    expect(items(displayOf([...big, ...allOut.slice(0, 3)], TWO))).not.toContain('followOn');
    const third = displayOf([...big, ...allOut, ...inningsOf('H', AWAY_BOWLERS, [DOT])], TWO);
    expect(third.innings?.ordinal).toBe('i3');
    expect(items(third)).not.toContain('followOn');
  });

  it('the follow-on at a lead of exactly the format’s, and not once the match is over', () => {
    const exact = [...OPENING, ...inningsOf('H', ALTERNATE, times(50, FOUR)), declare()];
    const allOut = inningsOf('A', HOME_BOWLERS, times(10, OUT));
    expect(items(displayOf([...exact, ...allOut], TWO))).toContain('followOn');
    const abandoned: Spec = { type: 'core.abandon', payload: { reason: 'rain' } };
    const over = displayOf([...exact, ...allOut, abandoned], TWO);
    expect(over.state.phase).not.toBe('live');
    expect(items(over)).toEqual([]);
  });

  it('a powerplay ended: start another', () => {
    const start: Spec = { type: 'cricket.powerplay', payload: { kind: 'batting', phase: 'start' } };
    const end: Spec = { type: 'cricket.powerplay', payload: { kind: 'batting', phase: 'end' } };
    const display = displayOf([...MID, start, end]);
    expect(moreStep(display).options.find((one) => one.id === 'powerplay')?.label).toEqual({
      key: 'scoring.cricket.more.powerplay',
    });
  });

  it('a powerplay: start one, then end the one open', () => {
    const open: Spec = { type: 'cricket.powerplay', payload: { kind: 'batting', phase: 'start' } };
    const display = displayOf([...MID, open]);
    expect(moreStep(display).options.find((one) => one.id === 'powerplay')?.label).toEqual({
      key: 'scoring.cricket.more.powerplayEnd',
    });
    expect(tapOf(display, ['powerplay', 'end'])).toEqual({
      kind: 'more',
      type: 'cricket.powerplay',
      payload: { kind: 'batting', phase: 'end' },
    });
    expect(tapOf(displayOf(MID), ['powerplay', 'mandatory'])).toEqual({
      kind: 'more',
      type: 'cricket.powerplay',
      payload: { kind: 'mandatory', phase: 'start' },
    });
  });

  it('the follow-on: between the second and third innings with the lead, never without it', () => {
    const big = [...OPENING, ...inningsOf('H', ALTERNATE, times(54, FOUR)), declare()];
    const followed = displayOf([...big, ...inningsOf('A', HOME_BOWLERS, times(10, OUT))], TWO);
    expect(items(followed)).toContain('followOn');
    expect(tapOf(followed, ['followOn', 'do'])).toEqual({
      kind: 'more',
      type: 'cricket.followon',
      payload: {},
    });
    const short = [...OPENING, ...inningsOf('H', ALTERNATE, times(40, FOUR)), declare()];
    const shy = displayOf([...short, ...inningsOf('A', HOME_BOWLERS, times(10, OUT))], TWO);
    expect(items(shy)).not.toContain('followOn');
    expect(items(displayOf(big, TWO))).not.toContain('followOn');
  });

  it('the setup screen has no More (F20): before Start, nothing, rain and a revision included', () => {
    const before = displayOf([toss('H', 'bat')]);
    expect(before.stage).toBe('setup');
    expect(items(before)).toEqual([]);
    const twoBefore = displayOf([toss('H', 'bat')], TWO);
    expect(twoBefore.stage).toBe('setup');
    expect(items(twoBefore)).toEqual([]);
  });

  it('in two innings, Declare and Close wait for an innings under way; the draw does not', () => {
    const picks = { 'openers.i1': [H(1), H(2)], 'bowler.i1.0': [A(11)] };
    const before = displayOf(OPENING, TWO, picks);
    expect([before.stage, before.needs]).toEqual(['live', null]);
    expect(items(before)).toEqual(['otherRuns', 'swapStrike', 'interruption', 'matchClose']);
  });

  it('a choice More does not show does nothing', () => {
    expect(flowChoice(moreFlow(), displayOf(MID), 'declare')).toBeNull();
    expect(flowChoice(moreFlow(), displayOf(MID, TWO), 'revise')).toBeNull();
  });
});

describe('Other runs and penalty (ruling 79)', () => {
  it('5 and 7 are runs off the bat; ran 4 and ran 6 carry no boundary', () => {
    const display = displayOf(MID);
    const ball = (bat: number) => ({
      kind: 'ball',
      ball: { bat, extra: null, boundary: null, wicket: null },
    });
    expect(tapOf(display, ['otherRuns', 'bat.5'])).toEqual(ball(5));
    expect(tapOf(display, ['otherRuns', 'bat.7'])).toEqual(ball(7));
    expect(tapOf(display, ['otherRuns', 'ran.4'])).toEqual(ball(4));
    expect(tapOf(display, ['otherRuns', 'ran.6'])).toEqual(ball(6));
  });

  it('+5 penalty with a 4 off the bat: a boundary, as the 4 key is', () => {
    expect(tapOf(displayOf(MID), ['otherRuns', 'penalty', 'bat.4'])).toEqual({
      kind: 'ball',
      ball: { bat: 4, extra: { kind: 'penalty', runs: 5 }, boundary: 4, wicket: null },
    });
  });

  it('+5 penalty asks the runs off the bat, then records a fair ball with five penalty runs', () => {
    const display = displayOf(MID);
    const { flow } = chosen(display, moreFlow(), ['otherRuns', 'penalty', 'bat.1']);
    expect(flowStep(flow, display).options.map((one) => one.id)).toEqual(
      [0, 1, 2, 3, 4, 6].map((runs) => `bat.${runs}`),
    );
    const tap = tapOf(display, ['otherRuns', 'penalty', 'bat.1']);
    expect(tap).toEqual({
      kind: 'ball',
      ball: { bat: 1, extra: { kind: 'penalty', runs: 5 }, boundary: null, wicket: null },
    });
    if (tap?.kind !== 'ball') throw new Error('no ball');
    const event = ballEventOf(tap.ball, display);
    if (event === null) throw new Error('no event');
    const after = displayOf([...MID, { type: event.type, payload: event.payload }]);
    expect([after.deliveries, after.innings?.legalBalls, after.innings?.runs]).toEqual([3, 3, 7]);
  });
});

describe('the rows’ steps', () => {
  it('Retire records cricket.retire with the incoming batter: who, why, then who walks in', () => {
    const display = displayOf(MID);
    expect(display.crease?.striker.id).toBe(H(2));
    expect(tapOf(display, ['retire', H(2), 'hurt', H(3)])).toEqual({
      kind: 'retire',
      person: H(2),
      reason: 'hurt',
      incoming: H(3),
    });
    const { flow } = chosen(display, moreFlow(), ['retire', H(2), 'hurt', H(3)]);
    const incoming = flowStep(flow, display);
    expect(incoming.options[0]).toMatchObject({ id: H(3), chosen: true });
    expect(incoming.options.map((one) => one.id)).not.toContain(H(2));
  });

  it('Retire asks who first: the two at the crease, the striker first and said so, then the non-striker', () => {
    const display = displayOf(MID);
    const { flow } = chosen(display, moreFlow(), ['retire', H(2)]);
    expect(flowStep(flow, display).options.map((one) => [one.id, one.note])).toEqual([
      [H(2), { key: 'scoring.cricket.board.onStrike' }],
      [H(1), { key: 'scoring.cricket.wicket.nonStriker' }],
    ]);
  });

  it('Retired out as the last wicket: nobody walks in, so it records at once with no incoming', () => {
    const nine = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(9, OUT))]);
    expect(nine.innings?.wickets).toBe(9);
    const striker = nine.crease?.striker.id ?? '';
    expect(tapOf(nine, ['retire', striker, 'out'])).toEqual({
      kind: 'retire',
      person: striker,
      reason: 'out',
      incoming: null,
    });
  });

  it('Retired hurt with nobody left to walk in is greyed, with why: the engine refuses it ("batting order exhausted")', () => {
    const nine = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(9, OUT))]);
    const striker = nine.crease?.striker.id ?? '';
    const { flow } = chosen(nine, moreFlow(), ['retire', striker, 'hurt']);
    const reasons = flowStep(flow, nine).options;
    expect(reasons.map((one) => [one.id, one.disabled === true])).toEqual([
      ['hurt', true],
      ['out', false],
      ['other', true],
    ]);
    expect(reasons[0]?.note).toEqual({ key: 'scoring.cricket.retire.nobody' });
    const refused = { type: 'cricket.retire', payload: { person: striker, reason: 'hurt' } };
    expect(() => applied(nine, { kind: 'more', ...refused } as CricketTap)).toThrow(/exhausted/);
    expect(flowChoice(flow, nine, 'hurt')).toBeNull();
    const withOne = displayOf(MID);
    const { flow: open } = chosen(withOne, moreFlow(), ['retire', H(2), 'hurt']);
    expect(flowStep(open, withOne).options.every((one) => one.disabled !== true)).toBe(true);
  });

  it('a choice a row’s step does not offer does nothing: Close the innings has no "all out" (the engine’s own)', () => {
    const flow: CricketFlow = { kind: 'moreRow', row: { kind: 'close' } };
    expect(flowChoice(flow, displayOf(MID), 'all_out')).toBeNull();
  });

  it('what ends an innings or the match reads as such; the rest as a plain row', () => {
    const tones = (display: CricketDisplay) =>
      moreStep(display)
        .options.filter((one) => one.tone === 'destructive')
        .map((one) => one.id);
    expect(tones(displayOf(MID, TWO))).toEqual(['declare', 'close', 'matchClose']);
    const toneOf = (item: 'declare' | 'newBall' | 'followOn' | 'matchClose') =>
      flowStep({ kind: 'moreRow', row: { kind: 'confirm', item } }, displayOf(MID, TWO)).options[0]
        ?.tone;
    expect(toneOf('declare')).toBe('destructive');
    expect(toneOf('matchClose')).toBe('destructive');
    expect(toneOf('newBall')).toBe('standard');
    expect(toneOf('followOn')).toBe('standard');
  });

  it('Close the innings asks why: time, weather or other', () => {
    const display = displayOf(MID);
    const { flow } = chosen(display, moreFlow(), ['close', 'time']);
    expect(flowStep(flow, display).options.map((one) => one.id)).toEqual([
      'time',
      'weather',
      'other',
    ]);
    expect(tapOf(display, ['close', 'weather'])).toEqual({
      kind: 'more',
      type: 'cricket.innings.close',
      payload: { reason: 'weather' },
    });
  });

  it('Declare, the new ball and the draw each ask once', () => {
    const two = displayOf(MID, TWO);
    expect(tapOf(two, ['declare', 'do'])).toEqual({
      kind: 'more',
      type: 'cricket.innings.declare',
      payload: {},
    });
    expect(tapOf(two, ['matchClose', 'do'])).toEqual({
      kind: 'more',
      type: 'cricket.match.close',
      payload: {},
    });
    expect(tapOf(displayOf(MID), ['newBall', 'do'])).toEqual({
      kind: 'more',
      type: 'cricket.newball',
      payload: {},
    });
  });

  it('a review: by which side, which kind, the outcome; a player review greyed once a side has none left', () => {
    const two = displayOf(MID, TWO);
    expect(tapOf(two, ['review', 'away', 'player', 'struck_down'])).toEqual({
      kind: 'more',
      type: 'cricket.review',
      payload: { by: entrant('A'), kind: 'player', outcome: 'struck_down' },
    });
    const lost: Spec = {
      type: 'cricket.review',
      payload: { by: entrant('A'), kind: 'player', outcome: 'struck_down' },
    };
    const spent = displayOf([...MID, lost, lost], TWO);
    const { flow } = chosen(spent, moreFlow(), ['review', 'away', 'player']);
    expect(flowStep(flow, spent).options.find((one) => one.id === 'player')).toMatchObject({
      disabled: true,
      note: { key: 'scoring.cricket.review.noneLeft' },
    });
    expect(chosen(spent, moreFlow(), ['review', 'away', 'player']).outcome).toBeNull();
    expect(tapOf(spent, ['review', 'away', 'umpire', 'upheld'])).toMatchObject({
      payload: { by: entrant('A'), kind: 'umpire', outcome: 'upheld' },
    });
  });

  it('Rain or bad light asks the kind, then the overs lost, entered: none, or a whole number', () => {
    const display = displayOf(MID);
    const { outcome } = chosen(display, moreFlow(), ['interruption', 'rain']);
    expect(outcome).toEqual({ kind: 'entry', entry: { kind: 'oversLost', interruption: 'rain' } });
    const entry = { kind: 'oversLost', interruption: 'rain' } as const;
    expect(entryStep(entry, display).fields.map((one) => one.initial)).toEqual(['']);
    expect(entryTap(entry, display, [''])).toEqual({
      kind: 'more',
      type: 'cricket.interruption',
      payload: { kind: 'rain' },
    });
    expect(entryTap(entry, display, ['3'])).toEqual({
      kind: 'more',
      type: 'cricket.interruption',
      payload: { kind: 'rain', oversLostEstimate: 3 },
    });
    expect(entryTap(entry, display, ['3.5'])).toBeNull();
  });

  it('Revised overs or target: entered, never computed; at least one, and the overs a change', () => {
    const display = displayOf(MID);
    expect(flowChoice(moreFlow(), display, 'revise')).toEqual({
      kind: 'entry',
      entry: { kind: 'revise' },
    });
    const revise = { kind: 'revise' } as const;
    expect(entryStep(revise, display).fields.map((one) => one.initial)).toEqual(['2', '']);
    const tap = (payload: object) => ({ kind: 'more', type: 'cricket.revise', payload });
    expect(entryTap(revise, display, ['1', ''])).toEqual(tap({ oversPerSide: 1 }));
    expect(entryTap(revise, display, ['2', '41'])).toEqual(tap({ target: 41 }));
    expect(entryTap(revise, display, ['1', '41'])).toEqual(tap({ oversPerSide: 1, target: 41 }));
    expect(entryTap(revise, display, ['2', ''])).toBeNull();
    expect(entryTap(revise, display, ['0', ''])).toBeNull();
    expect(entryTap(revise, display, ['', '0'])).toBeNull();
    expect(entryTap(revise, display, ['', ''])).toBeNull();
    expect(entryTap(revise, display, ['1.5', ''])).toBeNull();
  });

  it('Revised overs: a target that is no whole number is refused; no overs of nought, even before a ball', () => {
    const revise = { kind: 'revise' } as const;
    expect(entryTap(revise, displayOf(MID), ['', '4.1'])).toBeNull();
    const picks = { 'openers.i1': [H(1), H(2)], 'bowler.i1.0': [A(11)] };
    const before = displayOf(OPENING, MATCH, picks);
    expect(before.deliveries).toBe(0);
    expect(entryTap(revise, before, ['0', ''])).toBeNull();
  });

  it('Revised overs at exactly the balls bowled are the engine’s to take', () => {
    const six = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(6, DOT))]);
    expect(six.innings?.legalBalls).toBe(6);
    expect(entryTap({ kind: 'revise' }, six, ['1', ''])).toEqual({
      kind: 'more',
      type: 'cricket.revise',
      payload: { oversPerSide: 1 },
    });
  });

  it('a quota that is no whole number of overs leaves the overs field empty', () => {
    const odd = withCfg(MATCH, { ...LEAGUE_2, ballsPerInnings: 15 });
    expect(entryStep({ kind: 'revise' }, displayOf(MID, odd)).fields[0]?.initial).toBe('');
  });

  it('Revised overs below the balls already bowled are refused before the server sees them', () => {
    const seven = displayOf([...OPENING, ...inningsOf('H', AWAY_BOWLERS, times(7, DOT))]);
    expect(seven.innings?.legalBalls).toBe(7);
    const revise = { kind: 'revise' } as const;
    expect(entryTap(revise, seven, ['1', ''])).toBeNull();
    expect(entryTap(revise, seven, ['1', '30'])).toBeNull();
    expect(entryTap(revise, displayOf(MID), ['1', ''])).not.toBeNull();
  });
});

/** The engine's own verdict on a row's event, strictly, as the server's fold: it throws on what it refuses. */
function applied(display: CricketDisplay, tap: CricketTap | null): CricketState {
  if (tap?.kind !== 'more') throw new Error(`not a row's event: ${JSON.stringify(tap)}`);
  const envelope = {
    id: 'more-trial',
    fixtureId: '',
    seq: Number.MAX_SAFE_INTEGER,
    type: tap.type,
    payload: tap.payload,
    recordedAt: new Date(0).toISOString(),
    recordedBy: null,
  } as Parameters<typeof cricket.apply>[1];
  return cricket.apply(display.state, envelope, { strict: true });
}

describe('the engine takes what each row records', () => {
  const mid = displayOf(MID);
  const two = displayOf(MID, TWO);

  it('Close the innings: closed', () => {
    const after = applied(mid, tapOf(mid, ['close', 'time']));
    expect(after.innings[0]?.closed).toBe(true);
  });

  it('Declare: declared and closed', () => {
    const after = applied(two, tapOf(two, ['declare', 'do']));
    expect([after.innings[0]?.declared, after.innings[0]?.closed]).toEqual([true, true]);
  });

  it('the draw: the match is over', () => {
    const after = applied(two, tapOf(two, ['matchClose', 'do']));
    expect(after.phase).not.toBe('live');
  });

  it('New ball: marked at this ball', () => {
    const after = applied(mid, tapOf(mid, ['newBall', 'do']));
    expect(after.innings[0]?.newBallAt).toEqual([2]);
  });

  it('a powerplay started, then ended', () => {
    const started = applied(mid, tapOf(mid, ['powerplay', 'batting']));
    expect(started.innings[0]?.powerplays).toEqual([
      { kind: 'batting', fromBalls: 2, toBalls: null },
    ]);
    const open: Spec = { type: 'cricket.powerplay', payload: { kind: 'batting', phase: 'start' } };
    const running = displayOf([...MID, open]);
    const ended = applied(running, tapOf(running, ['powerplay', 'end']));
    expect(ended.innings[0]?.powerplays?.[0]?.toBalls).toBe(2);
  });

  it('a review, by the side’s entrant', () => {
    const after = applied(two, tapOf(two, ['review', 'away', 'player', 'upheld']));
    expect(after.innings[0]?.reviews?.away.taken).toBe(1);
  });

  it('the follow-on: enforced', () => {
    const big = [...OPENING, ...inningsOf('H', ALTERNATE, times(54, FOUR)), declare()];
    const due = displayOf([...big, ...inningsOf('A', HOME_BOWLERS, times(10, OUT))], TWO);
    const after = applied(due, tapOf(due, ['followOn', 'do']));
    expect(after.followOnEnforced).toBe(true);
  });

  it('rain, with overs lost: counted', () => {
    const entry = { kind: 'oversLost', interruption: 'rain' } as const;
    expect(applied(mid, entryTap(entry, mid, ['3'])).interruptions).toBe(1);
  });

  it('a revision: the target and the overs as typed', () => {
    const after = applied(mid, entryTap({ kind: 'revise' }, mid, ['1', '41']));
    expect([after.quota, after.revisedTarget, after.targetSource]).toEqual([6, 41, 'manual']);
  });
});
