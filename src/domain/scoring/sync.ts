import type { MatchQueue, QueueDead, QueuedEvent } from '@/domain/scoring/queue';
import {
  voidTargetOf,
  type AppendAnswer,
  type AppendBody,
  type LedgerEvent,
  type ReadFailure,
} from '@/domain/scoring/wire';

/**
 * The rules that move a match's queue (design §6.3 and §7.3, plan S2-1 Task 6), pure. The hook (Task 9) owns the
 * clock, the port and the files: it asks `nextSend`, makes the call, hands the answer to `onAnswer` and does what the
 * effects say. Nothing here is a second state machine of the session: native owns that (AGENTS §2). This is the
 * phone's queue against the server's ledger, which the web's pad pipeline does too.
 *
 * Sport-agnostic: an event is a type and a payload the queue never reads, but for a void's target.
 */

/**
 * `tooLarge`: the ledger came back over the read's size cap, so this build cannot know the tip. It is a state the
 * operator is told, not a network failure: nothing is retried and nothing is sent.
 */
export type SyncStatus = 'idle' | 'sending' | 'offline' | 'outdated' | 'dead' | 'tooLarge';

/**
 * Why nothing is sent although the queue is not empty: a fetch the last answer asked for has not merged yet
 * (`ledger`), the rules it asked for have not come (`rules`), the match's status it asked for has not come
 * (`status`), or the ledger or the rules moved and `revalidate` has not run over the queue yet (`revalidate`). A send
 * made before then would be made on a picture the answer just called stale. `onFetchFailed` lets go of the first
 * three, so a read that never lands cannot stop the queue for good.
 */
export type SyncHold = 'ledger' | 'rules' | 'status' | 'revalidate';

export type SyncState = {
  /** The server's seq as this phone knows it: the `expected_seq` of the next send. Always the ledger's last seq. */
  readonly tip: number;
  /** What the server has, in seq order from 1, this phone's own accepted taps among it. */
  readonly ledger: readonly LedgerEvent[];
  readonly queue: MatchQueue;
  /**
   * The rules version the phone holds: every send is made under it. It moves only when the rules themselves arrive
   * (`onRules`), never when an answer merely names a newer version: a rules read that fails must leave the phone
   * sending under the old version, so the server says so again.
   */
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
  /** The key of the tap the server called ALREADY_DECIDED, held until the match's status (`onBootstrapStatus`) says why. */
  readonly decidedProbe: string | null;
  /**
   * A revalidation that has not judged the queue yet: it was lifted over a head of unknown fate (`revalidate`), or the
   * rules came while a ledger or a status read was still owed. It is done before the next send, whichever answer or
   * fetch comes first.
   */
  readonly revalidateOwed: boolean;
  /**
   * When a rules read that failed is to be tried again (the caller's clock), or null. A failed read leaves the phone
   * on the rules it holds; with nothing queued no send provokes the next FIXTURE_RULES_CHANGED, so the read itself
   * is asked for again (`retryRules`).
   */
  readonly rulesRetryAt: number | null;
  /**
   * The version the last FIXTURE_RULES_CHANGED named, until the rules read answers it (`onRules`) or a tap is accepted.
   * The web refuses any version but its own (`!==`), so a refusal that names a version BELOW the one held says the phone
   * is ahead of the server, which only a phone that guessed can be: the rules read of that same version is then taken
   * though it is lower. Any other lower read is one lagging behind, and is no news.
   */
  readonly rulesSaid: number | null;
  /**
   * The refusals in a row by which the server answered and did not take the tap (a conflict, or new rules), counted
   * together across the pauses that reset the passes, and ended when a tap is accepted or the queue empties. It is what
   * `stallOf` reads: a server that answers every time and never takes the tap is a stall, not a slow network.
   */
  readonly refusedRun: RefusedRun | null;
};

/**
 * Refusals in a row, the latest kind named. `decided` is an ALREADY_DECIDED whose status read never landed (`letGo`): the
 * server answered the send and the phone never learned why, so the tap goes again.
 */
export type RefusedRun = { readonly by: 'conflict' | 'rules' | 'decided'; readonly count: number };

