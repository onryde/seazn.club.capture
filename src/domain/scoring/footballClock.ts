import { gameTimeOf, type GameTime } from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import type { FootballCfg } from '@seazn/engine/sports/football';
import { isRecord } from '@/domain/credentials/wire';
import type { LedgerEvent } from '@/domain/scoring/wire';

/**
 * Football's clock, pure (S2-5 design §7; ruling 107 to 109). The match clock every screen shares is read from the
 * ledger's own `football.clock` events (§7.2): the latest one in the period is the anchor, and the reading runs on from
 * it in the server's time. The match time the scorer sees counts from kick-off (§7.4), mirroring the web's
 * `matchClock` vector for vector (ruling X-11). Stamps a tap carries never go backwards (§7.3). The offset to the
 * server's time and the timer are the screen's hook's, never the fold's.
 */

/** Whose clock an anchor's time is written in: the server's `recorded_at`, or this phone's own clock (a stand-in, a queued tap). */
export type ClockBase = 'server' | 'device';

/** The clock as a clock event left it: the match time it set, whether it runs, and when it was set, on which clock. */
export type ClockAnchor = {
  readonly period: string;
  readonly elapsed: number;
  readonly running: boolean;
  readonly atMs: number;
  readonly base: ClockBase;
};

/** One event as the anchor reads it, in stream order; a voided one is not `standing`. */
export type AnchorEvent = {
  readonly type: string;
  readonly payload: unknown;
  readonly atMs: number;
  readonly base: ClockBase;
  readonly standing: boolean;
};

const CLOCK = 'football.clock';
const PERIOD = 'football.period';

/**
 * The anchor of `phase`'s clock: the latest standing `football.clock` stamped in it, after the last standing period
 * marker (a marker stops the clock, §7.6, so a new period starts from its own Start). A clock event with no stamp
 * re-anchors the one before it, projected to its own arrival, with its own flag (ruling X-8; with none before it, it says
 * nothing). Null: no clock event in this period yet, so the clock reads 0, stopped, and stamps nothing.
 *
 * The projection reads both times on one clock: an unstamped clock event on another clock than the anchor before it (a
 * console's after this phone's stand-in, or the reverse) is off by the offset. The pad stamps every clock tap, so only a
 * send-time drop (`restamp`) or a console that did not know its time can leave one unstamped.
 */
export function anchorOf(events: readonly AnchorEvent[], phase: string): ClockAnchor | null {
  let anchor: ClockAnchor | null = null;
  for (const event of events) {
    if (!event.standing) continue;
    if (event.type === PERIOD) anchor = null;
    else if (event.type === CLOCK) anchor = clockAnchor(event, anchor, phase);
  }
  return anchor;
}

function clockAnchor(
  event: AnchorEvent,
  before: ClockAnchor | null,
  phase: string,
): ClockAnchor | null {
  const running = runningOf(event.payload);
  if (running === null) return before;
  const stamp = gameTimeOf(event.payload);
  const { atMs, base } = event;
  if (stamp !== null) {
    return stamp.period === phase
      ? { period: phase, elapsed: stamp.elapsed, running, atMs, base }
      : before;
  }
  if (before === null) return null;
  return { period: before.period, elapsed: projected(before, atMs), running, atMs, base };
}

const runningOf = (payload: unknown): boolean | null =>
  isRecord(payload) && typeof payload.running === 'boolean' ? payload.running : null;

/** An anchor's reading at `atMs` on its own clock, whole seconds: frozen when stopped. */
const projected = (anchor: ClockAnchor, atMs: number): number =>
  anchor.running
    ? anchor.elapsed + Math.max(0, Math.floor((atMs - anchor.atMs) / 1000))
    : anchor.elapsed;

/**
 * The clock an event's time is written in. A stand-in for this phone's accepted tap (an own event with no device link:
 * `sync.ts` keeps it at the phone's time) is the phone's; every event the server sent back is the server's, its own copy
 * of this phone's taps included. A queued tap is the phone's, at `createdAt`.
 */
