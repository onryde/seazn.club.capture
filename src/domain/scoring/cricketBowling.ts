import {
  eligibleBowlers,
  eligibleChangeBowlers,
  oversUsed,
  type InningsState,
} from '@seazn/engine/sports/cricket';
import { figuresIn } from '@/domain/scoring/cricketFold';
import type { CricketPick } from '@/domain/scoring/cricketPicks';
import { otherSide, padSideOf, turnOf, type CricketTurn } from '@/domain/scoring/cricketTurn';
import type {
  CricketChangeReason,
  CricketDisplay,
  CricketPadKey,
  CricketStep,
  CricketStepOption,
  CricketTap,
} from '@/domain/scoring/cricketTypes';
import type { PadVar } from '@/domain/scoring/padView';

/**
 * Who bowls (S2-4 spec §4.4; rulings 75 and 84; plan Task 13): the over-end sheet, "Over {n} — next bowler", whose
 * choice is the over's pick, held on the phone until its first ball names the bowler (no event records it); and More's
 * mid-over change, which records `cricket.bowler.change`. Who may bowl is the engine's (`eligibleBowlers`,
 * `eligibleChangeBowlers`); this only says why the rest may not.
 */

/** Why a fielder may not bowl the next over: they bowled the last one (or part of it), or their overs are used up. */
export type BowlerReason = 'lastOver' | 'outOfOvers';

export type BowlerRow = {
  readonly id: string;
  readonly name: string;
  /** O-M-R-W in this innings. */
  readonly figures: string;
  /** Overs left under the format's quota; none when it has none. */
  readonly oversLeft: number | null;
  readonly can: boolean;
  readonly reason: BowlerReason | null;
};

/** The over's facts the engine's rules read (`FineInnings`, which is not exported). */
type Fine = InningsState['fine'];

type Fielding = {
  readonly turn: CricketTurn;
  readonly fine: Fine;
  readonly order: readonly string[];
  readonly names: ReadonlyMap<string, string>;
};

function fieldingOf(display: CricketDisplay): Fielding | null {
  const turn = turnOf(display.state);
  if (turn === null) return null;
  const side = otherSide(turn.battingSide);
  const players = display.players[padSideOf(side)];
  return {
    turn,
    fine: turn.innings?.fine ?? null,
    order: display.state.orders[side],
    names: new Map(players.map((one) => [one.id, one.name])),
  };
}

/** The fielding side for the next over, those who may bowl it first, each in the batting order's place. */
export function bowlerRows(display: CricketDisplay): readonly BowlerRow[] {
  const fielding = fieldingOf(display);
  if (fielding === null) return [];
  const { fine, order } = fielding;
  const { maxOversPerBowler: max, ballsPerOver } = display.state.cfg;
  const can = new Set(eligibleBowlers(order, fine, max, ballsPerOver));
  const rows = order.map((id) => rowOf(display, fielding, id, can.has(id)));
  return [...rows.filter((one) => one.can), ...rows.filter((one) => !one.can)];
}

function rowOf(display: CricketDisplay, fielding: Fielding, id: string, can: boolean): BowlerRow {
  const { fine, turn } = fielding;
  const { maxOversPerBowler: max, ballsPerOver } = display.state.cfg;
  const used = oversUsed(fine, id, ballsPerOver);
  return {
    id,
    name: fielding.names.get(id) ?? id,
    figures: figuresIn(display.scorecard, display.state, turn, id),
    oversLeft: max === undefined ? null : Math.max(0, max - used),
    can,
    reason: can ? null : reasonOf(fine, id),
  };
}

/** The last over's bowler, or either bowler of a last over a change split (`prevOverBowlers`); else out of overs. */
function reasonOf(fine: Fine, id: string): BowlerReason {
  const last = fine?.prevOverBowler === id || fine?.prevOverBowlers?.includes(id) === true;
  return last ? 'lastOver' : 'outOfOvers';
}

