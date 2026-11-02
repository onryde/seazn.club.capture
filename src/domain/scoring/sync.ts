import { isRecord } from '@/domain/credentials/wire';
import type { MatchQueue, QueueDead, QueuedEvent } from '@/domain/scoring/queue';
import type { AppendAnswer, AppendBody, LedgerEvent } from '@/domain/scoring/wire';

/**
 * The rules that move a match's queue (design §6.3 and §7.3, plan S2-1 Task 6), pure. The hook (Task 9) owns the
 * clock, the port and the files: it asks `nextSend`, makes the call, hands the answer to `onAnswer` and does what the
 * effects say. Nothing here is a second state machine of the session: native owns that (AGENTS §2). This is the
 * phone's queue against the server's ledger, which the web's pad pipeline does too.
 *
 * Sport-agnostic: an event is a type and a payload the queue never reads, but for a void's target.
 */

export type SyncStatus = 'idle' | 'sending' | 'offline' | 'outdated' | 'dead';

/**
 * Why nothing is sent although the queue is not empty: a fetch the last answer asked for has not merged yet
 * (`ledger`), the rules it asked for have not come (`rules`), or the ledger or the rules moved and `revalidate` has
 * not run over the queue yet (`revalidate`). A send made before then would be made on a picture the answer just
 * called stale. `onFetchFailed` lets go of the first two, so a fetch that never lands cannot stop the queue for good.
 */
export type SyncHold = 'ledger' | 'rules' | 'revalidate';

export type SyncState = {
  /** The server's seq as this phone knows it: the `expected_seq` of the next send. Always the ledger's last seq. */
  readonly tip: number;
  /** What the server has, in seq order from 1, this phone's own accepted taps among it. */
  readonly ledger: readonly LedgerEvent[];
  readonly queue: MatchQueue;
  /** The rules version the phone holds: every send is made under it. */
  readonly rulesVersion: number;
  /** `foldEpochOf(sport)`, sent with every event; the server answers 426 when it is behind. */
  readonly engineEpoch: number;
  readonly status: SyncStatus;
  /** The key of the tap on its way to the server, or null: its fate is unknown until an answer comes. */
  readonly inFlight: string | null;
  /** No send before this time (ms, the caller's clock): the longest wait any answer asked for. */
  readonly notBefore: number;
  /** Conflicts in a row with no tap accepted between. */
  readonly conflictPasses: number;
  /** Rules changes in a row with no tap accepted between. */
  readonly rulesPasses: number;
  readonly hold: SyncHold | null;
  /** The key of the tap the server called ALREADY_DECIDED, held until the fetch it asked for says why. */
  readonly decidedProbe: string | null;
};

/** What the hook does next. Each is said once per answer; none is a promise about what the server will say. */
export type SyncEffect =
  | { readonly kind: 'send'; readonly body: AppendBody }
  | { readonly kind: 'fetchSince'; readonly seq: number }
  | { readonly kind: 'reloadRules' }
  /** Send nothing sooner than this; then ask `nextSend` again. A fetch made meanwhile does not start a send. */
  | { readonly kind: 'retryIn'; readonly ms: number }
  | { readonly kind: 'persist' }
  /** A tap left the queue without counting: the last-tap line says so. */
  | { readonly kind: 'refused'; readonly key: string; readonly code: string };

export type SyncStep = { readonly state: SyncState; readonly effects: readonly SyncEffect[] };

/** Conflicts (or rules changes) in a row before the sender waits instead of fetching and sending at once again. */
const PASSES_BEFORE_PAUSE = 3;
const PAUSE_MS = 15_000;
/** The wait after a fetch or a rules read that did not land, before sending on what is held. */
const FETCH_RETRY_MS = 5000;
/** The wait after the 1st, 2nd, ... send of one tap with no answer; the last holds from then on. */
const BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10_000, 15_000];
/** The word `refused` carries for a queued tap the ledger has made illegal: not a server's code, ours. */
export const NO_LONGER_LEGAL = 'NO_LONGER_LEGAL';
/** The engine's word for a rally after the outcome, and the web's for a locked fixture (`appendEvent`): 422. */
const ALREADY_DECIDED = 'ALREADY_DECIDED';
/** A 403 the web answers for a settled fixture's carried-forward result: the match is closed to this link. */
const RESULT_CARRIED_FORWARD = 'RESULT_CARRIED_FORWARD';
/** The ledger's mark of an organiser's lock. */
const FINALIZE = 'core.finalize';

