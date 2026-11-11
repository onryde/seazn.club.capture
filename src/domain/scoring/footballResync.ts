import { gameTimeOf } from '@seazn/engine/core';
import { isRecord } from '@/domain/credentials/wire';
import {
  needsResync,
  nowOn,
  resyncTap,
  stampBase,
  type ClockBase,
  type OwnClockTap,
  type StampNow,
} from '@/domain/scoring/footballClock';
import type { FootballTap } from '@/domain/scoring/footballTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { copiesOf } from '@/domain/scoring/scoringMatchAsk';
import { ownIds, sameJson, type MatchState } from '@/domain/scoring/scoringMatchState';
import { voidTargetOf, type LedgerEvent } from '@/domain/scoring/wire';

/**
 * The watch for a Start accepted late (S2-5 design §7.2; the controller's ruling 2, Batch C), pure. A Start that waited in
 * the queue is sent as it was tapped, and the server records it when it arrives, so every other screen reads the clock
 * short by the wait. The watch sees each of this phone's running Starts into the queue and out of it: out by an accepted
 * answer, or by a read that holds its copy (its answer was lost). At that moment, if `needsResync` says so, it asks for
 * one resync built from the Start's own tap (`resyncTap`). Each Start is decided once, whatever the state it is seen on
 * again. The hook keeps the memory and taps what it asks for; if the app dies first, no resync is made (ruling 10).
 */

/**
 * A Start of this phone's in the queue: its tap, as the resync rule reads it, the clock its stamp is on (ruling 149), and
 * its payload, by which its event is known.
 */
type WaitingStart = OwnClockTap & { readonly base: ClockBase; readonly payload: unknown };

export type ResyncMemory = {
  /** The running Starts seen in the queue and not decided yet, by key. */
  readonly waiting: ReadonlyMap<string, WaitingStart>;
  /** The Starts decided: each left the queue once, resynced or not. */
  readonly decided: ReadonlySet<string>;
  /**
   * The events decided Starts landed as. Two Starts can carry one payload (a Start taken back, then the same Start
   * again): each event is one Start's, so a later Start is never read as an earlier one's event.
   */
  readonly claimed: ReadonlySet<string>;
};

export const NO_RESYNC: ResyncMemory = {
  waiting: new Map(),
  decided: new Set(),
  claimed: new Set(),
};

type ClockTap = Extract<FootballTap, { readonly kind: 'clock' }>;

/** What the watch remembers after a step, and the resyncs it asks for. */
type Stepped = { readonly memory: ResyncMemory; readonly taps: readonly ClockTap[] };

const CLOCK = 'football.clock';
const PERIOD = 'football.period';

/**
 * The watch over `state` at `now`: what it remembers now, and the resyncs it asks for. Each Start's wait is read on the
 * clock its own tap was stamped on (`nowOn`, ruling 149), never across the two; a server stamp's is read only on a fresh
 * offset (ruling 151), and until there is one it and the Starts after it stay waiting.
 */
export function resyncStep(memory: ResyncMemory, state: MatchState, now: StampNow): Stepped {
  const waiting = new Map(memory.waiting);
  const decided = new Set(memory.decided);
  const claimed = new Set(memory.claimed);
  watchQueue(state, waiting, decided);
  const voided = voidedOf(state);
  const taps: ClockTap[] = [];
  // In the order they were tapped, which is the order their events land in: the order they were first seen in the
  // queue, which only ever grows at its end. Never by their stamps, which may be on two clocks (ruling 149).
  for (const [key, start] of [...waiting]) {
    const nowMs = nowOn(start.base, now);
    // A server stamp's wait waits for a fresh offset (ruling 151); the Starts after it wait with it, in order.
    if (nowMs === null) break;
    const landed = landingOf(state, key, start, claimed);
    if (landed === 'queued') continue;
    waiting.delete(key);
    decided.add(key);
    if (landed === null) continue;
    claimed.add(landed.id);
    if (!voided.has(landed.id) && needsResync(start, nowMs, laterStands(state, landed, key))) {
      taps.push(resyncTap(start, nowMs));
    }
  }
  return { memory: { waiting, decided, claimed }, taps };
}

/**
 * The Starts in the queue, into `waiting`: a running clock tap that starts a stopped clock, judged at its first sighting
 * that says so (the watch may not see every state). Seen again, only its payload is read again, since the send may have
 * restamped it (`payloadForSend`) and its event is known by it; its time and its own reading stay as first seen, so a
 * stamp the restamp raised never moves the resync (the controller's ruling, final review, 2026-11-08).
 */
