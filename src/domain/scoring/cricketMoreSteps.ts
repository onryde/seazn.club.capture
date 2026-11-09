import { cricketPadRules } from '@seazn/engine/pad';
import { eligibleIncomingBatters, reviewsRemaining } from '@seazn/engine/sports/cricket';
import { runBall } from '@/domain/scoring/cricketExtras';
import { openPowerplay } from '@/domain/scoring/cricketMore';
import { padSideOf, turnOf, type EngineSide } from '@/domain/scoring/cricketTurn';
import type {
  CricketDisplay,
  CricketPadKey,
  CricketRetireReason,
  CricketStep,
  CricketStepOption,
  CricketTap,
} from '@/domain/scoring/cricketTypes';
import { incomingRows } from '@/domain/scoring/cricketWicket';

/**
 * More's rows, step by step (S2-4 spec §4.8; ruling 79; plan Task 15): each a step of choices that ends in the event it
 * records. The numbers a revision or a rain break needs are typed, not chosen (`cricketEntry.ts`).
 */

export type ConfirmItem = 'declare' | 'newBall' | 'followOn' | 'matchClose';
type ReviewKind = 'player' | 'umpire';
type InterruptionKind = 'rain' | 'light' | 'other';

export type MoreFlow =
  | { readonly kind: 'otherRuns' }
  | { readonly kind: 'penalty' }
  | {
      readonly kind: 'retire';
      readonly person: string | null;
      readonly reason: CricketRetireReason | null;
    }
  | { readonly kind: 'review'; readonly by: EngineSide | null; readonly review: ReviewKind | null }
  | { readonly kind: 'close' }
  | { readonly kind: 'powerplay' }
  | { readonly kind: 'confirm'; readonly item: ConfirmItem }
  | { readonly kind: 'interruption' };

/** The numbers a row asks typed (`cricketEntry.ts`). */
export type CricketEntryFlow =
  | { readonly kind: 'revise' }
  | { readonly kind: 'oversLost'; readonly interruption: InterruptionKind };

export type MoreOutcome =
  { readonly next: MoreFlow } | { readonly tap: CricketTap } | { readonly entry: CricketEntryFlow };

/** The one choice of a step that asks once. */
export const CONFIRM = 'do';

const option = (
  id: string,
  label: CricketStepOption['label'],
  more: Partial<CricketStepOption> = {},
): CricketStepOption => ({ id, label, tone: 'standard', ...more });

const step = (name: string, title: CricketPadKey, options: readonly CricketStepOption[]) => ({
  name: `more.${name}`,
  title: { key: title },
  body: null,
  options,
});

const more = (
  type: Extract<CricketTap, { kind: 'more' }>['type'],
  payload: object,
): CricketTap => ({
  kind: 'more',
  type,
  payload,
});

export function moreFlowStep(flow: MoreFlow, display: CricketDisplay): CricketStep {
  switch (flow.kind) {
    case 'otherRuns':
      return otherRunsStep();
    case 'penalty':
      return penaltyStep();
    case 'retire':
      return retireStep(flow, display);
    case 'review':
      return reviewStep(flow, display);
    case 'close':
      return step(
        'close',
        'scoring.cricket.closing.title',
        CLOSE_REASONS.map((reason) =>
          option(reason, { key: `scoring.cricket.closing.reason.${reason}` }),
        ),
      );
    case 'powerplay':
      return powerplayStep(display);
    case 'confirm':
      return step(`confirm.${flow.item}`, `scoring.cricket.confirm.${flow.item}.title`, [
        option(
          CONFIRM,
          { key: `scoring.cricket.confirm.${flow.item}.do` },
          {
            tone: flow.item === 'newBall' || flow.item === 'followOn' ? 'standard' : 'destructive',
          },
        ),
      ]);
    case 'interruption':
      return step(
        'interruption',
        'scoring.cricket.interruption.title',
        INTERRUPTIONS.map((kind) =>
          option(kind, { key: `scoring.cricket.interruption.kind.${kind}` }),
        ),
      );
  }
}

