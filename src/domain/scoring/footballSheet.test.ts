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
  KO_11,
  ledgerOf,
  MATCH,
  NO_SHEET,
  sinBin,
  start,
  sub,
  withCfg,
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

// Yellow and Red replace Card (the controller's ruling 136): the button names the colour, so there is no colour step.
describe('Yellow and Red (design §6.3)', () => {
  const BENCH = [H(12), H(13), H(14), H(15), H(16)];
  const booked = displayOf([...KICK_OFF, card({ by: 'H', color: 'yellow', person: 'H-p4' })]);

  it('Yellow opens at the player step, titled for the colour and the team: every bookable player, the bench under its heading', () => {
    const yellow = flowOf(footballOpen('yellow.first', LIVE, STAMP));
    expect(yellow).toMatchObject({ kind: 'card', step: 'player', color: 'yellow' });
    expect(footballStep(yellow, LIVE).title).toEqual({
      key: 'scoring.football.sheet.yellow',
      vars: { team: 'Home FC' },
    });
    expect(ids(yellow)).toEqual([...PITCH_H, 'heading.bench', ...BENCH]);
    expect(footballStep(yellow, LIVE).options[11]).toMatchObject({
      kind: 'heading',
      label: { key: 'scoring.football.sheet.bench' },
    });
  });

  it('Red opens at the player step with the colour red over every bookable player', () => {
    const red = flowOf(footballOpen('red.second', LIVE, STAMP));
    expect(red).toMatchObject({ kind: 'card', step: 'player', color: 'red', side: 'second' });
    expect(footballStep(red, LIVE).title).toEqual({
      key: 'scoring.football.sheet.red',
      vars: { team: 'Away FC' },
    });
    expect(ids(red)).toEqual([...PITCH_A, 'heading.bench', A(12), A(13), A(14), A(15), A(16)]);
  });

  it('a player already on a yellow stays in the Yellow list with the 2nd yellow note; no one else has one', () => {
    const yellow = flowOf(footballOpen('yellow.first', booked, STAMP));
    expect(ids(yellow, booked)).toEqual([...PITCH_H, 'heading.bench', ...BENCH]);
    const options = footballStep(yellow, booked).options;
    expect(options.filter((option) => option.note != null).map((option) => option.id)).toEqual([
      H(4),
    ]);
    expect(options.find((option) => option.id === H(4))?.note).toEqual({
      key: 'scoring.football.sheet.secondYellow',
    });
    const fresh = footballStep(flowOf(footballOpen('yellow.first', LIVE, STAMP)), LIVE);
    expect(fresh.options.filter((option) => option.note != null)).toEqual([]);
  });

  it('a yellowed player on the bench carries the note too', () => {
    const benched = displayOf([...KICK_OFF, card({ by: 'H', color: 'yellow', person: 'H-p14' })]);
    const options = footballStep(
      flowOf(footballOpen('yellow.first', benched, STAMP)),
      benched,
    ).options;
    expect(options.find((option) => option.id === H(14))?.note).toEqual({
      key: 'scoring.football.sheet.secondYellow',
    });
  });

  it('Yellow on a fresh player books a yellow; on a yellowed one it books a second yellow', () => {
    expect(walk('yellow.first', [H(7), 'reason.dissent'], booked)).toEqual({
      kind: 'tap',
      tap: {
        kind: 'card',
        side: 'first',
        person: 'H-p7',
        color: 'yellow',
        reason: 'dissent',
        stamp: STAMP,
      },
    });
    expect(walk('yellow.first', [H(4), 'reason.dissent'], booked)).toMatchObject({
      kind: 'tap',
      tap: { kind: 'card', person: 'H-p4', color: 'second_yellow' },
    });
  });

  it('Red books red, even for a player already on a yellow, and shows no 2nd yellow note', () => {
    expect(walk('red.first', [H(4), 'reason.violent_conduct'], booked)).toMatchObject({
      kind: 'tap',
      tap: { kind: 'card', person: 'H-p4', color: 'red', reason: 'violent_conduct' },
    });
    const red = flowOf(footballOpen('red.first', booked, STAMP));
    expect(footballStep(red, booked).options.filter((option) => option.note != null)).toEqual([]);
  });

  it('then the reason, No reason first, naming the player; the tap names the player, the colour, the reason and the stamp', () => {
    const reason = flowOf(walk('red.second', [A(6)]));
    expect(reason).toMatchObject({ step: 'reason', person: 'A-p6', color: 'red' });
    expect(footballStep(reason, LIVE).title).toEqual({ key: 'scoring.football.sheet.reason' });
    expect(ids(reason).slice(0, 3)).toEqual([
      'noReason',
      'reason.unsporting_behaviour',
      'reason.dissent',
    ]);
    expect(walk('red.second', [A(6), 'reason.violent_conduct'])).toEqual({
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
    expect(walk('red.second', [A(6), 'noReason'])).toMatchObject({ tap: { reason: null } });
  });

  it('there is no colour step: the old colour ids and the old Card button do nothing', () => {
    expect(footballOpen('card.first', LIVE, STAMP)).toEqual({ kind: 'stay' });
    const yellow = flowOf(footballOpen('yellow.first', LIVE, STAMP));
    for (const id of ['color.yellow', 'color.second_yellow', 'color.red'])
      expect(footballChoose(yellow, id, LIVE, STAMP)).toEqual({ kind: 'stay' });
  });

  // The fourth question, an empty input: everyone is sent off, so nobody is bookable. The step says so in one heading line
  // (the controller's ruling 139), which takes no press, and nothing records.
  it('an empty bookable list is one line saying no one can be booked, and a choice on it does nothing', () => {
    const empty = {
      ...LIVE,
      sides: { ...LIVE.sides, first: { ...LIVE.sides.first, cardable: [] } },
    };
    for (const button of ['yellow.first', 'red.first']) {
      const step = flowOf(footballOpen(button, empty, STAMP));
      expect(footballStep(step, empty).options).toEqual([
        {
          id: 'heading.none',
          label: { key: 'scoring.football.sheet.noOneToBook' },
          tone: 'standard',
          kind: 'heading',
        },
      ]);
      expect(footballChoose(step, 'heading.none', empty, STAMP)).toEqual({ kind: 'stay' });
      expect(footballChoose(step, H(1), empty, STAMP)).toEqual({ kind: 'stay' });
    }
  });
});

describe('Sub, the kicks and More (design §6.3–§6.5)', () => {
  it('Sub asks who comes off, then who comes on for him from the bench, and records one sub at the reading when Sub was pressed', () => {
    const on = flowOf(walk('sub.first', [H(7)]));
    expect(footballStep(on, LIVE).title).toEqual({
      key: 'scoring.football.sheet.whoComesOn',
      vars: { player: '#7 Home Player 7' },
    });
    expect(ids(on)).toEqual([H(12), H(13), H(14), H(15), H(16)]);
    expect(walk('sub.first', [H(7), H(14)])).toEqual({
      kind: 'tap',
      tap: { kind: 'sub', side: 'first', off: 'H-p7', on: 'H-p14', stamp: STAMP },
    });
  });

  // The controller's ruling 155: with the IFAB concussion trial in force (`concussionSubs`), Sub has one more step after
  // the player on: Normal sub or Concussion sub. Without it the flow is exactly as above.
  const CONCUSSION = withCfg(MATCH, { ...KO_11, maxSubs: 5, subWindows: 3, concussionSubs: 1 });
  const TRIAL = displayOf(KICK_OFF, CONCUSSION);

  it('with concussionSubs, Sub asks Normal or Concussion after the player on; each records its own sub', () => {
    const kind = flowOf(walk('sub.first', [H(7), H(14)], TRIAL));
    expect(footballStep(kind, TRIAL)).toEqual({
      title: { key: 'scoring.football.sheet.whichSub', vars: { team: 'Home FC' } },
      body: null,
      options: [
        { id: 'normalSub', label: { key: 'scoring.football.sheet.normalSub' }, tone: 'standard' },
        {
          id: 'concussionSub',
          label: { key: 'scoring.football.sheet.concussionSub' },
          tone: 'standard',
        },
      ],
    });
    expect(walk('sub.first', [H(7), H(14), 'normalSub'], TRIAL)).toEqual({
      kind: 'tap',
      tap: { kind: 'sub', side: 'first', off: 'H-p7', on: 'H-p14', stamp: STAMP },
    });
    expect(walk('sub.first', [H(7), H(14), 'concussionSub'], TRIAL)).toEqual({
      kind: 'tap',
      tap: { kind: 'sub', side: 'first', off: 'H-p7', on: 'H-p14', stamp: STAMP, concussion: true },
    });
  });

  it('the side’s exemption spent: Concussion sub is disabled with “None left” and takes no press', () => {
    const spent = displayOf(
      [
        ...KICK_OFF,
        {
          type: 'core.lineup.replacement',
          payload: {
            side: 'ent-home',
            off: 'H-p2',
            on: { personId: 'H-p12', slot: 'bench', orderNo: 1 },
            exemption: 'concussion',
            at: at('H1', 300),
          },
        },
      ],
      CONCUSSION,
    );
    const kind = flowOf(walk('sub.first', [H(7), H(14)], spent));
    expect(footballStep(kind, spent).options[1]).toEqual({
      id: 'concussionSub',
      label: { key: 'scoring.football.sheet.concussionSub' },
      tone: 'standard',
      disabled: true,
      note: { key: 'scoring.football.sheet.noneLeft' },
    });
    expect(footballChoose(kind, 'concussionSub', spent, STAMP)).toEqual({ kind: 'stay' });
  });

  it('ordinary subs spent: Normal sub is disabled with “No subs left”, Concussion still records', () => {
    const capped = withCfg(MATCH, { ...KO_11, maxSubs: 1, concussionSubs: 1 });
    const used = displayOf(
      [...KICK_OFF, sub({ by: 'H', off: 'H-p2', on: 'H-p12', at: at('H1', 300) })],
      capped,
    );
    const kind = flowOf(walk('sub.first', [H(7), H(14)], used));
    expect(footballStep(kind, used).options[0]).toEqual({
      id: 'normalSub',
      label: { key: 'scoring.football.sheet.normalSub' },
      tone: 'standard',
      disabled: true,
      note: { key: 'scoring.football.column.noSubs' },
    });
    expect(footballChoose(kind, 'normalSub', used, STAMP)).toEqual({ kind: 'stay' });
    expect(walk('sub.first', [H(7), H(14), 'concussionSub'], used)).toMatchObject({
      kind: 'tap',
      tap: { concussion: true },
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

  it('More’s Sin-bin asks who was sent off, and a shot on target who took it, where the team has a sheet', () => {
    expect(flowOf(footballChoose(MORE_FLOW, 'sinBin.second', LIVE, STAMP))).toEqual({
      kind: 'sinBin',
      side: 'second',
      stamp: STAMP,
      step: 'player',
      person: null,
    });
    expect(flowOf(footballChoose(MORE_FLOW, 'shot.first', LIVE, STAMP))).toEqual({
      kind: 'shot',
      side: 'first',
      stamp: STAMP,
      step: 'taker',
      taker: null,
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

  it('Yellow and Red open at the reason with the button’s colour, and name no player', () => {
    const yellow = flowOf(footballOpen('yellow.first', BARE, STAMP));
    expect(yellow).toMatchObject({ step: 'reason', person: null, color: 'yellow' });
    expect(walk('yellow.first', ['reason.dissent'], BARE)).toMatchObject({
      tap: { kind: 'card', person: null, color: 'yellow', reason: 'dissent' },
    });
    expect(walk('red.second', ['reason.violent_conduct'], BARE)).toMatchObject({
      tap: { kind: 'card', side: 'second', person: null, color: 'red', reason: 'violent_conduct' },
    });
  });

  it('Sub opens nothing; a missed penalty and a shot go straight to the outcome, a sin-bin to the reason', () => {
    expect(footballOpen('sub.first', BARE, STAMP)).toEqual({ kind: 'stay' });
    expect(flowOf(footballChoose(MORE_FLOW, 'penalty.first', BARE, STAMP))).toMatchObject({
      step: 'outcome',
    });
    expect(flowOf(footballChoose(MORE_FLOW, 'shot.first', BARE, STAMP))).toMatchObject({
      kind: 'shot',
      step: 'outcome',
    });
    expect(flowOf(footballChoose(MORE_FLOW, 'sinBin.first', BARE, STAMP))).toMatchObject({
      kind: 'sinBin',
      step: 'reason',
    });
  });
});
