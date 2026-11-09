import {
  eligibleBowlers,
  soEligibleBatters,
  type CricketState,
} from '@seazn/engine/sports/cricket';
import {
  ordinalOf,
  otherSide,
  overOf,
  rankOfOrdinal,
  turnOf,
  type CricketTurn,
} from '@/domain/scoring/cricketTurn';
import type { CricketDisplay, CricketOrdinal } from '@/domain/scoring/cricketTypes';
import type { PadSide } from '@/domain/scoring/padView';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';

/**
 * Cricket's pending picks (S2-4 spec §4.1 to §4.6, §6; plan Task 5): the scorer's choices the server records only when a
 * later ball carries them. Kept with the queue (`PendingPicks`), never sent, never in the record. The keys:
 * - `order.first`, `order.second`: a side's batting order, the yet-to-bat reordered (Law 25.1);
 * - `openers.<ordinal>`: an innings' striker and non-striker before its first ball;
 * - `bowler.<ordinal>.<over>`: the bowler of an over (counted from 0) before its first ball;
 * - `incoming.<ordinal>`: a super over's replacement batter, who rides the next ball (§4.6);
 * - `swap.<ordinal>.<legalBalls>`: the crease reversed by hand for the next ball (rulings 76, 84).
 *
 * A pick the match no longer allows is ignored, never shown: a person no longer in the lineup (the organiser edited the
 * sheet), a bowler the Laws bar from the over, a pair that is not the fold's. A pick for an innings or an over already
 * past is never read, and the next pick written drops it.
 */

export type CricketPick =
  | { readonly kind: 'order'; readonly side: PadSide; readonly ids: readonly string[] }
  | { readonly kind: 'openers'; readonly striker: string; readonly nonStriker: string }
  | { readonly kind: 'bowler'; readonly bowler: string }
  | { readonly kind: 'incoming'; readonly batter: string }
  /** The crease reversed for the next ball: the display's pair, swapped. */
  | { readonly kind: 'swap' };

export type CreasePair = { readonly striker: string; readonly nonStriker: string };

/** The picks that apply to the next ball, each one the match still allows. */
export type CricketPicksNow = {
  /** Each side's batting order: the pick's order over the engine's, the engine's players only. */
  readonly order: Readonly<Record<PadSide, readonly string[]>>;
  readonly openers: CreasePair | null;
  readonly bowler: string | null;
  readonly incoming: string | null;
  readonly swap: CreasePair | null;
};

export const orderKey = (side: PadSide): string => `order.${side}`;
export const openersKey = (ordinal: CricketOrdinal): string => `openers.${ordinal}`;
export const bowlerKey = (ordinal: CricketOrdinal, over: number): string =>
  `bowler.${ordinal}.${over}`;
export const incomingKey = (ordinal: CricketOrdinal): string => `incoming.${ordinal}`;
/**
 * A hand swap's key: the innings and the count of its deliveries, legal and illegal, before the ball it reverses. Not
 * the legal balls: a wide or a no-ball does not move them, so a swap keyed by them would reverse the ball after it too,
 * when the batters may have crossed (the controller's ruling, Batch 2 fix round 1).
 */
export const swapKey = (ordinal: CricketOrdinal, deliveries: number): string =>
  `swap.${ordinal}.${deliveries}`;

/** The picks that apply to the display's next ball (`picksAt` on the display's own fold). */
export const picksFor = (picks: PendingPicks, display: CricketDisplay): CricketPicksNow =>
  picksAt(picks, display.state, display.deliveries);

/** The picks that apply to the next ball of the folded match, `deliveries` into the innings now. */
export function picksAt(
  picks: PendingPicks,
  state: CricketState,
  deliveries: number,
): CricketPicksNow {
  const order = {
    first: mergedOrder(picks[orderKey('first')], state.orders.home),
    second: mergedOrder(picks[orderKey('second')], state.orders.away),
  };
  const turn = turnOf(state);
  if (turn === null) return { order, openers: null, bowler: null, incoming: null, swap: null };
  const ordinal = ordinalOf(turn);
  return {
    order,
    openers: pairIn(picks[openersKey(ordinal)], openersAllowed(state, turn)),
    bowler: oneIn(
      picks[bowlerKey(ordinal, overOf(turn, state.cfg.ballsPerOver))],
      bowlersAllowed(state, turn),
    ),
    incoming: oneIn(picks[incomingKey(ordinal)], incomingAllowed(state, turn)),
    swap: swapOf(picks[swapKey(ordinal, deliveries)], turn),
  };
}

/** The pick's players in its order, then the engine's players it leaves out, in the engine's order. */
function mergedOrder(pick: readonly string[] | undefined, engine: readonly string[]): string[] {
  const chosen = (pick ?? []).filter((id, i, all) => engine.includes(id) && all.indexOf(id) === i);
  return [...chosen, ...engine.filter((id) => !chosen.includes(id))];
}

/** Every one of `ids` is a person the match allows here. */
const allIn = (ids: readonly string[], allowed: readonly string[]): boolean =>
  ids.every((id) => allowed.includes(id));

function oneIn(ids: readonly string[] | undefined, allowed: readonly string[]): string | null {
  const [only, ...more] = ids ?? [];
  return only !== undefined && more.length === 0 && allIn([only], allowed) ? only : null;
}

function pairIn(ids: readonly string[] | undefined, allowed: readonly string[]): CreasePair | null {
  const [striker, nonStriker, ...more] = ids ?? [];
  if (striker === undefined || nonStriker === undefined || more.length > 0) return null;
  return striker !== nonStriker && allIn([striker, nonStriker], allowed)
    ? { striker, nonStriker }
    : null;
}

