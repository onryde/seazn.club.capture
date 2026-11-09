import { changeRows } from '@/domain/scoring/cricketBowling';
import { turnOf } from '@/domain/scoring/cricketTurn';
import type {
  CricketDisplay,
  CricketMoreRow,
  CricketStep,
  CricketStepOption,
} from '@/domain/scoring/cricketTypes';

/**
 * More (S2-4 spec §4.8, amended by preflight F20; rulings 79 and 84; plan Tasks 13 and 15): what the pad records less often
 * than a ball, each row shown only when the engine would take it now (ruling 69), read from the fold and the format,
 * never a list per screen. In a super over it is empty: the engine refuses all of it there but the balls (3144-3150).
 * More opens only from the pad's keys, so the setup screen has none (F20); the follow-on, due between innings, is the
 * break's to offer (Task 16).
 */

export type CricketMoreItem =
  | 'otherRuns'
  | 'swapStrike'
  | 'changeBowler'
  | 'retire'
  | 'review'
  | 'newBall'
  | 'powerplay'
  | 'interruption'
  | 'revise'
  | 'declare'
  | 'close'
  | 'followOn'
  | 'matchClose';

/** Facts the gates read off the fold. */
type Facts = {
  readonly display: CricketDisplay;
  /** An innings under way, scored ball by ball: "innings open" (live, not at the break, 2177-2179, 1050). */
  readonly inPlay: boolean;
  /** Limited overs: the engine's quota. */
  readonly limited: boolean;
  readonly twoInnings: boolean;
};

/**
 * Each row's "shown when" (§4.8's table), in More's order: Other runs first (ruling 79), then the rows of a ball's
 * moment, then what ends an innings or the match, last.
 */
const GATES: readonly (readonly [CricketMoreItem, (facts: Facts) => boolean])[] = [
  // A ball: while the next ball has all it needs (not at an over's end with no bowler).
  ['otherRuns', ({ display }) => display.stage === 'live' && display.needs === null],
  // Ruling 84 scopes it to a main innings (F28): pinned by the super-over rule above them all.
  ['swapStrike', ({ display }) => display.crease !== null],
  // In an innings under way (a decided match's last innings may stop mid-over); the engine names nobody between overs,
  // where it refuses a change too (engine ruling 278).
  ['changeBowler', ({ display, inPlay }) => inPlay && changeRows(display).length > 0],
  ['retire', ({ inPlay }) => inPlay],
  ['review', ({ inPlay }) => inPlay],
  ['newBall', (facts) => facts.inPlay && !newBallTaken(facts.display)],
  ['powerplay', ({ inPlay, limited }) => inPlay && limited],
  // Live on the phone (F20): the engine takes it before Start too, which is the organiser's on the web.
  ['interruption', ({ display }) => display.stage === 'live'],
  [
    'revise',
    ({ display, limited, twoInnings }) => display.stage === 'live' && limited && !twoInnings,
  ],
  ['declare', ({ inPlay, twoInnings }) => inPlay && twoInnings],
  ['close', ({ inPlay }) => inPlay],
  ['followOn', ({ display }) => followOnDue(display)],
  ['matchClose', ({ display, twoInnings }) => twoInnings && display.state.phase === 'live'],
];

export function cricketMoreItems(display: CricketDisplay): readonly CricketMoreItem[] {
  const { state } = display;
  if (state.phase === 'super_over') return [];
  const turn = turnOf(state);
  const facts: Facts = {
    display,
    inPlay: display.stage === 'live' && turn?.innings != null,
    limited: state.quota !== null,
    twoInnings: state.cfg.inningsPerSide === 2,
  };
  return GATES.filter(([, shown]) => shown(facts)).map(([item]) => item);
}

/** A new ball is taken once at a point of the innings: the engine refuses a second at the same legal ball. */
function newBallTaken(display: CricketDisplay): boolean {
  const innings = turnOf(display.state)?.innings;
  return innings?.newBallAt?.includes(innings.legalBalls) === true;
}

/**
 * The follow-on (4010-4017): two innings a side with it on, both first innings closed and the third not begun, and the
 * side that batted first ahead by the format's lead; once only (the engine takes a second as a no-op, and its own
 * generator offers none once `followOnEnforced`, cricket.js:3830).
 */
function followOnDue(display: CricketDisplay): boolean {
  const { state } = display;
  const followOn = state.cfg.followOn;
  if (followOn?.enabled !== true || state.phase !== 'live' || state.followOnEnforced) return false;
  const [first, second] = state.innings;
  if (state.innings.length !== 2 || first === undefined || second?.closed !== true) return false;
  return first.runs - second.runs >= followOn.lead;
}

/** The open powerplay block's kind, if one is open. */
export function openPowerplay(display: CricketDisplay): string | null {
  const blocks = turnOf(display.state)?.innings?.powerplays ?? [];
  return blocks.find((block) => block.toBalls === null)?.kind ?? null;
}

/** More's two rows of Task 13 (ruling 84), by id. */
export const MORE_CHANGE = 'changeBowler' satisfies CricketMoreItem;
export const MORE_SWAP = 'swapStrike' satisfies CricketMoreItem;

const DESTRUCTIVE: ReadonlySet<CricketMoreItem> = new Set(['declare', 'close', 'matchClose']);

/** The row's words: the powerplay's says whether it starts one or ends the one open. */
function rowKey(item: CricketMoreItem, display: CricketDisplay): CricketStepOption['label'] {
  if (item === 'swapStrike') return { key: 'scoring.cricket.more.swap' };
  if (item === 'changeBowler') return { key: 'scoring.cricket.more.change' };
  const row: CricketMoreRow =
    item === 'powerplay' && openPowerplay(display) !== null ? 'powerplayEnd' : item;
  return { key: `scoring.cricket.more.${row}` };
}

export function moreStep(display: CricketDisplay): CricketStep {
  const options = cricketMoreItems(display).map((item): CricketStepOption => ({
    id: item,
    label: rowKey(item, display),
    tone: DESTRUCTIVE.has(item) ? 'destructive' : 'standard',
  }));
  return { name: 'more', title: { key: 'scoring.cricket.key.more' }, body: null, options };
}

/** Whether More has anything to offer now: the key is greyed when it has not. */
export const moreOffered = (display: CricketDisplay): boolean =>
  cricketMoreItems(display).length > 0;
