import {
  eligibleBowlers,
  soEligibleBatters,
  type CricketState,
} from '@seazn/engine/sports/cricket';
import {
  ordinalOf,
  otherSide,
  overOf,
  padSideOf,
  rankOfOrdinal,
  turnOf,
  type CricketTurn,
} from '@/domain/scoring/cricketTurn';
import type {
  CricketDisplay,
  CricketLastTap,
  CricketOrdinal,
  CricketPicked,
  CricketStage,
} from '@/domain/scoring/cricketTypes';
import type { PadSide } from '@/domain/scoring/padView';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';

/**
 * Cricket's pending picks (S2-4 spec §4.1 to §4.6, §6; plan Task 5): the scorer's choices the server records only when a
 * later ball carries them. Kept with the queue (`PendingPicks`), never sent, never in the record. The keys:
 * - `order.first`, `order.second`: a side's batting order, the yet-to-bat reordered (Law 25.1);
 * - `openers.<ordinal>`: an innings' striker and non-striker before its first ball;
 * - `bowler.<ordinal>.<over>`: the bowler of an over (counted from 0) before its first ball;
 * - `incoming.<ordinal>`: a super over's replacement batter, who rides the next ball (§4.6);
 * - `swap.<ordinal>.<deliveries>`: the crease reversed by hand for the next ball (rulings 76, 84);
 * - `begin.<ordinal>`: Start innings, tapped at a break once the innings' openers and bowler are picked (spec §4.5). It
 *   names the side batting the innings (a pad side) and records nothing: the innings opens on its first ball, which
 *   carries the picks. The side tells a Start innings an Undo of the follow-on left stale (`withoutStalePicks`).
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
  | { readonly kind: 'swap' }
  /** Start innings, at a break: the innings due may take its first ball (spec §4.5). */
  | { readonly kind: 'begin' };

export type CreasePair = { readonly striker: string; readonly nonStriker: string };

