import type { SportTypes } from '@/domain/scoring/scoringSport';
import {
  deadOf,
  isOutdated,
  part,
  sameJson,
  type MatchState,
  type Part,
} from '@/domain/scoring/scoringMatchState';
import { type SyncState, isAsking, isUnresolved, withoutQuestion } from '@/domain/scoring/sync';
import type { MatchQueue } from '@/domain/scoring/queue';
import type { LedgerEvent } from '@/domain/scoring/wire';

/**
 * The reconnect question (owner ruling 43, 2026-11-02). The owner scored offline, someone scored on the web, and the
 * phone then fetched the web's events and sent its own taps on top: two people scoring the same rallies count them
 * twice. So when a fetch brings in events this phone did not make while it has taps queued, nothing is sent until the
 * scorer chooses: send the taps (judged again on the ledger as it stands, as every send is) or discard them. A phone
 * with only its own taps offline asks nothing. The question is kept in the queue file (`MatchQueue.askedAbout`), so it
 * survives a kill. A sender with no screen (`judge: 'trust'`) holds without asking and sends nothing while it stands.
 */

/** What the question tells the scorer: the events scored elsewhere that still stand, and the taps waiting to go. */
export type Ask = { readonly foreign: number; readonly queued: number };

const VOID = 'core.void';

/** An event that takes another back is never scored: what it takes back is what counts, or does not. */
const isVoid = (event: LedgerEvent): boolean => event.type === VOID || event.voids !== null;

/**
 * The phone's clock may run behind the server's, and a tap is stamped by the phone while an event is stamped by the
 * server: an event recorded up to this long before the oldest queued tap still counts as made on top of it. Anything
 * older is history (a ledger cache lost with a kill brings all of it back), not another scorer scoring on the phone's
 * rallies. Two minutes (round 4, item 2; the controller's ruling, 2026-11-03).
 */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * The earliest `recordedAt` that can be about the taps queued: the oldest tap's time less the margin. A time that cannot
 * be read gives NaN, which no event is earlier than, so everything counts: asked about, never dropped.
 */
function recordedFloor(state: MatchState): number {
  const times = state.sync.queue.pending.map((tap) => Date.parse(tap.createdAt));
  return Math.min(...times) - CLOCK_SKEW_MS;
}

/** Whether `event` was recorded since `floor` (an event with a time that cannot be read was). */
const recordedSince = (event: LedgerEvent, floor: number): boolean =>
  !(Date.parse(event.recordedAt) < floor);

/**
 * Of `events`, the ledger's copy of each queued tap whose fate is unknown (it was sent, or may have been, and no answer
 * came): by its type and its payload, in any key order, written by this phone's link (a co-scorer's identical rally is
 * theirs, and counts), recorded since the oldest tap was made, at the seq it was sent at plus one when it is the tap in
 * flight. Each tap has at most one copy and each event is the copy of at most one tap, the latest tap taking the latest
 * event (an older identical event is what the phone made before). An event whose id this phone already owns is nobody's
 * copy.
 */
export function copiesOf(
  state: MatchState,
  events: readonly LedgerEvent[],
): ReadonlyMap<string, LedgerEvent> {
  const { sync, bootstrap, sent } = state;
  const owned = new Set(sync.queue.ownEventIds);
  const floor = recordedFloor(state);
  const latestFirst = events.filter((event) => recordedSince(event, floor)).reverse();
  const taken = new Set<string>();
  const found = new Map<string, LedgerEvent>();
  for (const tap of [...sync.queue.pending].reverse()) {
    if (!isUnresolved(sync, tap.key)) continue;
    const mine = (event: LedgerEvent): boolean =>
      bootstrap === null || event.deviceLinkId === null || event.deviceLinkId === bootstrap.linkId;
    const atSeq = (event: LedgerEvent): boolean =>
      sent?.key !== tap.key || event.seq === sent.expectedSeq + 1;
    const copy = latestFirst.find(
      (event) =>
        !owned.has(event.id) &&
        !taken.has(event.id) &&
        event.type === tap.type &&
        sameJson(event.payload, tap.payload) &&
        mine(event) &&
        atSeq(event),
    );
    if (copy === undefined) continue;
    taken.add(copy.id);
    found.set(tap.key, copy);
  }
  return new Map(
    sync.queue.pending.flatMap((tap) =>
      found.has(tap.key) ? [[tap.key, found.get(tap.key)!]] : [],
    ),
  );
}

/** The events of `fresh` another scorer made: not a void, not this phone's own, not the copy of one of its taps, and recorded since its taps were made. */
function foreignIn(state: MatchState, fresh: readonly LedgerEvent[]): readonly string[] {
  const owned = new Set(state.sync.queue.ownEventIds);
  const copies = new Set([...copiesOf(state, fresh).values()].map((copy) => copy.id));
  const floor = recordedFloor(state);
  return fresh
    .filter(
      (event) =>
        !isVoid(event) &&
        !owned.has(event.id) &&
        !copies.has(event.id) &&
        recordedSince(event, floor),
    )
    .map((event) => event.id);
}

/** How many of the events still stand: a void in the ledger (another scorer's Undo, or this phone's) takes one away. */
function standing(ledger: readonly LedgerEvent[], ids: readonly string[]): number {
  const voided = new Set(ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])));
  return ids.filter((id) => !voided.has(id)).length;
}

/**
 * A fetch merged `fresh` into the ledger: if it holds events another scorer made, and this phone has taps queued on a
 * link that still takes them, the question stands (and grows with each such fetch while it is open). Events that came
 * and were taken back in the same breath ask nothing.
 */