/** Who may finish the over under way after a change: the engine's (`eligibleChangeBowlers`); none between overs. */
export function changeRows(display: CricketDisplay): readonly BowlerRow[] {
  const fielding = fieldingOf(display);
  if (fielding === null) return [];
  const { maxOversPerBowler: max, ballsPerOver } = display.state.cfg;
  const ids = eligibleChangeBowlers(fielding.order, fielding.fine, max, ballsPerOver);
  return ids.map((id) => rowOf(display, fielding, id, true));
}

/**
 * The over-end sheet: the fielders, those who may bowl first with their figures, the rest greyed with why. With nobody
 * to bowl, it says so and to ask the organiser. (It once offered over totals while the innings had no ball; a real engine
 * never has nobody to bowl an innings' first over, so the row was unreachable and went. Totals are the totals stage's.)
 */
export function bowlerStep(display: CricketDisplay): CricketStep {
  const rows = bowlerRows(display);
  return {
    name: 'bowler.next',
    title: { key: 'scoring.cricket.bowling.title', vars: { number: display.over.number } },
    body: rows.some((one) => one.can) ? bodyOf(display) : { key: 'scoring.cricket.bowling.none' },
    options: rows.map((row) => bowlerOption(row, display)),
  };
}

function bodyOf(display: CricketDisplay): PadVar<CricketPadKey> | null {
  const batting = display.innings?.batting;
  if (batting === undefined) return null;
  const team = display.sides[batting === 'first' ? 'second' : 'first'].name;
  return { key: 'scoring.cricket.bowling.body', vars: { team } };
}

function bowlerOption(row: BowlerRow, display: CricketDisplay): CricketStepOption {
  if (row.can) return { id: row.id, label: row.name, tone: 'standard', note: row.figures };
  return {
    id: row.id,
    label: row.name,
    tone: 'standard',
    disabled: true,
    note: reasonText(row, display),
  };
}

/** Why one may not bowl the next over, in words: the last over's bowler, or out of the format's overs. */
export function reasonText(row: BowlerRow, display: CricketDisplay): PadVar<CricketPadKey> {
  if (row.reason === 'lastOver') return { key: 'scoring.cricket.bowling.lastOver' };
  return {
    key: 'scoring.cricket.bowling.outOfOvers',
    vars: { max: display.state.cfg.maxOversPerBowler ?? 0 },
  };
}

/** A choice on the over-end sheet: the over's bowler, as a pick; none for one who may not bowl it. */
export function chooseBowler(display: CricketDisplay, id: string): CricketPick | null {
  const row = bowlerRows(display).find((one) => one.id === id);
  return row?.can === true ? { kind: 'bowler', bowler: id } : null;
}

/** Why the bowler is changed: `CricketBowlerChange`'s reasons, in its order. */
const CHANGE_REASONS: readonly CricketChangeReason[] = ['incapacitated', 'suspended', 'other'];

/** The change's steps: who finishes the over, then why. */
export function changeStep(display: CricketDisplay, bowler: string | null): CricketStep {
  if (bowler === null) {
    return {
      name: 'change.bowler',
      title: { key: 'scoring.cricket.change.title' },
      body: null,
      options: changeRows(display).map((row) => ({
        id: row.id,
        label: row.name,
        tone: 'standard',
        note: row.figures,
      })),
    };
  }
  return {
    name: 'change.reason',
    title: { key: 'scoring.cricket.change.why' },
    body: null,
    options: CHANGE_REASONS.map((reason) => ({
      id: reason,
      label: { key: `scoring.cricket.change.reason.${reason}` },
      tone: 'standard',
    })),
  };
}

/** A choice on a change's step: the bowler named, then the change to record; none for what the step does not offer. */
export function chooseChange(
  display: CricketDisplay,
  bowler: string | null,
  id: string,
): { readonly next: string } | { readonly done: CricketTap } | null {
  if (bowler === null)
    return changeRows(display).some((one) => one.id === id) ? { next: id } : null;
  const reason = CHANGE_REASONS.find((one) => one === id);
  return reason === undefined ? null : { done: { kind: 'bowlerChange', bowler, reason } };
}
