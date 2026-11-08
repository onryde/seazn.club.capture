import type { CreasePair } from '@/domain/scoring/cricketPicks';
import type { CricketDisplay } from '@/domain/scoring/cricketTypes';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * Cricket's setup before its first ball (S2-4 spec §4.1, owner ruling 83; plan Task 10): the toss on the whole screen,
 * then the batting side's order, the first two of which open, then the first bowler, then Start match. Which step the
 * screen asks is read off the display, which already holds the scorer's pending picks (`picksFor`): the order merged
 * over the engine's, the openers' pick as the crease, the bowler's pick as the bowler. Nothing here is a rule of ours:
 * who may open and bowl is the engine's (`picksAt` keeps only the picks it allows).
 *
 * - `toss`: no toss yet.
 * - `order`: before Start, the openers are not picked: the batting order, whose first two open (the first on strike).
 * - `openers`: a later innings, or a super over's, has no openers yet (Task 15 draws it; the order is set by then).
 * - `bowler`: the openers are picked and the over due has no bowler.
 * - `ready`: nothing the first ball needs is missing; before Start, Start match is ready. A side with no players entered
 *   needs no pick (it scores over totals, spec §4.10), so it is ready at once.
 */
export type CricketSetupStep = 'toss' | 'order' | 'openers' | 'bowler' | 'ready';

export function setupStep(display: CricketDisplay): CricketSetupStep {
  if (display.stage === 'toss') return 'toss';
  if (display.needs === 'openers') return display.stage === 'setup' ? 'order' : 'openers';
  return display.needs === 'bowler' ? 'bowler' : 'ready';
}

/** A side as the setup names it: its seat, and its name as the organiser typed it. The toss's choice is its seat. */
export type SetupTeam = { readonly id: PadSide; readonly label: string };

export type SetupPlayer = { readonly id: string; readonly name: string };

/** A batter in the order, and whether they open (the first two). */
export type SetupBatter = SetupPlayer & { readonly opener: boolean };

/** A fielder the first over may go to, and whether the scorer picked them. */
export type SetupBowler = SetupPlayer & { readonly chosen: boolean };

export type CricketSetupView = {
  /** The two sides as the toss asks it, home first: "Who won the toss?" over the team names (ruling 83). */
  readonly teams: readonly [SetupTeam, SetupTeam];
  /** The side batting first and the side bowling: none until the toss says. */
  readonly batting: SetupTeam | null;
  readonly fielding: SetupTeam | null;
  /** The batting side's order (the engine's starters, the scorer's order over it), the first two marked as openers. */
  readonly order: readonly SetupBatter[];
  /** The openers the order names: its first two, the first on strike; none with fewer than two. */
  readonly nextOpeners: CreasePair | null;
  /** The openers picked (the crease of the first ball), or none yet. */
  readonly openers: { readonly striker: SetupPlayer; readonly nonStriker: SetupPlayer } | null;
  /** The fielding side's players, the bowler picked marked. */
  readonly bowlers: readonly SetupBowler[];
};

/** How many open an innings: the striker and the non-striker (Law 25). */
const OPENERS = 2;

export function setupView(display: CricketDisplay): CricketSetupView {
  const batting = display.innings?.batting ?? null;
  const fielding = batting === null ? null : otherOf(batting);
  const order = batting === null ? [] : orderOf(display, batting);
  const [first, second] = order;
  const { crease } = display;
  return {
    teams: [teamOf(display, 'first'), teamOf(display, 'second')],
    batting: batting === null ? null : teamOf(display, batting),
    fielding: fielding === null ? null : teamOf(display, fielding),
    order,
    nextOpeners:
      first === undefined || second === undefined
        ? null
        : { striker: first.id, nonStriker: second.id },
    openers:
      crease === null
        ? null
        : { striker: playerOf(crease.striker), nonStriker: playerOf(crease.nonStriker) },
    bowlers: fielding === null ? [] : bowlersOf(display, fielding),
  };
}

const otherOf = (side: PadSide): PadSide => (side === 'first' ? 'second' : 'first');

const teamOf = (display: CricketDisplay, side: PadSide): SetupTeam => ({
  id: side,
  label: display.sides[side].name,
});

const playerOf = ({ id, name }: SetupPlayer): SetupPlayer => ({ id, name });

function orderOf(display: CricketDisplay, side: PadSide): SetupBatter[] {
  const names = new Map(display.players[side].map((one) => [one.id, one.name]));
  return display.battingOrder.map((id, i) => ({
    id,
    name: names.get(id) ?? id,
    opener: i < OPENERS,
  }));
}

function bowlersOf(display: CricketDisplay, side: PadSide): SetupBowler[] {
  const picked = display.bowler?.id ?? null;
  return display.players[side].map((one) => ({
    id: one.id,
    name: one.name,
    chosen: one.id === picked,
  }));
}

/**
 * The order with the batter at `from` moved to `to` (one place up or down, ▲▼); a move off either end is the order as it
 * was. Nothing is recorded by it: the order is the scorer's pending pick (spec §4.1, Law 25.1).
 */
export function moved(ids: readonly string[], from: number, to: number): readonly string[] {
  const inside = (at: number) => at >= 0 && at < ids.length;
  if (!inside(from) || !inside(to)) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