/** Who may open an innings not yet opened: its side's order; in a super over, those a super over has not dismissed. */
function openersAllowed(state: CricketState, turn: CricketTurn): readonly string[] {
  if (turn.innings !== null) return [];
  const order = state.orders[turn.battingSide];
  const spent = state.superOver?.dismissed[turn.battingSide] ?? [];
  return turn.superOver ? soEligibleBatters(order, [], spent, []) : order;
}

/**
 * Who may bowl the over due, by the engine's own rule (the consecutive over, the quota). A super-over innings is one over
 * with a fresh tally, so the quota never binds in it.
 */
function bowlersAllowed(state: CricketState, turn: CricketTurn): readonly string[] {
  const fine = turn.innings?.fine ?? null;
  const fielding = state.orders[otherSide(turn.battingSide)];
  return eligibleBowlers(fielding, fine, state.cfg.maxOversPerBowler, state.cfg.ballsPerOver);
}

/** Who may take a super over's empty end: not dismissed in any super over, and not the batter who stays. */
function incomingAllowed(state: CricketState, turn: CricketTurn): readonly string[] {
  const fine = turn.innings?.fine;
  if (!turn.superOver || fine === null || fine === undefined) return [];
  const crease = [fine.striker, fine.nonStriker].filter((id): id is string => id !== null);
  const spent = state.superOver?.dismissed[turn.battingSide] ?? [];
  return soEligibleBatters(state.orders[turn.battingSide], fine.dismissed, spent, crease);
}

/** A hand swap stands when it names the fold's own pair (a main innings only: ruling 84 scopes it). */
function swapOf(ids: readonly string[] | undefined, turn: CricketTurn): CreasePair | null {
  const fine = turn.innings?.fine;
  if (turn.superOver || fine === null || fine === undefined) return null;
  const { striker, nonStriker } = fine;
  if (striker === null || nonStriker === null) return null;
  return pairIn(ids, [striker, nonStriker]);
}

// ---------------------------------------------------------------------------------------------------------------
// Writing a pick
// ---------------------------------------------------------------------------------------------------------------

/**
 * The picks with `pick` written for the display's next ball, and every key of an innings or an over already past dropped
 * (the keys stay few, and a past pick can never be read as a new one). A pick that needs an innings when none is due, or
 * a swap with nobody at the crease, writes nothing.
 */
export function withPick(
  picks: PendingPicks,
  display: CricketDisplay,
  pick: CricketPick,
): PendingPicks {
  const turn = turnOf(display.state);
  const kept = turn === null ? picks : withoutPast(picks, turn, display);
  const entry = entryOf(pick, display, turn);
  return entry === null ? kept : { ...kept, [entry.key]: entry.ids };
}

type Entry = { readonly key: string; readonly ids: readonly string[] };

function entryOf(
  pick: CricketPick,
  display: CricketDisplay,
  turn: CricketTurn | null,
): Entry | null {
  if (pick.kind === 'order') return { key: orderKey(pick.side), ids: [...pick.ids] };
  if (turn === null) return null;
  const ordinal = ordinalOf(turn);
  switch (pick.kind) {
    case 'openers':
      return { key: openersKey(ordinal), ids: [pick.striker, pick.nonStriker] };
    case 'bowler': {
      const over = overOf(turn, display.state.cfg.ballsPerOver);
      return { key: bowlerKey(ordinal, over), ids: [pick.bowler] };
    }
    case 'incoming':
      return { key: incomingKey(ordinal), ids: [pick.batter] };
    case 'swap':
      return swapEntry(display, turn, ordinal);
  }
}

/**
 * The crease reversed for the next ball. Once the innings is under way that is a swap pick for the next delivery, which
 * the fold reads (`swapOf`); before its first ball the crease is the openers' pick, so the swap rewrites that pick
 * reversed (a swap key there would be read by nothing: Batch 4 review I2).
 */
function swapEntry(
  display: CricketDisplay,
  turn: CricketTurn,
  ordinal: CricketOrdinal,
): Entry | null {
  const { crease } = display;
  if (crease === null) return null;
  const ids = [crease.nonStriker.id, crease.striker.id];
  if (turn.innings === null) return { key: openersKey(ordinal), ids };
  return { key: swapKey(ordinal, display.deliveries), ids };
}

/** An innings's place in the match's order: the main innings, then the super over's. */
/** The picks without those of an innings before the turn's, or of an over or a delivery already bowled in it. */
function withoutPast(
  picks: PendingPicks,
  turn: CricketTurn,
  display: CricketDisplay,
): PendingPicks {
  const now = rankOfOrdinal(ordinalOf(turn)) ?? 0;
  const over = overOf(turn, display.state.cfg.ballsPerOver);
  const { deliveries } = display;
  return Object.fromEntries(
    Object.entries(picks).filter(([key]) => !isPast(key, now, over, deliveries)),
  );
}

function isPast(key: string, now: number, over: number, deliveries: number): boolean {
  const [kind, ordinal, at] = key.split('.');
  // An order's key names a side, not an innings (`order.first`): it has no rank, and is never past.
  const rank = ordinal === undefined ? null : rankOfOrdinal(ordinal);
  if (rank === null) return false;
  if (rank !== now) return rank < now;
  if (kind === 'bowler') return Number(at) < over;
  return kind === 'swap' && Number(at) < deliveries;
}