export function anchorBase(event: LedgerEvent, ownEventIds: readonly string[]): ClockBase {
  return event.deviceLinkId === null && ownEventIds.includes(event.id) ? 'device' : 'server';
}

/**
 * The clock's reading, in whole seconds of `anchor.period`: 0 with no anchor; frozen while stopped; running on from the
 * anchor in the server's time (`deviceMs + offsetMs`), never back from it. An anchor on the phone's own clock is moved to
 * the server's by the same offset, so it reads the phone's own elapsed time.
 */
export function reading(
  anchor: ClockAnchor | null,
  now: { readonly deviceMs: number; readonly offsetMs: number },
): number {
  if (anchor === null) return 0;
  if (!anchor.running) return anchor.elapsed;
  const serverNow = now.deviceMs + now.offsetMs;
  const anchorServerMs = anchor.base === 'server' ? anchor.atMs : anchor.atMs + now.offsetMs;
  return anchor.elapsed + Math.max(0, Math.floor((serverNow - anchorServerMs) / 1000));
}

// ---------------------------------------------------------------------------------------------------------------
// Match time (ruling 108, 109)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Every clock period the cfg reaches, in play order, and its nominal length in seconds. The engine's own table
 * (`phaseLengths`, `football.ts`), which it does not export: `halfMinutes` for each half (or quarter) and
 * `extraTime.halfMinutes` for each extra-time half when extra time is on; `periodSeconds` overrides a group's periods
 * only when it gives the group unequal values (a uniform map says nothing the scalar does not, and the engine ignores it).
 */
export function periodLengths(cfg: FootballCfg): Readonly<Record<string, number>> {
  const regulation = cfg.halves === 4 ? ['H1', 'Q2', 'Q3', 'Q4'] : ['H1', 'H2'];
  const extra = cfg.extraTime.enabled ? ['ET_H1', 'ET_H2'] : [];
  return Object.fromEntries([
    ...groupLengths(regulation, cfg.halfMinutes * 60, cfg.periodSeconds),
    ...groupLengths(extra, cfg.extraTime.halfMinutes * 60, cfg.periodSeconds),
  ]);
}

function groupLengths(
  labels: readonly string[],
  seconds: number,
  overrides: Readonly<Record<string, number>> | undefined,
): (readonly [string, number])[] {
  const supplied = labels.map((label) => overrides?.[label]);
  const uniform = supplied.every((value) => value !== undefined && value === supplied[0]);
  return labels.map((label, i) => [label, uniform ? seconds : (supplied[i] ?? seconds)] as const);
}

/**
 * A stamp as football counts time from kick-off: within the period's nominal length, the seconds since kick-off; past it,
 * the time passed in added time. `endMinute` is the minute the period ends at (45, 90, 105, 120), floored. A period the
 * cfg does not reach has no end (`endMinute` is infinite): it reads its own seconds, as the web does.
 */
export type MatchTime =
  | { readonly kind: 'regular'; readonly seconds: number; readonly endMinute: number }
  | { readonly kind: 'added'; readonly endMinute: number; readonly overSeconds: number };

/** A negative or unreadable elapsed is the period's start; a fraction of a second is not counted (the web's rule). */
const wholeSeconds = (elapsed: number): number =>
  Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed) : 0;

export function matchTime(at: GameTime, cfg: FootballCfg): MatchTime {
  const elapsed = wholeSeconds(at.elapsed);
  const span = spanOf(at.period, cfg);
  if (span === null)
    return { kind: 'regular', seconds: elapsed, endMinute: Number.POSITIVE_INFINITY };
  const endMinute = Math.floor((span.start + span.length) / 60);
  if (elapsed <= span.length) return { kind: 'regular', seconds: span.start + elapsed, endMinute };
  return { kind: 'added', endMinute, overSeconds: elapsed - span.length };
}

/** A period's start (the lengths of the ones before it) and its length, or null for one the cfg does not reach. */
function spanOf(period: string, cfg: FootballCfg): { start: number; length: number } | null {
  let start = 0;
  for (const [label, length] of Object.entries(periodLengths(cfg))) {
    if (label === period) return { start, length };
    start += length;
  }
  return null;
}