export function noteForeign<S extends SportTypes>(
  state: MatchState<S>,
  fresh: readonly LedgerEvent[],
): MatchState<S> {
  const { queue } = state.sync;
  if (queue.pending.length === 0 || queue.dead !== null) return state;
  if (answeredFor(queue)) return state;
  const held = queue.askedAbout ?? [];
  const added = foreignIn(state, fresh).filter((id) => !held.includes(id));
  if (added.length === 0) return state;
  const about = [...held, ...added];
  if (!isAsking(state.sync) && standing(state.sync.ledger, about) === 0) return state;
  return { ...state, sync: { ...state.sync, queue: { ...queue, askedAbout: about } } };
}

/**
 * Whether the scorer has already said Send for every tap waiting: one answer covers the queue as it stood (round 4, item
 * 1b), so its drain is not asked about again, whoever scores meanwhile. A tap queued since is not covered.
 */
function answeredFor(queue: MatchQueue): boolean {
  const covered = queue.answeredSend ?? [];
  return queue.pending.every((tap) => covered.includes(tap.key));
}

/**
 * What the question is, or null when none stands that the scorer can answer (a dead link, an app too old, nothing left to
 * ask). The tap in flight is not counted: it is sent, and whatever is answered its answer lands as any late answer does.
 */
export function askOf(state: MatchState): Ask | null {
  const { queue, ledger } = state.sync;
  if (queue.askedAbout === undefined || deadOf(state) !== null || isOutdated(state)) return null;
  const foreign = standing(ledger, queue.askedAbout);
  const waiting = queue.pending.filter((tap) => tap.key !== state.sync.inFlight).length;
  return foreign === 0 || waiting === 0 ? null : { foreign, queued: waiting };
}

/**
 * A question whose events were all taken back since is no question: the taps go on, judged again on the ledger as it
 * stands. Called by `step` before the pump, so the release and the send are one step.
 */
export function releaseMoot<S extends SportTypes>(state: MatchState<S>): MatchState<S> {
  const { sync } = state;
  const about = sync.queue.askedAbout;
  if (about === undefined || standing(sync.ledger, about) > 0) return state;
  return { ...state, sync: { ...sync, queue: withoutQuestion(sync.queue), ...judgedAgain(sync) } };
}

/** The queue is judged again before anything goes: now if nothing else stands in the way, else when that lands. */
function judgedAgain(sync: SyncState): Pick<SyncState, 'hold' | 'revalidateOwed'> {
  return sync.hold === null
    ? { hold: 'revalidate', revalidateOwed: sync.revalidateOwed }
    : { hold: sync.hold, revalidateOwed: true };
}

/**
 * The scorer's answer. Send: the question is over, the queue judged again on the ledger as it stands and then sent, as
 * any queue is. Discard: every queued tap goes, but one the ledger already holds (the answer to it was lost): that
 * event is this phone's own, and stays, for History and Undo. Nothing asked: nothing happens, so a second tap on a
 * button that has gone changes nothing.
 */
export function onAnswerAsk<S extends SportTypes>(
  state: MatchState<S>,
  answer: 'send' | 'discard',
): Part<S> {
  const { sync } = state;
  if (!isAsking(sync)) return part(state);
  const queue = withoutQuestion(sync.queue);
  if (answer === 'send') {
    const answered = { ...queue, answeredSend: queue.pending.map((tap) => tap.key) };
    return part({ ...state, sync: { ...sync, queue: answered, ...judgedAgain(sync) } });
  }
  const adopted = [...copiesOf(state, sync.ledger).values()].map((copy) => copy.id);
  const next = {
    ...queue,
    pending: [],
    ownEventIds: [...queue.ownEventIds, ...adopted],
  };
  return part({ ...state, sent: null, sync: { ...sync, queue: next, inFlight: null } });
}

/** Whether the record has said the question: not yet, said and standing, or said moot while a dead link hides it. */
export type AskSaid = 'idle' | 'open' | 'mooted';

/** A line the record gets of the question: it begins (the counts), or it ends (the answer, or moot). */
export type AskLine =
  | { readonly event: 'scoring.ask'; readonly fields: Ask }
  | {
      readonly event: 'scoring.asked';
      readonly fields: { readonly answer: 'send' | 'discard' | 'moot' };
    };

const sayAsked = (answer: 'send' | 'discard' | 'moot'): AskLine => ({
  event: 'scoring.asked',
  fields: { answer },
});

/**
 * What the record says after this step, and how much of the question it has said (round 4, items 4 and 7). It says the
 * question once when it begins and once when it ends, with the answer, or moot when it ended by itself (everything it was
 * about was taken back, or no taps were left). A question a dead link hides (a revoked link, a match closed) is moot for as
 * long as the link is dead: that is said once, and when the link is back the same question stands again, not said as a new
 * one. One an app too old hides has not ended and says nothing. `answered` is the scorer's answer in this step, if any.
 */
export function askSaying(
  said: AskSaid,
  state: MatchState,
  answered: 'send' | 'discard' | null,
): { readonly said: AskSaid; readonly line: AskLine | null } {
  const ask = askOf(state);
  if (ask !== null) {
    return { said: 'open', line: said === 'idle' ? { event: 'scoring.ask', fields: ask } : null };
  }
  if (said === 'idle') return { said, line: null };
  if (isAsking(state.sync)) {
    return said === 'open' && deadOf(state) !== null
      ? { said: 'mooted', line: sayAsked('moot') }
      : { said, line: null };
  }
  const line = answered ?? (said === 'open' ? 'moot' : null);
  return { said: 'idle', line: line === null ? null : sayAsked(line) };
}
