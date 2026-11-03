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
 * Of `events`, the ledger's copy of each queued tap whose fate is unknown (it was sent, or may have been, and no answer
 * came): by its type and its payload, in any key order, written by this phone's link (a co-scorer's identical rally is
 * theirs, and counts), at the seq it was sent at plus one when it is the tap in flight. Each tap has at most one copy and
 * each event is the copy of at most one tap, in order. An event whose id this phone already owns is nobody's copy.
 */
export function copiesOf(
  state: MatchState,
  events: readonly LedgerEvent[],
): ReadonlyMap<string, LedgerEvent> {
  const { sync, bootstrap, sent } = state;
  const owned = new Set(sync.queue.ownEventIds);
  const taken = new Set<string>();
  const copies = new Map<string, LedgerEvent>();
  for (const tap of sync.queue.pending) {
    if (!isUnresolved(sync, tap.key)) continue;
    const mine = (event: LedgerEvent): boolean =>
      bootstrap === null || event.deviceLinkId === null || event.deviceLinkId === bootstrap.linkId;
    const atSeq = (event: LedgerEvent): boolean =>
      sent?.key !== tap.key || event.seq === sent.expectedSeq + 1;
    const copy = events.find(
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
    copies.set(tap.key, copy);
  }
  return copies;
}

/** The events of `fresh` another scorer made: not a void, not this phone's own, not the copy of one of its taps. */
function foreignIn(state: MatchState, fresh: readonly LedgerEvent[]): readonly string[] {
  const owned = new Set(state.sync.queue.ownEventIds);
  const copies = new Set([...copiesOf(state, fresh).values()].map((copy) => copy.id));
  return fresh
    .filter((event) => !isVoid(event) && !owned.has(event.id) && !copies.has(event.id))
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
  const held = queue.askedAbout ?? [];
  const added = foreignIn(state, fresh).filter((id) => !held.includes(id));
  if (added.length === 0) return state;
  const about = [...held, ...added];
  if (!isAsking(state.sync) && standing(state.sync.ledger, about) === 0) return state;
  return { ...state, sync: { ...state.sync, queue: { ...queue, askedAbout: about } } };
}

/** What the question is, or null when none stands that the scorer can answer (a dead link, an app too old, nothing left to ask). */
export function askOf(state: MatchState): Ask | null {
  const { queue, ledger } = state.sync;
  if (queue.askedAbout === undefined || deadOf(state) !== null || isOutdated(state)) return null;
  const foreign = standing(ledger, queue.askedAbout);
  return foreign === 0 ? null : { foreign, queued: queue.pending.length };
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
  if (answer === 'send') return part({ ...state, sync: { ...sync, queue, ...judgedAgain(sync) } });
  const adopted = [...copiesOf(state, sync.ledger).values()].map((copy) => copy.id);
  const next = { ...queue, pending: [], ownEventIds: [...queue.ownEventIds, ...adopted] };
  return part({ ...state, sent: null, sync: { ...sync, queue: next, inFlight: null } });
}