/** The picks that apply to the next ball, each one the match still allows. */
export type CricketPicksNow = {
  /** Each side's batting order: the pick's order over the engine's, the engine's players only. */
  readonly order: Readonly<Record<PadSide, readonly string[]>>;
  readonly openers: CreasePair | null;
  readonly bowler: string | null;
  readonly incoming: string | null;
  readonly swap: CreasePair | null;
  /** Start innings was tapped for the innings due. */
  readonly begun: boolean;
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
export const beginKey = (ordinal: CricketOrdinal): string => `begin.${ordinal}`;

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
  if (turn === null) {
    return { order, openers: null, bowler: null, incoming: null, swap: null, begun: false };
  }
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
    begun: picks[beginKey(ordinal)] !== undefined,
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
export function openersAllowed(state: CricketState, turn: CricketTurn): readonly string[] {
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
export function incomingAllowed(state: CricketState, turn: CricketTurn): readonly string[] {
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
// What the line says of a pick (T19 device run D2, D3)
// ---------------------------------------------------------------------------------------------------------------

/** More's taps that end an innings: a declaration, and a close (weather, a result by the organiser's decision). */
const ENDING_MORE: ReadonlySet<string> = new Set([
  'cricket.innings.declare',
  'cricket.innings.close',
]);

/**
 * The pick the last-tap line says (`CricketPicked`), while live. A pick is newer than the tap before it only where the
 * tap could not have followed it: Start innings once the last tap closed the innings before (`closes`: a ball, over
 * totals, a retirement, a declaration, More's close or the follow-on); the next over's bowler and a hand swap, keyed to
 * the next ball, once the last tap is a ball. Never over an Undo's line: a pick made before the tap Undo took back
 * stands again, and the Undo is newer.
 */
export function pickedOf(
  turn: CricketTurn | null,
  stage: CricketStage,
  picks: CricketPicksNow,
  lastTap: CricketLastTap | null,
): CricketPicked | null {
  if (turn === null || stage !== 'live' || lastTap === null) return null;
  // An innings not yet opened after a closing tap is a later one: the first opens on the match's start, which no tap
  // closes.
  if (turn.innings === null) {
    return closes(lastTap) ? { kind: 'begin', ordinal: ordinalOf(turn) } : null;
  }
  if (lastTap.kind !== 'ball') return null;
  // The over's bowler is a pick only before its first ball; after it, the fold's.
  const bowler = turn.innings.fine?.currentBowler === null ? picks.bowler : null;
  const striker = picks.swap?.striker ?? null;
  if (bowler !== null) return { kind: 'bowler', bowler, striker };
  return striker === null ? null : { kind: 'swap', striker };
}

/**
 * Whether the tap can be the one that ended an innings: a ball, over totals, a retirement, a declaration or More's
 * close. At a break the last tap is the news the break card carries when it is one, and the line says nothing of it
 * (T19 D13).
 */
export const tapEndedInnings = (tap: CricketLastTap): boolean =>
  tap.kind === 'ball' ||
  tap.kind === 'summary' ||
  tap.kind === 'retire' ||
  (tap.kind === 'more' && ENDING_MORE.has(tap.type));

/**
 * Whether a Start innings standing after the tap came after it: a tap that ends an innings, or the follow-on, which
 * sets the next one. The follow-on is not an end: it is made at the break, so the line keeps its own words there
 * (`tapEndedInnings`).
 */
const closes = (tap: CricketLastTap): boolean =>
  tapEndedInnings(tap) || (tap.kind === 'more' && tap.type === 'cricket.followon');

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
    case 'begin':
      return { key: beginKey(ordinal), ids: [padSideOf(turn.battingSide)] };
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

/**
 * The picks without the stale ones: those the ledger has gone back from, which the board no longer shows (the
 * controller's rulings on Task 16's concern 1; T19 D4). A Start innings is stale for an innings not yet due (an Undo of
 * the ball that closed the innings before, or a void from the console), or for the innings due with another side
 * batting it (an Undo of the enforced follow-on): the break, with its card, then asks Start innings again, the innings'
 * openers and first bowler kept, the choice already made. An over's bowler or a hand swap is stale for a point of the
 * innings not reached: an over after the one due (an Undo of the over's last ball: the over ended again asks its bowler
 * afresh) or a delivery after the next; of a later innings, any but its first over's bowler. A super over's next batter
 * is stale once no end of the crease now is empty (the next ball carried them, or an Undo took the wicket back: the
 * wicket again asks afresh; T19 D10). The same map when nothing is stale.
 */
export function withoutStalePicks(
  picks: PendingPicks,
  { state, deliveries }: Pick<CricketDisplay, 'state' | 'deliveries'>,
): PendingPicks {
  const turn = turnOf(state);
  const now: Now = {
    rank: turn === null ? 0 : (rankOfOrdinal(ordinalOf(turn)) ?? 0),
    side: turn === null ? null : padSideOf(turn.battingSide),
    over: turn === null ? 0 : overOf(turn, state.cfg.ballsPerOver),
    deliveries,
    emptyEnd: emptyEndOf(turn),
  };
  const stale = ([key, ids]: readonly [string, readonly string[]]) => isStale(key, ids, now);
  const entries = Object.entries(picks);
  if (!entries.some(stale)) return picks;
  return Object.fromEntries(entries.filter((entry) => !stale(entry)));
}

/**
 * Where the ledger stands: the innings due or under way (its rank and its side), its over, its deliveries, and whether
 * a wicket has left an end of its crease empty.
 */
type Now = {
  readonly rank: number;
  readonly side: PadSide | null;
  readonly over: number;
  readonly deliveries: number;
  readonly emptyEnd: boolean;
};

function emptyEndOf(turn: CricketTurn | null): boolean {
  const fine = turn?.innings?.fine;
  return fine != null && (fine.striker === null || fine.nonStriker === null);
}

function isStale(key: string, ids: readonly string[], now: Now): boolean {
  const [kind, ordinal, at] = key.split('.');
  const rank = rankOfOrdinal(ordinal ?? '') ?? 0;
  switch (kind) {
    case 'begin':
      return rank > now.rank || (rank === now.rank && ids[0] !== now.side);
    case 'bowler':
      return rank > now.rank ? Number(at) > 0 : rank === now.rank && Number(at) > now.over;
    case 'swap':
      return rank > now.rank || (rank === now.rank && Number(at) > now.deliveries);
    case 'incoming':
      return !now.emptyEnd;
    default:
      return false;
  }
}