const PERSIST: SyncEffect = { kind: 'persist' };
/** Where a send may start: not in flight, not waiting on an update, not dead. Offline is a retry. */
const SENDABLE: ReadonlySet<SyncStatus> = new Set<SyncStatus>(['idle', 'offline']);

const step = (state: SyncState, effects: readonly SyncEffect[]): SyncStep => ({ state, effects });

/**
 * A match opened from what was kept: its queue, and the ledger and rules the phone last held. Nothing is in flight; a
 * tap read back with attempts is unresolved (see `isUnresolved`). The queue is revalidated before anything is sent.
 */
export function openSync(held: {
  readonly queue: MatchQueue;
  readonly ledger: readonly LedgerEvent[];
  readonly rulesVersion: number;
  readonly engineEpoch: number;
}): SyncState {
  const { queue, ledger } = held;
  return {
    tip: ledger.length === 0 ? 0 : ledger[ledger.length - 1].seq,
    ledger,
    queue,
    rulesVersion: held.rulesVersion,
    engineEpoch: held.engineEpoch,
    status: queue.dead === null ? 'idle' : 'dead',
    inFlight: null,
    notBefore: 0,
    conflictPasses: 0,
    rulesPasses: 0,
    hold: queue.pending.length === 0 ? null : 'revalidate',
    decidedProbe: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// What to send
// ---------------------------------------------------------------------------------------------------------------

/**
 * The head of the queue as the server reads it, at the tip, or null: nothing queued, one already in flight, Update
 * needed, a dead queue, a fetch or a revalidation still owed (`hold`), or a wait not over (`now` is the caller's
 * clock, in the unit `notBefore` was set in).
 */
export function nextSend(state: SyncState, now: number): AppendBody | null {
  const head = state.queue.pending[0];
  if (head === undefined || state.queue.dead !== null || !SENDABLE.has(state.status)) return null;
  if (state.hold !== null || now < state.notBefore) return null;
  return {
    expected_seq: state.tip,
    type: head.type,
    payload: head.payload,
    idempotency_key: head.key,
    engine_epoch: state.engineEpoch,
    rules_version: state.rulesVersion,
  };
}

/**
 * The state once the hook has taken `nextSend`'s body to the port: one in flight, so no second, and the attempt
 * counted and to be saved BEFORE the POST goes: a kill after the server took the tap and before the answer then reads
 * back as "unresolved", never as a tap nobody sent. Nothing to send changes nothing.
 */
export function markSending(state: SyncState, now: number): SyncStep {
  const head = state.queue.pending[0];
  if (head === undefined || nextSend(state, now) === null) return step(state, []);
  const pending = [{ ...head, attempts: head.attempts + 1 }, ...state.queue.pending.slice(1)];
  const marked: SyncState = {
    ...state,
    status: 'sending',
    inFlight: head.key,
    queue: { ...state.queue, pending },
  };
  return step(marked, [PERSIST]);
}

/**
 * A tap whose fate the phone does not know: sent (or being sent) and not answered. It may be in the ledger already.
 * `revalidate` never drops it, and undo never deletes it: only an answer settles it.
 */
export function isUnresolved(state: SyncState, key: string): boolean {
  const tap = state.queue.pending.find((queued) => queued.key === key);
  return tap !== undefined && (tap.attempts > 0 || state.inFlight === tap.key);
}

/** Whether Undo may delete a queued tap outright: it is queued, and no send of it could have reached the server. */
export function canDiscardQueued(state: SyncState, key: string): boolean {
  return state.queue.pending.some((queued) => queued.key === key) && !isUnresolved(state, key);
}

/** Undo of a tap still only queued: it leaves the queue and is saved. One that is unresolved (or gone) changes nothing. */
export function discardQueued(state: SyncState, key: string): SyncStep {
  if (!canDiscardQueued(state, key)) return step(state, []);
  const pending = state.queue.pending.filter((queued) => queued.key !== key);
  return step({ ...state, queue: { ...state.queue, pending } }, [PERSIST]);
}

// ---------------------------------------------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------------------------------------------

/**
 * `sent` is the tap the answer is about, found by its key, not by its place. `now` is the caller's clock, for the
 * waits an answer asks for.
 */
export function onAnswer(
  state: SyncState,
  sent: QueuedEvent,
  answer: AppendAnswer,
  now: number,
): SyncStep {
  switch (answer.kind) {
    case 'accepted':
      return accepted(state, sent, answer, now);
    case 'seqConflict':
      return conflicted(state, sent, now);
    case 'rulesChanged':
      return rulesMoved(state, sent, answer.rulesVersion, now);
    case 'outdated':
      return stopped(state, sent, 'outdated');
    case 'linkDead':
      return died(state, sent, answer.code);
    case 'rateLimited':
      return waitFor(state, sent, answer.retryAfterMs, now);
    case 'offline':
      return wentOffline(state, sent, now);
    case 'refused':
      return refused(state, sent, answer.status, answer.code);
  }
}

type Accepted = Extract<AppendAnswer, { kind: 'accepted' }>;

/** The tap is on its way no more: the in-flight mark goes if it was the tap's. */
const landed = (state: SyncState, sent: QueuedEvent): SyncState =>
  state.inFlight === sent.key ? { ...state, inFlight: null } : state;

/**
 * An answer that says the tap was NOT stored (a conflict, new rules, an update, a throttle): its attempt is not one
 * the server may hold, so it counts as one nobody sent. The queue is saved if that changed it.
 */
function notStored(state: SyncState, sent: QueuedEvent): { state: SyncState; saved: SyncEffect[] } {
  const freed = landed(state, sent);
  const live = freed.queue.pending.find((queued) => queued.key === sent.key);
  if (live === undefined || live.attempts === 0) return { state: freed, saved: [] };
  const pending = freed.queue.pending.map((queued) =>
    queued.key === sent.key ? { ...queued, attempts: 0 } : queued,
  );
  return { state: { ...freed, queue: { ...freed.queue, pending } }, saved: [PERSIST] };
}

/**
 * The tap is the server's now: it joins the ledger and leaves the queue (design §6.3), and its event id is one of
 * this phone's own. An id already counted is a second delivery of an answer already taken: nothing changes, and
 * nothing is sent twice. Rules newer than the phone's, said in the answer, are fetched before anything else is sent.
 */
function accepted(state: SyncState, sent: QueuedEvent, answer: Accepted, now: number): SyncStep {
  if (state.queue.ownEventIds.includes(answer.eventId)) return step(state, []);
  const { ledger, tip, gap } = joined(state, sent, answer);
  const queue: MatchQueue = {
    ...state.queue,
    pending: state.queue.pending.filter((queued) => queued.key !== sent.key),
    ownEventIds: [...state.queue.ownEventIds, answer.eventId],
  };
  const settled: SyncState = {
    ...landed(state, sent),
    ledger,
    tip,
    queue,
    status: 'idle',
    notBefore: 0,
    conflictPasses: 0,
    rulesPasses: 0,
  };
  if (gap) return step({ ...settled, hold: 'ledger' }, [PERSIST, { kind: 'fetchSince', seq: tip }]);
  if (answer.rulesVersion > state.rulesVersion) {
    const newer: SyncState = { ...settled, rulesVersion: answer.rulesVersion, hold: 'rules' };
    return step(newer, [PERSIST, { kind: 'reloadRules' }]);
  }
  const body = nextSend(settled, now);
  if (body === null) return step(settled, [PERSIST]);
  return step(markSending(settled, now).state, [PERSIST, { kind: 'send', body }]);
}

/**
 * Where the accepted tap sits in the ledger. The server accepts only at `expected_seq`, so it lands at the tip + 1:
 * the ledger takes it from the tap itself (the answer carries no event) and the tip moves. One the ledger already
 * holds (a fetch brought it in while the answer was lost) is not added again. A seq it cannot place leaves a gap: the
 * hook fetches before it sends again. The tip is always the ledger's last seq, never ahead of it.
 */
function joined(
  state: SyncState,
  sent: QueuedEvent,
  answer: Accepted,
): { ledger: readonly LedgerEvent[]; tip: number; gap: boolean } {
  if (state.ledger.some((held) => held.id === answer.eventId)) {
    return { ledger: state.ledger, tip: state.tip, gap: false };
  }
  if (answer.seq !== state.tip + 1) return { ledger: state.ledger, tip: state.tip, gap: true };
  return { ledger: [...state.ledger, ledgerEventOf(sent, answer)], tip: answer.seq, gap: false };
}

/** The server's `recorded_at` and `device_link_id` are not in its answer: the tap's time, and no link. */
function ledgerEventOf(sent: QueuedEvent, answer: Accepted): LedgerEvent {
  return {
    id: answer.eventId,
    seq: answer.seq,
    type: sent.type,
    payload: sent.payload,
    recordedAt: sent.createdAt,
    voids: voidsOf(sent),
    deviceLinkId: null,
  };
}

/** The web sets a ledger event's `voids` from a `core.void`'s `payload.event_id`. */
function voidsOf(tap: QueuedEvent): string | null {
  if (tap.type !== 'core.void' || !isRecord(tap.payload)) return null;
  const target = tap.payload.event_id;
  return typeof target === 'string' ? target : null;
}

/**
 * The passes of a kind in a row: the count after this one, whether it is the one that pauses, and the wait it adds. A
 * pause sends nothing sooner than 15 s from `now`, and the count starts again.
 */
function pass(
  count: number,
  now: number,
): { count: number; effects: SyncEffect[]; notBefore: number | null } {
  const next = count + 1;
  if (next < PASSES_BEFORE_PAUSE) return { count: next, effects: [], notBefore: null };
  return { count: 0, effects: [{ kind: 'retryIn', ms: PAUSE_MS }], notBefore: now + PAUSE_MS };
}

/** Another scorer wrote first: fetch from the tip. Three in a row and the sender waits 15 s as well. */
function conflicted(state: SyncState, sent: QueuedEvent, now: number): SyncStep {
  const freed = notStored(state, sent);
  const passed = pass(state.conflictPasses, now);
  const next: SyncState = {
    ...freed.state,
    status: 'idle',
    hold: 'ledger',
    conflictPasses: passed.count,
    notBefore: passed.notBefore ?? freed.state.notBefore,
  };
  return step(next, [...freed.saved, { kind: 'fetchSince', seq: state.tip }, ...passed.effects]);
}

/**
 * The organiser changed the rules: take the version the server named (never a lower one), fetch the rules, and send
 * nothing until `onRules` and `revalidate` have been. Three in a row and the sender waits 15 s as well.
 */
function rulesMoved(state: SyncState, sent: QueuedEvent, named: number, now: number): SyncStep {
  const freed = notStored(state, sent);
  const passed = pass(state.rulesPasses, now);
  const next: SyncState = {
    ...freed.state,
    status: 'idle',
    hold: 'rules',
    rulesVersion: Math.max(state.rulesVersion, named),
    rulesPasses: passed.count,
    notBefore: passed.notBefore ?? freed.state.notBefore,
  };
  return step(next, [...freed.saved, { kind: 'reloadRules' }, ...passed.effects]);
}

/** Update needed: the queue is kept and saved, nothing more is sent. */
function stopped(state: SyncState, sent: QueuedEvent, status: 'outdated'): SyncStep {
  const freed = notStored(state, sent);
  return step({ ...freed.state, status }, [PERSIST]);
}

/** A throttle: nothing is sent for as long as the server said. */
function waitFor(state: SyncState, sent: QueuedEvent, ms: number, now: number): SyncStep {
  const freed = notStored(state, sent);
  const next: SyncState = { ...freed.state, status: 'idle', notBefore: now + ms };
  return step(next, [...freed.saved, { kind: 'retryIn', ms }]);
}

/** The queue can send no more: the taps are kept as they are, and saved with the word. */
function died(state: SyncState, sent: QueuedEvent, dead: QueueDead): SyncStep {
  const freed = landed(state, sent);
  return step({ ...freed, status: 'dead', queue: { ...freed.queue, dead } }, [PERSIST]);
}

/**
 * No answer: the tap stays, with its key, its attempt already counted when it was sent (`markSending`), and is tried
 * again after a wait that grows to 15 s. It may be in the ledger: it stays unresolved until a resend is answered.
 */
function wentOffline(state: SyncState, sent: QueuedEvent, now: number): SyncStep {
  const live = state.queue.pending.find((queued) => queued.key === sent.key);
  const attempts = Math.max(live?.attempts ?? 0, 1);
  const ms = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
  const next: SyncState = { ...landed(state, sent), status: 'offline', notBefore: now + ms };
  return step(next, [{ kind: 'retryIn', ms }]);
}

/**
 * Which refusals close the whole queue, not one tap (the web's `statusCode` and `scoring.ts`): a 401 is a link the door
 * does not take, 402 an account that must pay, 403 a result carried forward (the match is finalized) or a write this
 * link may not make, 404 a match that is gone. Everything else the engine says (400, 422, 409) is about one tap.
 */
function closes(status: number, code: string): QueueDead | null {
  if (status === 401) return 'LINK_INVALID';
  if (status === 402) return 'payment';
  if (status === 403) return code === RESULT_CARRIED_FORWARD ? 'finalized' : 'forbidden';
  return status === 404 ? 'gone' : null;
}

/**
 * Any other 4xx: that tap leaves the queue and did not count; the ledger is fetched again. A whole-queue refusal
 * (`closes`) keeps every tap and sends no more. ALREADY_DECIDED holds the tap until a fetch says whether the match is
 * locked (then the queue is dead) or only decided (then the tap is refused).
 */
function refused(state: SyncState, sent: QueuedEvent, status: number, code: string): SyncStep {
  const dead = closes(status, code);
  if (dead !== null) return died(state, sent, dead);
  const freed = landed(state, sent);
  if (code === ALREADY_DECIDED) {
    const held: SyncState = { ...freed, status: 'idle', hold: 'ledger', decidedProbe: sent.key };
    return step(held, [{ kind: 'fetchSince', seq: state.tip }]);
  }
  const pending = freed.queue.pending.filter((queued) => queued.key !== sent.key);
  return step({ ...freed, status: 'idle', queue: { ...freed.queue, pending } }, [
    { kind: 'refused', key: sent.key, code },
    { kind: 'fetchSince', seq: state.tip },
    PERSIST,
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// The ledger moves; so does what is legal
// ---------------------------------------------------------------------------------------------------------------

/**
 * Events fetched, merged into the ledger: they must continue it, the first at the tip + 1 and each one after the
 * last, or the batch is refused whole and fetched again (a ledger with a hole would fold into a match that never
 * was). The tip is the last seq. The queue, the status and the counts are the answers' to move, but for a tap held on
 * ALREADY_DECIDED: a ledger that shows the match locked kills the queue, any other refuses that tap. New events hold
 * the queue until `revalidate` has run.
 */
export function onLedger(state: SyncState, events: readonly LedgerEvent[]): SyncStep {
  if (events.length > 0 && !continues(state, events)) {
    return step(state, [{ kind: 'fetchSince', seq: state.tip }]);
  }
  const merged = events.length === 0 ? state : mergedWith(state, events);
  const cleared: SyncState = { ...merged, hold: heldAfter(state, events.length > 0) };
  return state.decidedProbe === null
    ? step(same(state, cleared), [])
    : probed(cleared, state.decidedProbe);
}

const continues = (state: SyncState, events: readonly LedgerEvent[]): boolean =>
  events.every((event, i) => event.seq === state.tip + 1 + i);

function mergedWith(state: SyncState, events: readonly LedgerEvent[]): SyncState {
  const ledger = [...state.ledger, ...events];
  return { ...state, ledger, tip: ledger[ledger.length - 1].seq };
}

/**
 * The hold once a fetch has landed: a fetch asked for is answered; new events want the queue looked at again, but not
 * before the rules a pending reload asked for have come.
 */
function heldAfter(state: SyncState, moved: boolean): SyncHold | null {
  if (state.hold === 'rules') return 'rules';
  if (moved) return 'revalidate';
  return state.hold === 'ledger' ? null : state.hold;
}

/** `cleared` is the state, or `state` itself when nothing about it changed (so a no-op stays the same object). */
const same = (state: SyncState, cleared: SyncState): SyncState =>
  cleared.ledger === state.ledger && cleared.hold === state.hold ? state : cleared;

/** The fetch a held ALREADY_DECIDED asked for has landed: a locked match closes the queue, else the tap is refused. */
function probed(state: SyncState, key: string): SyncStep {
  const cleared: SyncState = { ...state, decidedProbe: null };
  if (lockedBy(state.ledger)) {
    return step({ ...cleared, status: 'dead', queue: { ...cleared.queue, dead: 'finalized' } }, [
      PERSIST,
    ]);
  }
  if (!cleared.queue.pending.some((queued) => queued.key === key)) return step(cleared, []);
  const pending = cleared.queue.pending.filter((queued) => queued.key !== key);
  return step({ ...cleared, queue: { ...cleared.queue, pending } }, [
    { kind: 'refused', key, code: ALREADY_DECIDED },
    PERSIST,
  ]);
}

/** The organiser's lock is in the ledger, and nothing voids it. */
function lockedBy(ledger: readonly LedgerEvent[]): boolean {
  const voided = new Set(ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])));
  return ledger.some((event) => event.type === FINALIZE && !voided.has(event.id));
}

/**
 * The rules a fetch brought: the phone takes the higher version, never a lower (a read lagging behind the answer that
 * asked for it is no news), and the queue is looked at again before anything is sent. The hook adopts the rules' own
 * cfg only when its version is the one held now.
 */
export function onRules(state: SyncState, rules: { readonly rulesVersion: number }): SyncState {
  const rulesVersion = Math.max(state.rulesVersion, rules.rulesVersion);
  const hold = state.hold === 'ledger' ? 'ledger' : 'revalidate';
  return { ...state, rulesVersion, hold };
}

/**
 * A fetch or a rules read that did not land: let go of the hold it asked for, and wait before sending on what is
 * held. The send then finds out again (a conflict, new rules, a refusal) and asks again, at the pace the passes set.
 */
export function onFetchFailed(state: SyncState, now: number): SyncStep {
  if (state.hold !== 'ledger' && state.hold !== 'rules') return step(state, []);
  const next: SyncState = {
    ...state,
    hold: null,
    decidedProbe: null,
    notBefore: Math.max(state.notBefore, now + FETCH_RETRY_MS),
  };
  return step(next, [{ kind: 'retryIn', ms: FETCH_RETRY_MS }]);
}

/**
 * After the ledger or the rules moved: keep the queued taps `legal` names (the fold's `legalQueued`, Task 7), in the
 * queue's own order, and drop the rest, each said once as not counted. A tap the new ledger makes illegal never goes
 * to the server; one nobody queued is never added. A tap whose fate is unknown (`isUnresolved`) is never dropped: it
 * may be in the ledger already, and only the server's answer to its resend says. Lifts the `revalidate` hold.
 */
export function revalidate(
  state: SyncState,
  legal: (queued: readonly QueuedEvent[]) => readonly string[],
): SyncStep {
  const released: SyncState = state.hold === 'revalidate' ? { ...state, hold: null } : state;
  if (state.queue.pending.length === 0) return step(released, []);
  const keep = new Set(legal(state.queue.pending));
  const dropped = state.queue.pending.filter(
    (queued) => !keep.has(queued.key) && !isUnresolved(state, queued.key),
  );
  if (dropped.length === 0) return step(released, []);
  const pending = state.queue.pending.filter((queued) => !dropped.includes(queued));
  const refusals = dropped.map((queued): SyncEffect => ({
    kind: 'refused',
    key: queued.key,
    code: NO_LONGER_LEGAL,
  }));
  return step({ ...released, queue: { ...released.queue, pending } }, [...refusals, PERSIST]);
}
