import type { EventEnvelope } from '@seazn/engine/core';
import { cricketPadRules } from '@seazn/engine/pad';
import { activeInnings, cricket, eligibleIncomingBatters } from '@seazn/engine/sports/cricket';
import { ballEventOf } from '@/domain/scoring/cricketEvents';
import { turnOf } from '@/domain/scoring/cricketTurn';
import type {
  CricketBallTap,
  CricketBallWicketKind,
  CricketDisplay,
  CricketExtra,
  CricketPadKey,
  CricketPlayer,
  CricketStep,
  CricketStepOption,
} from '@/domain/scoring/cricketTypes';
import type { PadSide, PadVar } from '@/domain/scoring/padView';

/**
 * The wicket steps (S2-4 spec §4.3; plan Task 12): Out, or an extra's + Out, opens them for the delivery being recorded
 * (`base`: the ball with its extra and its runs), and each step is asked only when it has a choice:
 * 1. how out: the engine's kinds for this delivery (`cricketPadRules`), never retired or timed out on a ball;
 * 2. who is out: only when either batter can be (`variableOutKinds`); otherwise the striker;
 * 3. the fielder: when the kind credits one (`fielderCreditedKinds`), optional for obstructing (`fielderOptionalKinds`);
 *    a stumping offers the keeper (`fieldersFor`);
 * 4. a second fielder, a run out's (`fielderAssist`), never the fielder again; and the runs completed, 0 to 3;
 * 5. who walks in: unless the ball ends the innings (`endsInnings`), suggested from the phone's batting order.
 * The pad never asks `bowlerCredited`: the event follows the kind (`cricketEvents.ts`).
 */

/** A wicket being recorded: the delivery it comes on, and the answers so far (`undefined`: not asked yet). */
export type WicketFlow = {
  readonly base: CricketBallTap;
  readonly kind: CricketBallWicketKind | null;
  readonly out: string | null;
  /** The fielder named, or null for none (obstructing may name none). */
  readonly fielder: string | null | undefined;
  readonly assist: string | null | undefined;
  readonly completed: number | null;
};

type StepName = 'kind' | 'who' | 'fielder' | 'assist' | 'completed' | 'incoming' | 'done';

const RUN_OUT = 'runout';
const STUMPED = 'stumped';
/** The id of "No fielder" and "No second fielder". */
export const NONE = 'none';
/** The runs a run out may have completed before the wicket (spec §4.3, gap 5). */
const COMPLETED = [0, 1, 2, 3] as const;

/** The kinds never recorded on a ball: each would add a legal ball nobody bowled (spec §4.3). */
const NOT_ON_A_BALL: readonly string[] = ['retired', 'timedout'];

function isBallKind(kind: string): kind is CricketBallWicketKind {
  return !NOT_ON_A_BALL.includes(kind);
}

/**
 * How a batter can be out on this delivery, in the engine's order: off a wide or a no-ball only the engine's sets for
 * them, and while a free hit is due only its free-hit set as well (the web's rule: the pad never offers what the engine
 * would refuse).
 */
export function wicketKinds(
  display: CricketDisplay,
  extra: CricketExtra | null,
): readonly CricketBallWicketKind[] {
  const {
    wicketKinds: all,
    wideDismissalKinds,
    noBallDismissalKinds,
    freeHitDismissalKinds,
  } = cricketPadRules;
  const allowed =
    extra?.kind === 'wide'
      ? wideDismissalKinds
      : extra?.kind === 'noball'
        ? noBallDismissalKinds
        : all;
  return all
    .filter((kind) => allowed.includes(kind))
    .filter((kind) => !display.freeHit || freeHitDismissalKinds.includes(kind))
    .filter(isBallKind);
}

export function startWicket(base: CricketBallTap): WicketFlow {
  return { base, kind: null, out: null, fielder: undefined, assist: undefined, completed: null };
}

const FIELDING: Readonly<Record<PadSide, PadSide>> = { first: 'second', second: 'first' };

/** The fielding side's players: the side not batting now. */
function fieldingOf(display: CricketDisplay): readonly CricketPlayer[] {
  const batting = display.innings?.batting;
  return batting === undefined ? [] : display.players[FIELDING[batting]];
}

/**
 * Who can have taken the wicket: a stumping is the keeper's (the team sheet's `wicketkeeper` role, else its `WK`
 * position: the fold's `keeper`), or, when the sheet names none, the fielding side without the bowler, who cannot keep to
 * their own bowling. Our rule, the web's too: the engine accepts any fielder. Every other kind offers the whole side.
 */
export function fieldersFor(
  kind: CricketBallWicketKind,
  display: CricketDisplay,
): readonly CricketPlayer[] {
  const side = fieldingOf(display);
  if (kind !== STUMPED) return side;
  const keepers = side.filter((one) => one.keeper);
  return keepers.length > 0 ? keepers : side.filter((one) => one.id !== display.bowler?.id);
}