function watchQueue(
  state: MatchState,
  waiting: Map<string, WaitingStart>,
  decided: ReadonlySet<string>,
) {
  const { pending } = state.sync.queue;
  pending.forEach((tap, at) => {
    if (decided.has(tap.key)) return;
    const start = startOf(tap);
    const seen = waiting.get(tap.key);
    if (seen !== undefined) {
      if (start !== null) waiting.set(tap.key, { ...seen, payload: start.payload });
    } else if (start !== null && startsTheClock(state, pending.slice(0, at))) {
      waiting.set(tap.key, start);
    }
  });
}

/** A queued tap that is a running, stamped `football.clock` (a Start), as the watch remembers it; null for anything else. */
function startOf(tap: QueuedEvent): WaitingStart | null {
  if (tap.type !== CLOCK || tap.voidsKey !== undefined) return null;
  const stamp = gameTimeOf(tap.payload);
  if (!isRecord(tap.payload) || tap.payload.running !== true || stamp === null) return null;
  return {
    createdAtMs: Date.parse(tap.createdAt),
    base: stampBase(tap),
    running: true,
    period: stamp.period,
    elapsed: stamp.elapsed,
    payload: tap.payload,
  };
}

/**
 * Whether a running clock tap queued after `before` starts a stopped clock: the last clock event or period marker
 * standing before it (the ledger's, then this phone's taps queued before it, as the fold reads them) is
 * a Pause, a marker, or none. A running clock tap made while the clock runs is no Start: a resync (it would chain them)
 * or a Correct.
 */
function startsTheClock(state: MatchState, before: readonly QueuedEvent[]): boolean {
  const voided = voidedOf(state);
  const undone = new Set(
    before.flatMap((tap) => (tap.voidsKey === undefined ? [] : [tap.voidsKey])),
  );
  const events = [
    ...state.sync.ledger.filter((event) => !voided.has(event.id)),
    ...before.filter((tap) => tap.voidsKey === undefined && !undone.has(tap.key)),
  ];
  const last = events.findLast((event) => event.type === CLOCK || event.type === PERIOD);
  return last?.type !== CLOCK || !isRecord(last.payload) || last.payload.running !== true;
}

/**
 * Where a Start is: still `queued`; landed, as its ledger event, standing or voided (the copy a read holds while it is
 * still queued, or, once it left the queue, the first clock event of this phone's with its payload that no earlier Start
 * claimed: the stand-in an answer made, or the copy); or null, gone with no event (refused, or taken back before it was
 * sent). An older event of this phone's with the same payload is never a later Start's: a Start is one only on a stopped
 * clock (`startsTheClock`), so whatever stopped it stands after that event (`laterStands`).
 */
function landingOf(
  state: MatchState,
  key: string,
  start: WaitingStart,
  claimed: ReadonlySet<string>,
): LedgerEvent | 'queued' | null {
  const { ledger, queue } = state.sync;
  if (queue.pending.some((tap) => tap.key === key)) {
    return copiesOf(state, ledger).get(key) ?? 'queued';
  }
  const own = new Set(ownIds(state));
  const landed = ledger.find(
    (event) =>
      own.has(event.id) &&
      event.type === CLOCK &&
      !claimed.has(event.id) &&
      sameJson(event.payload, start.payload),
  );
  return landed ?? null;
}

/**
 * Whether a clock event or a period marker stands after the Start's: one in the ledger after it, or one this phone has
 * queued (a marker stops the clock, design §7.6). Either moved every screen's clock already, so no resync is wanted.
 */
function laterStands(state: MatchState, landed: LedgerEvent, key: string): boolean {
  const voided = voidedOf(state);
  const moves = (type: string) => type === CLOCK || type === PERIOD;
  const { pending } = state.sync.queue;
  const undone = new Set(
    pending.flatMap((tap) => (tap.voidsKey === undefined ? [] : [tap.voidsKey])),
  );
  return (
    state.sync.ledger.some(
      (event) => event.seq > landed.seq && moves(event.type) && !voided.has(event.id),
    ) ||
    pending.some(
      (tap) =>
        tap.key !== key && tap.voidsKey === undefined && moves(tap.type) && !undone.has(tap.key),
    )
  );
}

/** The ledger's events a void takes back: the ledger's own voids and this phone's queued ones. */
function voidedOf(state: MatchState): ReadonlySet<string> {
  const { ledger, queue } = state.sync;
  return new Set([
    ...ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])),
    ...queue.pending.flatMap((tap) => {
      const target = voidTargetOf(tap.type, tap.payload);
      return target === null ? [] : [target];
    }),
  ]);
}