/** What a choice on a row's step comes to; none for an id the step does not offer, or offers greyed. */
export function moreFlowChoice(
  flow: MoreFlow,
  display: CricketDisplay,
  id: string,
): MoreOutcome | null {
  const offered = moreFlowStep(flow, display).options.find((one) => one.id === id);
  if (offered === undefined || offered.disabled === true) return null;
  switch (flow.kind) {
    case 'otherRuns':
      return otherRunsChoice(id);
    case 'penalty':
      return { tap: { kind: 'ball', ball: penaltyBall(Number(id.split('.')[1])) } };
    case 'retire':
      return retireChoice(flow, display, id);
    case 'review':
      return reviewChoice(flow, display, id);
    case 'close':
      return { tap: more('cricket.innings.close', { reason: id }) };
    case 'powerplay':
      return { tap: powerplayTap(display, id) };
    case 'confirm':
      return { tap: more(CONFIRMED[flow.item], {}) };
    case 'interruption':
      return { entry: { kind: 'oversLost', interruption: id as InterruptionKind } };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Other runs and penalty (ruling 79)
// ---------------------------------------------------------------------------------------------------------------

/** 5 and 7 off the bat, 4 and 6 all run (no boundary), and +5 penalty runs on a fair ball. */
function otherRunsStep(): CricketStep {
  const bat = (runs: number) =>
    option(`bat.${runs}`, { key: 'scoring.cricket.ball.runs.other', count: runs });
  const ran = (runs: number) =>
    option(`ran.${runs}`, { key: 'scoring.cricket.other.ran', vars: { runs } });
  return step('otherRuns', 'scoring.cricket.other.title', [
    bat(5),
    bat(7),
    ran(4),
    ran(6),
    option('penalty', { key: 'scoring.cricket.other.penalty', vars: { runs: PENALTY } }),
  ]);
}

const PENALTY = cricketPadRules.penaltyRuns;
const OTHER_RUNS: ReadonlyMap<string, number> = new Map([
  ['bat.5', 5],
  ['bat.7', 7],
  ['ran.4', 4],
  ['ran.6', 6],
]);

function otherRunsChoice(id: string): MoreOutcome {
  if (id === 'penalty') return { next: { kind: 'penalty' } };
  const bat = OTHER_RUNS.get(id) ?? 0;
  return { tap: { kind: 'ball', ball: { bat, extra: null, boundary: null, wicket: null } } };
}

/** The penalty's runs off the bat: the no-ball's (`cricketExtras.ts`), the 4 and the 6 boundaries as the keys are. */
const PENALTY_BAT = [0, 1, 2, 3, 4, 6];

/** Titled with the five runs it records; its keys are a row under "Off the bat". */
function penaltyStep(): CricketStep {
  return {
    ...step(
      'penalty',
      'scoring.cricket.other.penalty',
      PENALTY_BAT.map((runs) =>
        option(`bat.${runs}`, String(runs), { group: 'scoring.cricket.extras.bat' }),
      ),
    ),
    title: { key: 'scoring.cricket.other.penalty', vars: { runs: PENALTY } },
  };
}

/** A fair ball: `runs` off the bat and five penalty runs to the batting side (Law 41.2.1). */
const penaltyBall = (runs: number) => ({
  ...runBall(runs),
  extra: { kind: 'penalty' as const, runs: PENALTY },
});

// ---------------------------------------------------------------------------------------------------------------
// Retire: who, why, who walks in
// ---------------------------------------------------------------------------------------------------------------

const RETIRE_REASONS = cricketPadRules.retireReasons as readonly CricketRetireReason[];

function retireStep(
  flow: Extract<MoreFlow, { kind: 'retire' }>,
  display: CricketDisplay,
): CricketStep {
  if (flow.person === null) return retireWho(display);
  if (flow.reason === null) return retireWhy(display, flow.person);
  return step(
    'retire.incoming',
    'scoring.cricket.wicket.incoming',
    incomingRows(display, retireIncoming(display, flow.person)),
  );
}

/** Who retires: the two at the crease, the striker first. */
function retireWho(display: CricketDisplay): CricketStep {
  const crease = display.crease;
  const ends = crease === null ? [] : [crease.striker, crease.nonStriker];
  const note = (index: number): CricketPadKey =>
    index === 0 ? 'scoring.cricket.board.onStrike' : 'scoring.cricket.wicket.nonStriker';
  return step(
    'retire.who',
    'scoring.cricket.retire.who',
    ends.map((one, index) => option(one.id, one.name, { note: { key: note(index) } })),
  );
}

/** Why: only retired out may leave nobody to walk in (the last wicket); any other, the engine refuses (`resolveIncoming`). */
function retireWhy(display: CricketDisplay, person: string): CricketStep {
  const nobody = retireIncoming(display, person).length === 0;
  const greyed = { disabled: true, note: { key: 'scoring.cricket.retire.nobody' } } as const;
  return step(
    'retire.why',
    'scoring.cricket.retire.why',
    RETIRE_REASONS.map((reason) =>
      option(
        reason,
        { key: `scoring.cricket.retire.reason.${reason}` },
        nobody && reason !== 'out' ? greyed : {},
      ),
    ),
  );
}

/** Who may walk in for the batter retiring: the engine's, without them; none when nobody is left. */
function retireIncoming(display: CricketDisplay, person: string): readonly string[] {
  const crease = display.crease;
  if (crease === null) return [];
  const staying = person === crease.striker.id ? crease.nonStriker.id : crease.striker.id;
  const dismissed = turnOf(display.state)?.innings?.fine?.dismissed ?? [];
  return eligibleIncomingBatters(display.battingOrder, [...dismissed, person], [staying]);
}

function retireChoice(
  flow: Extract<MoreFlow, { kind: 'retire' }>,
  display: CricketDisplay,
  id: string,
): MoreOutcome {
  if (flow.person === null) return { next: { ...flow, person: id } };
  if (flow.reason === null) {
    const reason = id as CricketRetireReason;
    const incoming = retireIncoming(display, flow.person);
    if (incoming.length > 0) return { next: { ...flow, reason } };
    return { tap: { kind: 'retire', person: flow.person, reason, incoming: null } };
  }
  return { tap: { kind: 'retire', person: flow.person, reason: flow.reason, incoming: id } };
}

// ---------------------------------------------------------------------------------------------------------------
// Review: by, kind, outcome
// ---------------------------------------------------------------------------------------------------------------

const SIDES: readonly EngineSide[] = ['home', 'away'];
const REVIEW_KINDS = cricketPadRules.reviewKinds as readonly ReviewKind[];
const OUTCOMES = cricketPadRules.reviewOutcomes as readonly (
  'upheld' | 'struck_down' | 'umpires_call'
)[];

function reviewStep(
  flow: Extract<MoreFlow, { kind: 'review' }>,
  display: CricketDisplay,
): CricketStep {
  if (flow.by === null) {
    return step(
      'review.by',
      'scoring.cricket.review.by',
      SIDES.map((side) => option(side, display.sides[padSideOf(side)].name)),
    );
  }
  if (flow.review === null) return reviewKind(display, flow.by);
  return step(
    'review.outcome',
    'scoring.cricket.review.outcome',
    OUTCOMES.map((outcome) =>
      option(outcome, { key: `scoring.cricket.review.outcome.${outcome}` }),
    ),
  );
}

/** Which kind of review: a player review is greyed once the side has none left. */
function reviewKind(display: CricketDisplay, by: EngineSide): CricketStep {
  const spent = reviewsLeft(display, by) === 0;
  const greyed = { disabled: true, note: { key: 'scoring.cricket.review.noneLeft' } } as const;
  return step(
    'review.kind',
    'scoring.cricket.review.kind',
    REVIEW_KINDS.map((kind) =>
      option(
        kind,
        { key: `scoring.cricket.review.kind.${kind}` },
        kind === 'player' && spent ? greyed : {},
      ),
    ),
  );
}

/** A side's player reviews left this innings: the engine's count under the format's allowance (none: no cap). */
function reviewsLeft(display: CricketDisplay, side: EngineSide): number | null {
  const innings = turnOf(display.state)?.innings;
  if (innings == null) return null;
  return reviewsRemaining(innings, display.state.cfg.reviews?.perInnings, side);
}

function reviewChoice(
  flow: Extract<MoreFlow, { kind: 'review' }>,
  display: CricketDisplay,
  id: string,
): MoreOutcome {
  if (flow.by === null) return { next: { ...flow, by: id as EngineSide } };
  if (flow.review === null) return { next: { ...flow, review: id as ReviewKind } };
  const by = display.state.entrants[flow.by];
  return { tap: more('cricket.review', { by, kind: flow.review, outcome: id }) };
}

// ---------------------------------------------------------------------------------------------------------------
// Close, the powerplay, the confirms, a rain break
// ---------------------------------------------------------------------------------------------------------------

/** The reasons a person closes an innings: the engine's others close it by themselves. */
const CLOSE_REASONS = ['time', 'weather', 'other'] as const;

const POWERPLAYS = ['mandatory', 'batting', 'bowling'] as const;
const POWERPLAY_END = 'end';

/** Start one (which kind), or end the one open. */
function powerplayStep(display: CricketDisplay): CricketStep {
  const open = openPowerplay(display);
  if (open === null) {
    return step(
      'powerplay',
      'scoring.cricket.powerplay.title',
      POWERPLAYS.map((kind) => option(kind, { key: `scoring.cricket.powerplay.kind.${kind}` })),
    );
  }
  return {
    ...step('powerplay.end', 'scoring.cricket.powerplay.endTitle', [
      option(POWERPLAY_END, { key: 'scoring.cricket.powerplay.end' }),
    ]),
    body: { key: `scoring.cricket.powerplay.kind.${open as (typeof POWERPLAYS)[number]}` },
  };
}

function powerplayTap(display: CricketDisplay, id: string): CricketTap {
  const open = openPowerplay(display);
  return open === null
    ? more('cricket.powerplay', { kind: id, phase: 'start' })
    : more('cricket.powerplay', { kind: open, phase: 'end' });
}

const CONFIRMED: Readonly<Record<ConfirmItem, Extract<CricketTap, { kind: 'more' }>['type']>> = {
  declare: 'cricket.innings.declare',
  newBall: 'cricket.newball',
  followOn: 'cricket.followon',
  matchClose: 'cricket.match.close',
};

const INTERRUPTIONS: readonly InterruptionKind[] = ['rain', 'light', 'other'];