function asks(kind: CricketBallWicketKind, rule: readonly string[]): boolean {
  return rule.includes(kind);
}

/** The step the answers so far lead to. */
function stepOf(flow: WicketFlow, display: CricketDisplay): StepName {
  const { kind } = flow;
  if (kind === null) return 'kind';
  const { variableOutKinds, fielderCreditedKinds } = cricketPadRules;
  if (flow.out === null && asks(kind, variableOutKinds)) return 'who';
  if (flow.fielder === undefined && asks(kind, fielderCreditedKinds)) return 'fielder';
  if (kind === RUN_OUT && flow.assist === undefined) return 'assist';
  if (kind === RUN_OUT && flow.completed === null) return 'completed';
  return incomingFor(flow, display).length > 0 ? 'incoming' : 'done';
}

/**
 * The ball the answers record, with `incoming`. A run out's completed runs go where the delivery's runs go (preflight
 * F24, the web's rule): off the bat on a fair ball, into a wide's or a no-ball's own runs after the engine's run, and
 * into a bye's or a leg-bye's. A bye's + Out with none completed records no bye (the engine refuses a bye of no runs).
 */
export function wicketBall(
  flow: WicketFlow,
  display: CricketDisplay,
  incoming: string | null,
): CricketBallTap {
  const { base } = flow;
  const completed = flow.completed ?? 0;
  const kind = flow.kind ?? 'bowled';
  const out = flow.out ?? display.crease?.striker.id ?? '';
  const extra = base.extra === null ? null : { ...base.extra, runs: base.extra.runs + completed };
  // A bye or a leg-bye of no runs is no extra: the engine refuses one, and the wicket rides a ball with none.
  const runs =
    extra === null || extra.runs === 0
      ? { bat: base.bat + completed, extra: null }
      : { bat: base.bat, extra };
  return {
    ...base,
    ...runs,
    wicket: {
      kind,
      out,
      fielder: flow.fielder ?? null,
      fielderAssist: flow.assist ?? null,
      incoming,
    },
  };
}

/**
 * Whether recording `ball` closes the innings being scored (preflight F7; the web's `wicketEndsInnings`): the candidate
 * ball, without `incoming`, applied strictly to the fold's state by the engine. True when the innings is closed
 * afterwards or the phase moves (a tie into a super over closes the main innings and opens a new list). A refusal reads
 * false, so the scorer is still asked.
 */
export function endsInnings(display: CricketDisplay, ball: CricketBallTap): boolean {
  const candidate = ballEventOf(
    { ...ball, wicket: ball.wicket === null ? null : { ...ball.wicket, incoming: null } },
    display,
  );
  if (candidate === null) return false;
  // `apply` parses the payload itself, as the server's fold does: its type is the module's to check, not this caller's.
  const envelope = {
    id: 'pad-trial',
    fixtureId: '',
    seq: Number.MAX_SAFE_INTEGER,
    type: candidate.type,
    payload: candidate.payload,
    recordedAt: new Date(0).toISOString(),
    recordedBy: null,
  } satisfies EventEnvelope as Parameters<typeof cricket.apply>[1];
  const { state } = display;
  try {
    const { list } = activeInnings(state);
    const index = list.length > 0 && list.at(-1)?.closed !== true ? list.length - 1 : list.length;
    const after = cricket.apply(state, envelope, { strict: true });
    if (after.phase !== state.phase) return true;
    return activeInnings(after).list[index]?.closed === true;
  } catch {
    return false;
  }
}

/**
 * Who may walk in after this wicket: the engine's (`eligibleIncomingBatters`) over the phone's order, without the batter
 * out; none when the ball ends the innings, and none in a super over, whose replacement rides the next ball (§4.6) and
 * is the super over's setup's to ask.
 */
function incomingFor(flow: WicketFlow, display: CricketDisplay): readonly string[] {
  const { crease } = display;
  if (display.innings?.superOver !== false || crease === null) return [];
  if (endsInnings(display, wicketBall(flow, display, null))) return [];
  // Before its first ball the innings has no state yet: nobody is out.
  const dismissed = turnOf(display.state)?.innings?.fine?.dismissed ?? [];
  const out = flow.out ?? crease.striker.id;
  const staying = out === crease.striker.id ? crease.nonStriker.id : crease.striker.id;
  return eligibleIncomingBatters(display.battingOrder, [...dismissed, out], [staying]);
}

/** The step on screen. */
export function wicketStep(flow: WicketFlow, display: CricketDisplay): CricketStep {
  const step = stepOf(flow, display);
  return {
    name: `wicket.${step}`,
    title: { key: TITLE[step] },
    body: null,
    options: optionsOf(step, flow, display),
  };
}

const TITLE: Readonly<Record<StepName, CricketPadKey>> = {
  kind: 'scoring.cricket.wicket.how',
  who: 'scoring.cricket.wicket.who',
  fielder: 'scoring.cricket.wicket.fielder',
  assist: 'scoring.cricket.wicket.assist',
  completed: 'scoring.cricket.wicket.completed',
  incoming: 'scoring.cricket.wicket.incoming',
  done: 'scoring.cricket.wicket.how',
};

