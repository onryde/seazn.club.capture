import { describe, expect, it } from 'vitest';
import { foldFootball } from '@/domain/scoring/footballFold';
import {
  footballChoose,
  footballOpen,
  footballStep,
  MORE_FLOW,
  type FootballFlow,
  type FootballMove,
} from '@/domain/scoring/footballSheet';
import type { FootballDisplay } from '@/domain/scoring/footballTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  at,
  card,
  clock,
  ledgerOf,
  MATCH,
  NO_SHEET,
  sinBin,
  start,
  type Spec,
} from '../../../test/footballLedger';

/**
 * Football's step sheets (S2-5 design §6.3–§6.6; plan P Task 11): what each step offers and what a choice records. Every
 * expected value is written out from the design, never computed by the code under test.
 */

const KICK_OFF: readonly Spec[] = [start(), clock(true, at('H1', 0))];
const STAMP = at('H1', 754);

function displayOf(specs: readonly Spec[], bootstrap: Bootstrap = MATCH): FootballDisplay {
  const fold = foldFootball({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (fold.kind !== 'folded') throw new Error(`unfoldable: ${fold.reason}`);
  return fold.display;
}

const LIVE = displayOf(KICK_OFF);

/** The flow a move shows; a test that expects a step fails here if the move did anything else. */
function flowOf(move: FootballMove): FootballFlow {
  if (move.kind !== 'flow') throw new Error(`expected a step, got ${move.kind}`);
  return move.flow;
}

/** Each choice in turn from `id`'s first step, on `display`: the moves made. */
function walk(id: string, choices: readonly string[], display: FootballDisplay = LIVE) {
  let move = footballOpen(id, display, STAMP);
  for (const choice of choices) move = footballChoose(flowOf(move), choice, display, STAMP);
  return move;
}

const ids = (current: FootballFlow, display: FootballDisplay = LIVE) =>
  footballStep(current, display).options.map((option) => option.id);

const H = (n: number) => `p.H-p${n}`;
const A = (n: number) => `p.A-p${n}`;
const PITCH_H = Array.from({ length: 11 }, (_, i) => H(i + 1));
const PITCH_A = Array.from({ length: 11 }, (_, i) => A(i + 1));

describe('Goal (design §6.3)', () => {
  it('asks Who scored for the column’s team: the Penalty toggle, its players on the pitch, Own goal by the other, Don’t know', () => {
    const goal = flowOf(footballOpen('goal.first', LIVE, STAMP));
    const step = footballStep(goal, LIVE);
    expect(step.title).toEqual({
      key: 'scoring.football.sheet.whoScored',
      vars: { team: 'Home FC' },
    });
    expect(step.options.map((option) => option.id)).toEqual([
      'penalty',
      ...PITCH_H,
      'ownGoal',
      'dontKnow',
    ]);
    expect(step.options[0]).toMatchObject({ kind: 'toggle', checked: false });
    expect(step.options[1]?.label).toBe('#1 Home Player 1');
    expect(step.options[12]?.label).toEqual({
      key: 'scoring.football.sheet.ownGoal',
      vars: { team: 'Away FC' },
    });
  });

  it('a scorer asks Assist: the same team on the pitch but the scorer, then No assist; the tap has both and the press’s stamp', () => {
    const assist = flowOf(walk('goal.first', [H(9)]));
    expect(ids(assist)).toEqual([...PITCH_H.filter((id) => id !== H(9)), 'noAssist']);
    expect(footballStep(assist, LIVE).body).toBe('#9 Home Player 9');
    expect(walk('goal.first', [H(9), H(7)])).toEqual({
      kind: 'tap',
      tap: {
        kind: 'goal',
        side: 'first',
        scorer: 'H-p9',
        assist: 'H-p7',
        penalty: false,
        stamp: STAMP,
      },
    });
    expect(walk('goal.first', [H(9), 'noAssist'])).toMatchObject({ tap: { assist: null } });
  });

  it('Penalty skips the assist: the toggle on, then the scorer records at once', () => {
    const toggled = flowOf(walk('goal.first', ['penalty']));
    expect(footballStep(toggled, LIVE).options[0]).toMatchObject({ checked: true });
    expect(walk('goal.first', ['penalty', H(10)])).toEqual({
      kind: 'tap',
      tap: {
        kind: 'goal',
        side: 'first',
        scorer: 'H-p10',
        assist: null,
        penalty: true,
        stamp: STAMP,
      },
    });
  });

  it('Own goal asks Who put it in from the OTHER team, and records it for the column', () => {
    const own = flowOf(walk('goal.first', ['ownGoal']));
    expect(footballStep(own, LIVE).title).toEqual({ key: 'scoring.football.sheet.whoPutItIn' });
    expect(ids(own)).toEqual([...PITCH_A, 'dontKnow']);
    expect(walk('goal.first', ['ownGoal', A(5)])).toEqual({
      kind: 'tap',
      tap: { kind: 'ownGoal', side: 'first', scorer: 'A-p5', stamp: STAMP },
    });
  });

  it('Don’t know records the goal for the team with no scorer and no assist step', () => {
    expect(walk('goal.second', ['dontKnow'])).toEqual({
      kind: 'tap',
      tap: {
        kind: 'goal',
        side: 'second',
        scorer: null,
        assist: null,
        penalty: false,
        stamp: STAMP,
      },
    });
  });

  it('a choice the step does not offer does nothing: a player of the other team, a bench player', () => {
    const goal = flowOf(footballOpen('goal.first', LIVE, STAMP));
    expect(footballChoose(goal, A(9), LIVE, STAMP)).toEqual({ kind: 'stay' });
    expect(footballChoose(goal, H(14), LIVE, STAMP)).toEqual({ kind: 'stay' });
    expect(footballChoose(goal, 'noAssist', LIVE, STAMP)).toEqual({ kind: 'stay' });
  });
});

describe('Card (design §6.3)', () => {
  it('asks the colour: Yellow and Red, and Second yellow only while someone has a yellow', () => {
    expect(ids(flowOf(footballOpen('card.first', LIVE, STAMP)))).toEqual([
      'color.yellow',
      'color.red',
    ]);
    const booked = displayOf([...KICK_OFF, card({ by: 'H', color: 'yellow', person: 'H-p4' })]);
    expect(ids(flowOf(footballOpen('card.first', booked, STAMP)), booked)).toEqual([
      'color.yellow',
      'color.second_yellow',
      'color.red',
    ]);
  });

  it('Second yellow lists only the booked; Yellow leaves them out; the bench under its heading', () => {
    const booked = displayOf([...KICK_OFF, card({ by: 'H', color: 'yellow', person: 'H-p4' })]);
    const second = flowOf(walk('card.first', ['color.second_yellow'], booked));
    expect(ids(second, booked)).toEqual([H(4)]);
    const yellow = flowOf(walk('card.first', ['color.yellow'], booked));
    const bench = [H(12), H(13), H(14), H(15), H(16)];
    expect(ids(yellow, booked)).toEqual([
      ...PITCH_H.filter((id) => id !== H(4)),
      'heading.bench',
      ...bench,
    ]);
    expect(footballStep(yellow, booked).options[10]).toMatchObject({
      kind: 'heading',
      label: { key: 'scoring.football.sheet.bench' },
    });
  });

  it('then the reason, No reason first; the tap names the player, the colour, the reason and the press’s stamp', () => {
    const reason = flowOf(walk('card.second', ['color.red', A(6)]));
    expect(ids(reason).slice(0, 3)).toEqual([
      'noReason',
      'reason.unsporting_behaviour',
      'reason.dissent',
    ]);
    expect(walk('card.second', ['color.red', A(6), 'reason.violent_conduct'])).toEqual({
      kind: 'tap',
      tap: {
        kind: 'card',
        side: 'second',
        person: 'A-p6',
        color: 'red',
        reason: 'violent_conduct',
        stamp: STAMP,
      },
    });
    expect(walk('card.second', ['color.red', A(6), 'noReason'])).toMatchObject({
      tap: { reason: null },
    });
  });
});

describe('Sub, the kicks and More (design §6.3–§6.5)', () => {
  it('Sub asks who comes off, then who comes on for him from the bench, and records one sub', () => {
    const on = flowOf(walk('sub.first', [H(7)]));
    expect(footballStep(on, LIVE).title).toEqual({
      key: 'scoring.football.sheet.whoComesOn',
      vars: { player: '#7 Home Player 7' },
    });
    expect(ids(on)).toEqual([H(12), H(13), H(14), H(15), H(16)]);
    expect(walk('sub.first', [H(7), H(14)])).toEqual({
      kind: 'tap',
      tap: { kind: 'sub', side: 'first', off: 'H-p7', on: 'H-p14' },
    });
  });

  it('a kick asks who kicked, the team’s players on the pitch and Don’t know', () => {
    expect(ids(flowOf(footballOpen('scored.second', LIVE, STAMP)))).toEqual([
      ...PITCH_A,
      'dontKnow',
    ]);
    expect(walk('missed.second', ['dontKnow'])).toEqual({
      kind: 'tap',
      tap: { kind: 'kick', side: 'second', person: null, scored: false },
    });
  });

  it('More lists what the match takes now; a missed penalty asks taker, goalkeeper and outcome', () => {
    expect(ids(MORE_FLOW)).toEqual([
      'penalty.first',
      'penalty.second',
      'sinBin.first',
      'sinBin.second',
      'shot.first',
      'shot.second',
      'correct',
      'details',
    ]);
    const taker = flowOf(footballChoose(MORE_FLOW, 'penalty.first', LIVE, STAMP));
    const keeper = flowOf(footballChoose(taker, H(9), LIVE, STAMP));
    expect(ids(keeper)).toEqual([...PITCH_A, 'dontKnow']);
    const outcome = flowOf(footballChoose(keeper, A(1), LIVE, STAMP));
    expect(ids(outcome)).toEqual(['outcome.saved', 'outcome.missed', 'outcome.post']);
    expect(footballChoose(outcome, 'outcome.saved', LIVE, STAMP)).toEqual({
      kind: 'tap',
      tap: {
        kind: 'penaltyMiss',
        side: 'first',
        taker: 'H-p9',
        goalkeeper: 'A-p1',
        outcome: 'saved',
        stamp: STAMP,
      },
    });
  });

  it('Correct and Match details are the hook’s; Back from sin-bin records at once', () => {
    expect(footballChoose(MORE_FLOW, 'correct', LIVE, STAMP)).toEqual({
      kind: 'other',
      id: 'correct',
    });
    expect(footballChoose(MORE_FLOW, 'details', LIVE, STAMP)).toEqual({
      kind: 'other',
      id: 'details',
    });
    const binned = displayOf([...KICK_OFF, sinBin({ by: 'A', person: 'A-p6', at: at('H1', 600) })]);
    expect(footballChoose(MORE_FLOW, 'sinBinEnd.second.0', binned, STAMP)).toEqual({
      kind: 'tap',
      tap: { kind: 'sinBinEnd', side: 'second', person: 'A-p6', stamp: STAMP },
    });
    expect(footballChoose(MORE_FLOW, 'sinBinEnd.second.1', binned, STAMP)).toEqual({
      kind: 'stay',
    });
  });
});

describe('with no team sheet (design §6.6)', () => {
  const BARE = displayOf(KICK_OFF, NO_SHEET);

  it('Goal records the team at once; a kick too', () => {
    expect(footballOpen('goal.first', BARE, STAMP)).toEqual({
      kind: 'tap',
      tap: {
        kind: 'goal',
        side: 'first',
        scorer: null,
        assist: null,
        penalty: false,
        stamp: STAMP,
      },
    });
    expect(footballOpen('scored.first', BARE, STAMP)).toEqual({
      kind: 'tap',
      tap: { kind: 'kick', side: 'first', person: null, scored: true },
    });
  });

  it('Card asks the colour and the reason, and names no player', () => {
    const reason = flowOf(walk('card.first', ['color.yellow'], BARE));
    expect(reason).toMatchObject({ step: 'reason', person: null });
    expect(walk('card.first', ['color.yellow', 'reason.dissent'], BARE)).toMatchObject({
      tap: { kind: 'card', person: null, color: 'yellow', reason: 'dissent' },
    });
  });

  it('Sub opens nothing, and a missed penalty goes straight to the outcome', () => {
    expect(footballOpen('sub.first', BARE, STAMP)).toEqual({ kind: 'stay' });
    expect(flowOf(footballChoose(MORE_FLOW, 'penalty.first', BARE, STAMP))).toMatchObject({
      step: 'outcome',
    });
  });
});