/** What the hook does next. Each is said once per answer; none is a promise about what the server will say. */
export type SyncEffect =
  | { readonly kind: 'send'; readonly body: AppendBody }
  | { readonly kind: 'fetchSince'; readonly seq: number }
  | { readonly kind: 'reloadRules' }
  /** Read the match's bootstrap again, for its `status` (`onBootstrapStatus`): a tap was refused ALREADY_DECIDED. */
  | { readonly kind: 'reloadBootstrap' }
  /** Send nothing sooner than this; then ask `nextSend` again. A fetch made meanwhile does not start a send. */
  | { readonly kind: 'retryIn'; readonly ms: number }
  | { readonly kind: 'persist' }
  /** A tap left the queue without counting: the last-tap line says so. */
  | { readonly kind: 'refused'; readonly key: string; readonly code: string };

export type SyncStep = { readonly state: SyncState; readonly effects: readonly SyncEffect[] };

/** Conflicts (or rules changes) in a row before the sender waits instead of fetching and sending at once again. */
const PASSES_BEFORE_PAUSE = 3;
const PAUSE_MS = 15_000;
/**
 * Refusals in a row (`refusedRun`) after which the server answering and never taking a tap is a stall (`stallOf`, the
 * record's `scoring.stalled`, the pad's can't-send badge). From then on a pause is `STALLED_PAUSE_MS`: a phone that cannot
 * get a tap through stops asking every 15 s (review, 2026-11-02).
 */
export const STALL_AFTER = 6;
const STALLED_PAUSE_MS = 60_000;
/** The wait after a fetch or a rules read that did not land, before sending on what is held. */
const FETCH_RETRY_MS = 5000;
/** The wait after a rules read that did not land, before it is asked for again (and the queue sends on what is held). */
const RULES_RETRY_MS = 15_000;
/** The wait after the 1st, 2nd, ... send of one tap with no answer; the last holds from then on. */
const BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10_000, 15_000];
/** The word `refused` carries for a queued tap the ledger has made illegal: not a server's code, ours. */
export const NO_LONGER_LEGAL = 'NO_LONGER_LEGAL';
/** The engine's word for a rally after the outcome, and the web's for a locked fixture (`appendEvent`): 422. */
const ALREADY_DECIDED = 'ALREADY_DECIDED';
/** A 403 the web answers for a settled fixture's carried-forward result: the match is closed to this link. */
const RESULT_CARRIED_FORWARD = 'RESULT_CARRIED_FORWARD';
/** The taps whose bare 403 is about that tap alone: the web refuses a link's void of an event that is not its own (or of a finalized fixture) and a forfeit only an organiser may record. */
const ONE_TAP_403: ReadonlySet<string> = new Set(['core.void', 'core.forfeit']);

const PERSIST: SyncEffect = { kind: 'persist' };
/** Where a send may start: not in flight, not waiting on an update, not dead. Offline is a retry. */
const SENDABLE: ReadonlySet<SyncStatus> = new Set<SyncStatus>(['idle', 'offline']);

/**
 * Every transition ends here. A refusal run with nothing queued is over, whichever way the queue emptied (an accept, an
 * Undo of a queued tap, a tap refused for good, a revalidation): a new tap starts a run of its own, not the last one's
 * sixth (review, 2026-11-02).
 */
const step = (state: SyncState, effects: readonly SyncEffect[]): SyncStep => ({
  state: settled(state),
  effects,
});

/**
 * With nothing queued there is nothing to count or to ask: the refusal run is over, and so is a reconnect question
 * (`askedAbout`: the scorer has no taps left to send or discard).
 */
function settled(state: SyncState): SyncState {
  if (state.queue.pending.length > 0) return state;
  const run = state.refusedRun === null ? state : { ...state, refusedRun: null };
  return run.queue.askedAbout === undefined ? run : { ...run, queue: withoutQuestion(run.queue) };
}

/** The queue with no reconnect question standing (a copy: the file's other fields are untouched). */
export const withoutQuestion = (queue: MatchQueue): MatchQueue => ({
  ...queue,
  askedAbout: undefined,
});

/** Whether the reconnect question stands: another scorer's events landed on this phone's queued taps, and nothing is sent until it is answered. */
export const isAsking = (state: SyncState): boolean => state.queue.askedAbout !== undefined;

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
    revalidateOwed: false,
    rulesRetryAt: null,
    rulesSaid: null,
    refusedRun: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// What to send