function optionsOf(
  step: StepName,
  flow: WicketFlow,
  display: CricketDisplay,
): readonly CricketStepOption[] {
  switch (step) {
    case 'kind':
      return wicketKinds(display, flow.base.extra).map((kind) => ({
        id: kind,
        label: { key: `scoring.cricket.wicket.kind.${kind}` },
        tone: 'standard',
      }));
    case 'who':
      return whoOptions(display);
    case 'fielder':
      return fielderOptions(flow, display);
    case 'assist':
      return assistOptions(flow, display);
    case 'completed':
      return COMPLETED.map((runs) => ({
        id: String(runs),
        label: String(runs),
        tone: 'standard',
        group: 'scoring.cricket.extras.ran',
      }));
    case 'incoming':
      return incomingOptions(flow, display);
    case 'done':
      return [];
  }
}

const person = (one: { readonly id: string; readonly name: string }): CricketStepOption => ({
  id: one.id,
  label: one.name,
  tone: 'standard',
});

/** Either batter, each said which end (the preview's rows). */
function whoOptions({ crease }: CricketDisplay): readonly CricketStepOption[] {
  if (crease === null) return [];
  return [
    { ...person(crease.striker), note: { key: 'scoring.cricket.board.onStrike' } },
    { ...person(crease.nonStriker), note: { key: 'scoring.cricket.wicket.nonStriker' } },
  ];
}

function fielderOptions(flow: WicketFlow, display: CricketDisplay): readonly CricketStepOption[] {
  const kind = flow.kind ?? 'caught';
  const rows = fieldersFor(kind, display).map(person);
  if (!asks(kind, cricketPadRules.fielderOptionalKinds)) return rows;
  return [
    ...rows,
    { id: NONE, label: { key: 'scoring.cricket.wicket.noFielder' }, tone: 'standard' },
  ];
}

function assistOptions(flow: WicketFlow, display: CricketDisplay): readonly CricketStepOption[] {
  const rows = fieldingOf(display).map((one): CricketStepOption =>
    one.id === flow.fielder
      ? { ...person(one), disabled: true, note: { key: 'scoring.cricket.wicket.isFielder' } }
      : person(one),
  );
  return [
    ...rows,
    { id: NONE, label: { key: 'scoring.cricket.wicket.noAssist' }, tone: 'standard' },
  ];
}

/**
 * Who walks in, the suggestion first and marked chosen (ruling 82): the next of the phone's order not yet in, else a
 * retired batter resuming, said "Retired".
 */
function incomingOptions(flow: WicketFlow, display: CricketDisplay): readonly CricketStepOption[] {
  const retired = turnOf(display.state)?.innings?.fine?.retiredNotOut ?? [];
  const ids = incomingFor(flow, display);
  const suggested = ids.find((id) => !retired.includes(id)) ?? ids[0];
  const ordered = [
    ...ids.filter((id) => id === suggested),
    ...ids.filter((id) => id !== suggested),
  ];
  const side = display.innings === null ? [] : display.players[display.innings.batting];
  return ordered.map((id) => ({
    id,
    label: side.find((one) => one.id === id)?.name ?? id,
    tone: 'standard',
    chosen: id === suggested,
    note: incomingNote(id === suggested, retired.includes(id)),
  }));
}

function incomingNote(suggested: boolean, retired: boolean): PadVar<CricketPadKey> | null {
  if (retired) return { key: 'scoring.cricket.wicket.retired' };
  return suggested ? { key: 'scoring.cricket.wicket.nextInOrder' } : null;
}

/** A choice on the step on screen: the next step, or the ball to record; none for an id the step does not offer. */
export function chooseWicket(
  flow: WicketFlow,
  display: CricketDisplay,
  id: string,
): { readonly next: WicketFlow } | { readonly done: CricketBallTap } | null {
  const step = stepOf(flow, display);
  const offered = optionsOf(step, flow, display).find(
    (one) => one.id === id && one.disabled !== true,
  );
  if (offered === undefined) return null;
  if (step === 'incoming') return { done: wicketBall(flow, display, id) };
  const next = answered(flow, display, step, id);
  return stepOf(next, display) === 'done' ? { done: wicketBall(next, display, null) } : { next };
}

function answered(
  flow: WicketFlow,
  display: CricketDisplay,
  step: StepName,
  id: string,
): WicketFlow {
  const named = id === NONE ? null : id;
  switch (step) {
    case 'kind':
      return {
        ...flow,
        kind: wicketKinds(display, flow.base.extra).find((one) => one === id) ?? null,
      };
    case 'who':
      return { ...flow, out: id };
    case 'fielder':
      return { ...flow, fielder: named };
    case 'assist':
      return { ...flow, assist: named };
    case 'completed':
      return { ...flow, completed: Number(id) };
    default:
      return flow;
  }
}
