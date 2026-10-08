/**
 * How the phone is physically held, from the accelerometer (spec §5).
 *
 * The screen-orientation API cannot answer this: once the app locks an
 * orientation, it reports the lock. The turn card needs the hands.
 *
 * Left and right landscape are one case: the Live Stream lock accepts both
 * sides, and the engine keeps the picture upright (P4).
 */
export type Gravity = { readonly x: number; readonly y: number; readonly z: number };
export type Physical = 'portrait' | 'landscape' | 'flat' | 'unknown';
/**
 * What a route wants locked. `free` is no lock: the screen follows the phone (spec §7, Home and Settings).
 * It is a value of its own, not an absent one, so a gate that unlocks can tell "following the phone" (`free`)
 * from "nothing locked yet" (`null`).
 */
export type Target = 'portrait' | 'landscape' | 'free';
/** A target that locks something. */
type Fixed = Exclude<Target, 'free'>;

export type OrientationTracker = {
  readonly settled: Physical;
  readonly candidate: Physical;
  readonly sinceMs: number;
};

/** A reading must hold this long before it counts, so a swing does not flip the lock. */
export const HOLD_MS = 300;
export const INITIAL_TRACKER: OrientationTracker = {
  settled: 'unknown',
  candidate: 'unknown',
  sinceMs: 0,
};

/** Past 60° from upright is sideways; under 30° is upright; between decides nothing. */
const LANDSCAPE_FROM_DEG = 60;
const PORTRAIT_UNDER_DEG = 30;
/**
 * The share of gravity through the screen is the cosine of the screen's angle
 * from horizontal. Above 0.94 the screen is within ~20° of horizontal (on a
 * table); below 0.87 it is tilted more than ~30° up (held). Between decides
 * nothing, so a reclined hand-held phone does not flip between flat and upright.
 */
const FLAT_ABOVE_Z_SHARE = 0.94;
const HELD_BELOW_Z_SHARE = 0.87;
const MIN_MAGNITUDE_G = 0.3;

export function classify(g: Gravity): Physical | null {
  const magnitude = Math.hypot(g.x, g.y, g.z);
  if (magnitude < MIN_MAGNITUDE_G) return 'unknown';
  const zShare = Math.abs(g.z) / magnitude;
  if (zShare > FLAT_ABOVE_Z_SHARE) return 'flat';
  if (zShare >= HELD_BELOW_Z_SHARE) return null;
  const fromUpright = (Math.atan2(Math.abs(g.x), Math.abs(g.y)) * 180) / Math.PI;
  if (fromUpright > LANDSCAPE_FROM_DEG) return 'landscape';
  if (fromUpright < PORTRAIT_UNDER_DEG) return 'portrait';
  return null;
}

/**
 * Hysteresis twice over: a dead band (30°–60° from upright, or 20°–30° off
 * the table) makes no progress, and a new reading must hold for HOLD_MS
 * before it settles.
 */
export function track(tracker: OrientationTracker, g: Gravity, atMs: number): OrientationTracker {
  const reading = classify(g);
  if (reading === null) return { ...tracker, candidate: tracker.settled, sinceMs: atMs };
  if (reading !== tracker.candidate) {
    return { settled: tracker.settled, candidate: reading, sinceMs: atMs };
  }
  if (reading !== tracker.settled && atMs - tracker.sinceMs >= HOLD_MS) {
    return { ...tracker, settled: reading };
  }
  return tracker;
}

export type GateView = {
  readonly lock: Target | 'keep';
  readonly card: 'none' | 'turnSideways' | 'turnUpright';
};

/** Which turn card is showing, when one is. */
export type TurnCardKind = Exclude<GateView['card'], 'none'>;

/**
 * While the phone is held the other way from the target, lock to how it is
 * held, so the turn card and its glyph read upright in the operator's hands;
 * lock to the target once they match (ruling R24).
 *
 * `holding` is whether the lock must hold: the engine is armed or live, or
 * (for the fixed targets) paired too. The `free` target is asked a narrower
 * question by its caller, a broadcast held (`selectBroadcastHeld`), because a
 * paired phone has no open camera on Home or Settings (Q3, F16).
 *
 * Held, the current lock stays instead: a tilt mid-broadcast must never rotate
 * the activity under the camera (AGENTS §8, P4). The card then reads sideways,
 * which R24 accepts.
 *
 * With no settled reading (`unknown`) the target is locked, with no card
 * (R34). A phone can sit in a dead band for good (face down, tilted), and
 * Android's activity is `unspecified` until the first lock, so waiting for a
 * reading left Home following auto-rotate and Live Stream open in portrait.
 * Held, the current lock stays, as above, with two refinements:
 * - nothing locked yet (`current` null, e.g. the activity remounted
 *   mid-broadcast) locks the target, since there is no lock to keep (R37);
 * - a kept lock that disagrees with the target shows the target's card, or
 *   the screen is drawn against the wrong lock (R35).
 *
 * `current` is the lock last applied, or null when nothing has been locked.
 * D9: a `free` lock is no lock to keep, so leaving it for a fixed target
 * decides from the hands, whether or not a broadcast is held (a phone upright
 * in free Settings is a portrait activity, and the lock holds it there).
 */
export function orientationGate(
  target: Target,
  physical: Physical,
  holding: boolean,
  current: Target | null,
): GateView {
  if (target === 'free') return freeGate(holding, current);
  const fromFree = current === 'free';
  if (physical === 'unknown') return unsettled(target, holding, fromFree ? null : current);
  if (physical === 'flat' || physical === target) return { lock: target, card: 'none' };
  return { lock: holding && !fromFree ? 'keep' : physical, card: cardFor(target) };
}

/**
 * Spec §7 (D9): the screen follows the phone. While a broadcast is held the
 * lock never moves under the camera, and a `free` lock (or none) is no lock
 * to keep, so it locks landscape once.
 */
function freeGate(holding: boolean, current: Target | null): GateView {
  if (!holding) return { lock: 'free', card: 'none' };
  return { lock: current === null || current === 'free' ? 'landscape' : 'keep', card: 'none' };
}

function unsettled(target: Fixed, holding: boolean, current: Target | null): GateView {
  if (!holding || current === null) return { lock: target, card: 'none' };
  return { lock: 'keep', card: current === target ? 'none' : cardFor(target) };
}

function cardFor(target: Fixed): TurnCardKind {
  return target === 'landscape' ? 'turnSideways' : 'turnUpright';
}