// ---------------------------------------------------------------------------------------------------------------

/**
 * The head of the queue as the server reads it, at the tip, or null: nothing queued, one already in flight, Update
 * needed, a dead queue, a fetch or a revalidation still owed (`hold`), or a wait not over (`now` is the caller's
 * clock, in the unit `notBefore` was set in). An Undo that waits for its tap's answer (`voidsKey`) names no event yet
 * and is never the body: its tap is ahead of it in the queue.
 */
export function nextSend(state: SyncState, now: number): AppendBody | null {
  const head = state.queue.pending[0];
  if (head === undefined || state.queue.dead !== null || !SENDABLE.has(state.status)) return null;
  if (state.hold !== null || now < state.notBefore || isAsking(state)) return null;
  if (head.voidsKey !== undefined) return null;
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

/**
 * A status no answer undoes: a dead queue stays dead, and so do the two a read can set while a tap is in flight, Update
 * needed (`outdated`) and a ledger over the read's cap (`tooLarge`): only a new session lifts them.
 */
function sticky(state: SyncState): SyncStatus | null {
  if (state.queue.dead !== null) return 'dead';
  return state.status === 'outdated' || state.status === 'tooLarge' ? state.status : null;
}

/** Where a send's answer leaves the sender: idle, unless a status no answer undoes stands (`sticky`). */
const resting = (state: SyncState): SyncStatus => sticky(state) ?? 'idle';

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
 * nothing is sent twice. Rules newer than the phone's, said in the answer, are fetched before anything else is sent
 * (the phone keeps its version until they arrive). An event the ledger already held (a fetch brought it in while the
 * answer was lost) leaves the queue behind it judged on a picture that counted the tap twice: it is judged again,
 * now the duplicate is gone, before anything is sent.
 */
function accepted(state: SyncState, sent: QueuedEvent, answer: Accepted, now: number): SyncStep {
  if (state.queue.ownEventIds.includes(answer.eventId)) return step(state, []);
  const { ledger, tip, gap, duplicate } = joined(state, sent, answer);
  const queue: MatchQueue = {
    ...state.queue,
    pending: state.queue.pending.filter((queued) => queued.key !== sent.key),
    ownEventIds: [...state.queue.ownEventIds, answer.eventId],
  };
  const owed = (duplicate || state.revalidateOwed) && queue.pending.length > 0;
  const settled: SyncState = {
    ...landed(state, sent),
    ledger,
    tip,
    queue,
    status: resting(state),
    notBefore: 0,
    conflictPasses: 0,
    rulesPasses: 0,
    revalidateOwed: owed,
    rulesSaid: null,
    refusedRun: null,
  };
  if (gap) return step({ ...settled, hold: 'ledger' }, [PERSIST, { kind: 'fetchSince', seq: tip }]);
  if (answer.rulesVersion > state.rulesVersion) {
    return step({ ...settled, hold: 'rules' }, [PERSIST, { kind: 'reloadRules' }]);
  }
  if (owed) return step({ ...settled, hold: 'revalidate' }, [PERSIST]);
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
): { ledger: readonly LedgerEvent[]; tip: number; gap: boolean; duplicate: boolean } {
  if (state.ledger.some((held) => held.id === answer.eventId)) {
    return { ledger: state.ledger, tip: state.tip, gap: false, duplicate: true };
  }
  if (answer.seq !== state.tip + 1) {
    return { ledger: state.ledger, tip: state.tip, gap: true, duplicate: false };
  }
  const ledger = [...state.ledger, ledgerEventOf(sent, answer)];
  return { ledger, tip: answer.seq, gap: false, duplicate: false };
}

/** The server's `recorded_at` and `device_link_id` are not in its answer: the tap's time, and no link. */
function ledgerEventOf(sent: QueuedEvent, answer: Accepted): LedgerEvent {
  return {
    id: answer.eventId,
    seq: answer.seq,
    type: sent.type,
    payload: sent.payload,
    recordedAt: sent.createdAt,
    voids: voidTargetOf(sent.type, sent.payload),
    deviceLinkId: null,
  };
}

/**
 * The passes of a kind in a row: the count after this one, whether it is the one that pauses, and the wait it adds. A
 * pause sends nothing sooner than 15 s from `now` (60 s once the refusals are a stall: `refused` is the run's count
 * with this one), and the count starts again.
 */
function pass(
  count: number,
  now: number,
  refused: number,
): { count: number; effects: SyncEffect[]; notBefore: number | null } {
  const next = count + 1;
  if (next < PASSES_BEFORE_PAUSE) return { count: next, effects: [], notBefore: null };
  const ms = refused >= STALL_AFTER ? STALLED_PAUSE_MS : PAUSE_MS;
  return { count: 0, effects: [{ kind: 'retryIn', ms }], notBefore: now + ms };
}

/**
 * One more refusal in a row: the count goes on across pauses and across kinds (a conflict and a rules change alike: the
 * server answered and took nothing), and `by` names the latest. It starts again only when the queue empties (`step`).
 */
function refusedAgain(state: SyncState, by: RefusedRun['by']): RefusedRun {
  return { by, count: (state.refusedRun?.count ?? 0) + 1 };
}

/** Another scorer wrote first: fetch from the tip. Three in a row and the sender waits 15 s as well. */
function conflicted(state: SyncState, sent: QueuedEvent, now: number): SyncStep {
  const freed = notStored(state, sent);
  const refused = refusedAgain(state, 'conflict');
  const passed = pass(state.conflictPasses, now, refused.count);
  const next: SyncState = {
    ...freed.state,
    status: resting(state),
    hold: 'ledger',
    conflictPasses: passed.count,
    notBefore: passed.notBefore ?? freed.state.notBefore,
    refusedRun: refused,
  };
  return step(next, [...freed.saved, { kind: 'fetchSince', seq: state.tip }, ...passed.effects]);
}

/**
 * The organiser changed the rules: fetch them, and send nothing until `onRules` and `revalidate` have been. The phone
 * keeps the version it holds until the rules themselves arrive: if the read fails, the next send still names the old
 * version, the server answers again, and the phone asks again. Three in a row and the sender waits 15 s as well.
 */
function rulesMoved(state: SyncState, sent: QueuedEvent, named: number, now: number): SyncStep {
  const freed = notStored(state, sent);
  const refused = refusedAgain(state, 'rules');
  const passed = pass(state.rulesPasses, now, refused.count);
  const next: SyncState = {
    ...freed.state,
    status: resting(state),
    hold: 'rules',
    rulesPasses: passed.count,
    notBefore: passed.notBefore ?? freed.state.notBefore,
    rulesSaid: named,
    refusedRun: refused,
  };
  return step(next, [...freed.saved, { kind: 'reloadRules' }, ...passed.effects]);
}

/** Update needed: the queue is kept and saved, nothing more is sent. */
function stopped(state: SyncState, sent: QueuedEvent, status: 'outdated'): SyncStep {
  const freed = notStored(state, sent);
  return step({ ...freed.state, status }, [PERSIST]);
}

/**
 * A throttle: nothing is sent for as long as the server said. The tap keeps its attempts: the web rate-limits before
 * its durable replay, so a 429 does not say the server never took the tap, and it stays unresolved.
 */
function waitFor(state: SyncState, sent: QueuedEvent, ms: number, now: number): SyncStep {
  const next: SyncState = { ...landed(state, sent), status: resting(state), notBefore: now + ms };
  return step(next, [{ kind: 'retryIn', ms }]);
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
  const next: SyncState = {
    ...landed(state, sent),
    status: sticky(state) ?? 'offline',
    notBefore: now + ms,
  };
  return step(next, [{ kind: 'retryIn', ms }]);
}

/**
 * Which refusals close the whole queue, not one tap (the web's `statusCode` and `scoring.ts`): a 401 is a link the door
 * does not take, 402 an account that must pay, 403 a result carried forward (the match is finalized) or a write this
 * link may not make, 404 a match that is gone. Everything else the engine says (400, 422, 409) is about one tap, and
 * so is a bare 403 answering a void or a forfeit (`ONE_TAP_403`: the link may not make that one write, the queue's
 * other taps are still its own). `tapType` is the refused tap's, or null for a read.
 */
function closes(status: number, code: string, tapType: string | null): QueueDead | null {
  if (status === 401) return 'LINK_INVALID';
  if (status === 402) return 'payment';
  if (status === 403) {
    if (code === RESULT_CARRIED_FORWARD) return 'finalized';
    return tapType !== null && ONE_TAP_403.has(tapType) ? null : 'forbidden';
  }
  return status === 404 ? 'gone' : null;
}

/**
 * Any other 4xx: that tap leaves the queue and did not count; the ledger is fetched again. A whole-queue refusal
 * (`closes`) keeps every tap and sends no more. ALREADY_DECIDED holds the tap until the match's own status (the
 * bootstrap's) says whether the match is closed (then the queue is dead) or only decided (then the tap is refused).
 */
function refused(state: SyncState, sent: QueuedEvent, status: number, code: string): SyncStep {
  const dead = closes(status, code, sent.type);
  if (dead !== null) return died(state, sent, dead);
  const freed = landed(state, sent);
  if (code === ALREADY_DECIDED) {
    const held: SyncState = {
      ...freed,
      status: resting(freed),
      hold: 'status',
      decidedProbe: sent.key,
    };
    return step(held, [{ kind: 'reloadBootstrap' }]);
  }
  const owed = freed.revalidateOwed && freed.queue.pending.length > 1;
  // The ledger asked for is still out: a revalidation owed waits for it ('ledger' becomes 'revalidate' when it lands).
  const held = owed ? 'ledger' : freed.hold;
  return dropped({ ...freed, status: resting(freed), revalidateOwed: owed }, sent.key, code, held);
}

/** A tap leaves the queue refused, said once as not counted; the ledger is fetched again, and the queue saved. */
function dropped(state: SyncState, key: string, code: string, hold: SyncHold | null): SyncStep {
  const pending = state.queue.pending.filter((queued) => queued.key !== key);
  const next: SyncState = { ...state, hold, queue: { ...state.queue, pending } };
  return step(next, [
    { kind: 'refused', key, code },
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
 * was). The tip is the last seq. The queue, the status and the counts are the answers' to move. New events hold the
 * queue until `revalidate` has run, and so does a revalidation still owed, empty fetch or not.
 */
export function onLedger(state: SyncState, events: readonly LedgerEvent[]): SyncStep {
  if (events.length > 0 && !continues(state, events)) {
    return step(state, [{ kind: 'fetchSince', seq: state.tip }]);
  }
  const merged = events.length === 0 ? state : mergedWith(state, events);
  const cleared: SyncState = { ...merged, hold: heldAfter(state, events.length > 0) };
  return step(same(state, cleared), []);
}

const continues = (state: SyncState, events: readonly LedgerEvent[]): boolean =>
  events.every((event, i) => event.seq === state.tip + 1 + i);

function mergedWith(state: SyncState, events: readonly LedgerEvent[]): SyncState {
  const ledger = [...state.ledger, ...events];
  return { ...state, ledger, tip: ledger[ledger.length - 1].seq };
}

/**
 * The hold once a fetch has landed: a fetch asked for is answered; new events (or a revalidation still owed) want the
 * queue looked at again. Rules or a status still owed are not released by a ledger: their own answers do that, and
 * each ends in a revalidation.
 */
function heldAfter(state: SyncState, moved: boolean): SyncHold | null {
  if (state.hold === 'rules' || state.hold === 'status') return state.hold;
  if (moved || state.revalidateOwed) return 'revalidate';
  return state.hold === 'ledger' ? null : state.hold;
}

/** `cleared` is the state, or `state` itself when nothing about it changed (so a no-op stays the same object). */
const same = (state: SyncState, cleared: SyncState): SyncState =>
  cleared.ledger === state.ledger && cleared.hold === state.hold ? state : cleared;

/**
 * The rules a fetch brought: the phone takes the higher version, never a lower (a read lagging behind the answer that
 * asked for it is no news), but for the version the server itself just named (`rulesSaid`): the web refuses any
 * version but its own, so the phone is then ahead of it and must come down. The queue is looked at again before
 * anything is sent. The hook adopts the rules' own cfg only when its version is the one held now. Under a ledger or a
 * status read still owed the hold stays, and the revalidation is owed: it is done when that read lands, though it
 * brings nothing new.
 */
export function onRules(state: SyncState, rules: { readonly rulesVersion: number }): SyncState {
  const named = rules.rulesVersion === state.rulesSaid;
  const rulesVersion = named
    ? rules.rulesVersion
    : Math.max(state.rulesVersion, rules.rulesVersion);
  const read = { ...state, rulesVersion, rulesSaid: null, rulesRetryAt: null };
  if (state.hold === 'ledger' || state.hold === 'status') return { ...read, revalidateOwed: true };
  return { ...read, hold: 'revalidate' };
}

/**
 * The match's status, from a bootstrap read (the hook passes `bootstrap.status`). A finalized or cancelled match is
 * closed to this link: with taps queued the queue is dead, every tap kept. The ledger cannot say it (a staff reopen
 * leaves an active `core.finalize` in it, and a cancelled match shows nothing there). Any other status answers the
 * tap held on ALREADY_DECIDED: it is refused, alone, and the queue behind it is looked at again.
 */
export function onBootstrapStatus(state: SyncState, status: string): SyncStep {
  const key = state.decidedProbe;
  const cleared: SyncState = {
    ...state,
    decidedProbe: null,
    hold: state.hold === 'status' ? null : state.hold,
  };
  const dead = status === 'finalized' || status === 'cancelled' ? status : null;
  if (dead !== null) {
    if (state.queue.pending.length === 0) return step(cleared, []);
    return step({ ...cleared, status: 'dead', queue: { ...cleared.queue, dead } }, [PERSIST]);
  }
  const held = state.queue.pending.find((queued) => queued.key === key);
  if (held !== undefined) {
    // The taps behind it wait for the ledger the refusal fetches, then are judged on it, not on the stale one.
    const behind = { ...cleared, revalidateOwed: cleared.queue.pending.length > 1 };
    return dropped(behind, held.key, ALREADY_DECIDED, 'ledger');
  }
  const asked = state.hold === 'status' && cleared.queue.pending.length > 0;
  return step(asked ? { ...cleared, hold: 'revalidate' } : cleared, []);
}

/**
 * A fetch or a rules read that did not land: let go of the hold it asked for, and wait before sending on what is
 * held. The send then finds out again (a conflict, new rules, a refusal) and asks again, at the pace the passes set.
 */
export function onFetchFailed(state: SyncState, now: number): SyncStep {
  return letGo(state, now, FETCH_RETRY_MS);
}

/**
 * The read's hold is let go, a revalidation still owed taking its place, and nothing is sent for `ms`: for a rules
 * read at least 15 s, and the read is due again then (`retryRules`), since with nothing queued no send would ever
 * provoke the next FIXTURE_RULES_CHANGED. A status read let go counts as a refusal (`decided`): the tap goes again, is
 * refused again, and the run is what says a stall (review minor 2 of round 2, 2026-11-02); a conflict's or a rules
 * change's refusal was counted when it came, and its read failing adds none.
 */
function letGo(state: SyncState, now: number, ms: number): SyncStep {
  if (state.hold !== 'ledger' && state.hold !== 'rules' && state.hold !== 'status') {
    return step(state, []);
  }
  const rules = state.hold === 'rules';
  const wait = rules ? Math.max(ms, RULES_RETRY_MS) : ms;
  const next: SyncState = {
    ...state,
    hold: state.revalidateOwed ? 'revalidate' : null,
    decidedProbe: null,
    refusedRun: state.hold === 'status' ? refusedAgain(state, 'decided') : state.refusedRun,
    notBefore: Math.max(state.notBefore, now + wait),
    rulesRetryAt: rules ? now + wait : state.rulesRetryAt,
  };
  return step(next, [{ kind: 'retryIn', ms: wait }]);
}

/**
 * A rules read that failed is asked for again once it is due: the hook calls this wherever it asks `nextSend` (every
 * `retryIn` timer, every step), before `nextSend`. It starts the read (hold `rules`, so nothing is sent on rules that
 * may be stale) only when nothing else is standing between the sender and a send; with a ledger, status, rules or
 * revalidation hold standing it waits, still due. Each failure waits 15 s again, so it is paced, never a loop.
 */
export function retryRules(state: SyncState, now: number): SyncStep {
  if (state.rulesRetryAt === null || now < state.rulesRetryAt || state.hold !== null) {
    return step(state, []);
  }
  return step({ ...state, hold: 'rules', rulesRetryAt: null }, [{ kind: 'reloadRules' }]);
}

/**
 * A read (the ledger, the rules, the bootstrap) that came to something but its data. A link the door does not take,
 * or a refusal that closes the whole queue (`closes`), makes the queue dead with taps queued, as it does for an
 * append, so they are kept and never sent. A ledger over the read's size cap is a state the operator is told
 * (`tooLarge`): nothing is retried and nothing is sent. Out of date is Update needed. A throttle waits as long as it
 * was told. Anything else did not land: `onFetchFailed`.
 */
export function onReadFailed(state: SyncState, failure: ReadFailure, now: number): SyncStep {
  switch (failure.kind) {
    case 'linkDead':
      return closed(state, failure.code);
    case 'refused': {
      const dead = closes(failure.status, failure.code, null);
      return dead === null ? onFetchFailed(state, now) : closed(state, dead);
    }
    case 'tooLarge':
      return step({ ...state, status: sticky(state) ?? 'tooLarge', hold: null }, []);
    case 'outdated':
      return step({ ...state, status: sticky(state) ?? 'outdated' }, []);
    case 'rateLimited':
      return letGo(state, now, failure.retryAfterMs);
    case 'offline':
    case 'seqConflict':
    case 'rulesChanged':
      return onFetchFailed(state, now);
  }
}

/**
 * What a failed read says about the link: the word that closes the match to this phone, or null for a read that merely
 * did not land. `onReadFailed` marks a queue dead only with taps queued; the hook uses this for the bad-link card of a
 * match with none (plan S2-1 Task 9).
 */
export function closedBy(failure: ReadFailure): QueueDead | null {
  if (failure.kind === 'linkDead') return failure.code;
  return failure.kind === 'refused' ? closes(failure.status, failure.code, null) : null;
}

/** A read closed the queue: with taps queued it is dead and saved; with none there is nothing to keep. */
function closed(state: SyncState, dead: QueueDead): SyncStep {
  if (state.queue.pending.length === 0) return step(state, []);
  const next: SyncState = {
    ...state,
    status: 'dead',
    hold: null,
    decidedProbe: null,
    queue: { ...state.queue, dead },
  };
  return step(next, [PERSIST]);
}

/**
 * After the ledger or the rules moved: keep the queued taps `legal` names (the fold's `legalQueued`, Task 7), in the
 * queue's own order, and drop the rest, each said once as not counted. A tap the new ledger makes illegal never goes
 * to the server; one nobody queued is never added. While the head's fate is unknown (`isUnresolved`) nothing is
 * dropped and `legal` is not asked: the ledger may hold the head already (a fetch brought it in, a ping for our own
 * append beat the answer, a reopened queue read back with attempts), so the ledger and the queue together count it
 * twice and the taps behind it would be judged on a game that went too far. The revalidation is owed instead, and is
 * done once the head is answered. An unresolved tap that is not the head is never dropped either. Lifts the
 * `revalidate` hold.
 */
export function revalidate(
  state: SyncState,
  legal: (queued: readonly QueuedEvent[]) => readonly string[],
): SyncStep {
  const released: SyncState = state.hold === 'revalidate' ? { ...state, hold: null } : state;
  const head = state.queue.pending[0];
  if (head === undefined) return step(judged(released), []);
  if (isUnresolved(state, head.key)) return step({ ...released, revalidateOwed: true }, []);
  const keep = new Set(legal(state.queue.pending));
  const illegal = state.queue.pending.filter(
    (queued) => !keep.has(queued.key) && !isUnresolved(state, queued.key),
  );
  if (illegal.length === 0) return step(judged(released), []);
  const pending = state.queue.pending.filter((queued) => !illegal.includes(queued));
  const refusals = illegal.map((queued): SyncEffect => ({
    kind: 'refused',
    key: queued.key,
    code: NO_LONGER_LEGAL,
  }));
  const next = judged({ ...released, queue: { ...released.queue, pending } });
  return step(next, [...refusals, PERSIST]);
}

/** The queue has been judged: nothing is owed (the same state when nothing was). */
const judged = (state: SyncState): SyncState =>
  state.revalidateOwed ? { ...state, revalidateOwed: false } : state;