/** `M:SS`, minutes unbounded ("125:30"). */
const minutesAndSeconds = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The clock face: "67:00", and in added time the time passed, "90+2:30" (ruling 109). */
export function clockText(t: MatchTime): string {
  return t.kind === 'regular'
    ? minutesAndSeconds(t.seconds)
    : `${t.endMinute}+${minutesAndSeconds(t.overSeconds)}`;
}

/**
 * The minute being played, as a scoresheet names it (ruling 109): "41'" at 40:10, "1'" at kick-off. A period's last
 * second is its first added minute ("45+1'" at 45:00); in added time, the added minute under way ("90+3'" at 90+2:30).
 */
export function minuteText(t: MatchTime): string {
  if (t.kind === 'added') return `${t.endMinute}+${Math.floor(t.overSeconds / 60) + 1}'`;
  const minute = Math.floor(t.seconds / 60) + 1;
  return minute > t.endMinute ? `${t.endMinute}+1'` : `${minute}'`;
}

// ---------------------------------------------------------------------------------------------------------------
// Stamping (design §7.3)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Every phase a stamp can name, in the order they are played: the whistle before kick-off, the engine's play phases,
 * then the kicks (H2 and Q2 never meet in one cfg, so one list orders both modes).
 */
export const PHASE_ORDER: readonly string[] = ['pre', ...footballPadRules.playPhases, 'SHOOTOUT'];

const rankOf = (period: string): number => PHASE_ORDER.indexOf(period);

/** The newest stamp of `events` (the standing ones, in stream order): the server's monotonic guard makes the last the highest. */
export function newestStamp(
  events: readonly { readonly type: string; readonly payload: unknown }[],
): GameTime | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const stamp = gameTimeOf(events[i]?.payload);
    if (stamp !== null) return stamp;
  }
  return null;
}

/**
 * A tap's stamp: the reading captured when its button was pressed, in the fold's phase, raised to the fold's `asOf` only
 * when that is in the same period. None when the clock knew no time, or the reading was of another period than the
 * fold's (the fold decides the period, §7.3: absent beats wrong).
 */
export function stampFor(
  captured: GameTime | null,
  phase: string,
  asOf: GameTime | null,
): GameTime | null {
  if (captured === null || captured.period !== phase) return null;
  const floor = asOf !== null && asOf.period === phase ? asOf.elapsed : 0;
  return { period: phase, elapsed: Math.max(captured.elapsed, floor) };
}

/**
 * A substitution's stamp, as the web stamps it: the fold's `asOf` while it is in the current phase, else none. Subs at
 * one stoppage share a stamp, and so count as one window (§7.3).
 */
export function subStamp(phase: string, asOf: GameTime | null): GameTime | null {
  return asOf !== null && asOf.period === phase ? asOf : null;
}

/**
 * A tap the ledger does not hold yet, stamped again against the fold it will meet (§7.3, ruling 3): `floor` is the
 * newest stamp standing before it, `phase` the fold's phase there. A stamp in a period the phase has left is dropped
 * rather than move a goal into the next half; a substitution takes its window's stamp (`subStamp`); any other stamp in
 * the floor's period below it is raised to it, never lowered. A payload with no stamp, or one naming a period no football
 * cfg has, is left as it is.
 */
export function restamp(
  type: string,
  payload: unknown,
  floor: GameTime | null,
  phase: string,
): unknown {
  const at = gameTimeOf(payload);
  if (at === null || rankOf(at.period) < 0) return payload;
  if (rankOf(at.period) < rankOf(phase)) return withStamp(payload, null);
  if (at.period !== phase || floor === null) return payload;
  if (type === 'football.sub') return withStamp(payload, subStamp(phase, floor));
  return floor.period === phase && at.elapsed < floor.elapsed ? withStamp(payload, floor) : payload;
}

/** The payload with `at` set to `stamp`, or with no `at` at all (the engine's schemas are strict: absent, never null). */
function withStamp(payload: unknown, stamp: GameTime | null): unknown {
  if (!isRecord(payload)) return payload;
  const { at: _replaced, ...rest } = payload;
  return stamp === null ? rest : { ...rest, at: stamp };
}
