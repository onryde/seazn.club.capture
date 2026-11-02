import { isRecord } from '@/domain/credentials/wire';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
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

export type SyncState = {
  /** The server's seq as this phone knows it: the `expected_seq` of the next send. */
  readonly tip: number;
  /** What the server has, in seq order, this phone's own accepted taps among it. */
  readonly ledger: readonly LedgerEvent[];
  readonly queue: MatchQueue;
  /** The rules version the phone holds: every send is made under it. */
  readonly rulesVersion: number;
  /** `foldEpochOf(sport)`, sent with every event; the server answers 426 when it is behind. */
  readonly engineEpoch: number;
  readonly status: SyncStatus;
  /** Conflicts in a row with no tap accepted between. */
  readonly conflictPasses: number;
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

/** Conflicts in a row before the sender waits instead of fetching and sending at once again (design §6.3). */
const CONFLICT_PASSES = 3;
const CONFLICT_PAUSE_MS = 15_000;
/** The wait after the 1st, 2nd, ... failed attempt of one tap; the last holds from then on. */
const BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10_000, 15_000];
/** The word `refused` carries for a queued tap the ledger has made illegal: not a server's code, ours. */
export const NO_LONGER_LEGAL = 'NO_LONGER_LEGAL';

const PERSIST: SyncEffect = { kind: 'persist' };
/** Where a send may start: not in flight, not waiting on an update, not dead. Offline is a retry. */
const SENDABLE: ReadonlySet<SyncStatus> = new Set<SyncStatus>(['idle', 'offline']);

const step = (state: SyncState, effects: readonly SyncEffect[]): SyncStep => ({ state, effects });

// ---------------------------------------------------------------------------------------------------------------
// What to send
// ---------------------------------------------------------------------------------------------------------------

/**
 * The head of the queue as the server reads it, at the tip, or null: nothing queued, one already in flight, Update
 * needed, or a dead link. A queue read back dead (`queue.dead`) sends nothing, whatever the status says.
 */
export function nextSend(state: SyncState): AppendBody | null {
  const head = state.queue.pending[0];
  if (head === undefined || state.queue.dead !== null || !SENDABLE.has(state.status)) return null;
  return {
    expected_seq: state.tip,
    type: head.type,
    payload: head.payload,
    idempotency_key: head.key,
    engine_epoch: state.engineEpoch,
    rules_version: state.rulesVersion,
  };
}

/** The state once the hook has taken `nextSend`'s body to the port: one in flight, so no second. */
export function markSending(state: SyncState): SyncState {
  return nextSend(state) === null ? state : { ...state, status: 'sending' };
}

// ---------------------------------------------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------------------------------------------

/**
 * `sent` is the tap the answer is about, found by its key, not by its place: it may have left the queue meanwhile
 * (undone in flight), and a late answer is still the server's word.
 */
export function onAnswer(state: SyncState, sent: QueuedEvent, answer: AppendAnswer): SyncStep {
  switch (answer.kind) {
    case 'accepted':
      return accepted(state, sent, answer);
    case 'seqConflict':
      return conflicted(state);
    case 'rulesChanged':
      return step({ ...state, status: 'idle', rulesVersion: answer.rulesVersion }, [
        { kind: 'reloadRules' },
      ]);
    case 'outdated':
      return step({ ...state, status: 'outdated' }, [PERSIST]);
    case 'linkDead':
      return step({ ...state, status: 'dead', queue: { ...state.queue, dead: answer.code } }, [
        PERSIST,
      ]);
    case 'rateLimited':
      return step({ ...state, status: 'idle' }, [{ kind: 'retryIn', ms: answer.retryAfterMs }]);
    case 'offline':
      return wentOffline(state, sent);
    case 'refused':
      return refused(state, sent, answer.code);
  }
}

type Accepted = Extract<AppendAnswer, { kind: 'accepted' }>;

/**
 * The tap is the server's now: it joins the ledger and leaves the queue (design §6.3), and its event id is one of
 * this phone's own. An id already counted is a second delivery of an answer already taken: nothing changes, and
 * nothing is sent twice.
 */
function accepted(state: SyncState, sent: QueuedEvent, answer: Accepted): SyncStep {
  if (state.queue.ownEventIds.includes(answer.eventId)) return step(state, []);
  const { ledger, tip, gap } = joined(state, sent, answer);
  const queue: MatchQueue = {
    ...state.queue,
    pending: state.queue.pending.filter((queued) => queued.key !== sent.key),
    ownEventIds: [...state.queue.ownEventIds, answer.eventId],
  };
  const settled: SyncState = { ...state, ledger, tip, queue, status: 'idle', conflictPasses: 0 };
  if (gap) return step(settled, [PERSIST, { kind: 'fetchSince', seq: tip }]);
  const body = nextSend(settled);
  if (body === null) return step(settled, [PERSIST]);
  return step({ ...settled, status: 'sending' }, [PERSIST, { kind: 'send', body }]);
}

/**
 * Where the accepted tap sits in the ledger. The server accepts only at `expected_seq`, so it lands at the tip + 1:
 * the ledger takes it from the tap itself (the answer carries no event) and the tip moves. One the ledger already
 * holds (a fetch brought it in while the answer was lost) is not added again, and the tip never moves back. A seq it
 * cannot place leaves a gap: the hook fetches before it sends again.
 */
function joined(
  state: SyncState,
  sent: QueuedEvent,
  answer: Accepted,
): { ledger: readonly LedgerEvent[]; tip: number; gap: boolean } {
  if (state.ledger.some((held) => held.id === answer.eventId)) {
    return { ledger: state.ledger, tip: Math.max(state.tip, answer.seq), gap: false };
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

/** Another scorer wrote first: fetch from the tip. Three in a row and the sender waits 15 s as well. */
function conflicted(state: SyncState): SyncStep {
  const fetch: SyncEffect = { kind: 'fetchSince', seq: state.tip };
  const passes = state.conflictPasses + 1;
  if (passes < CONFLICT_PASSES) {
    return step({ ...state, status: 'idle', conflictPasses: passes }, [fetch]);
  }
  return step({ ...state, status: 'idle', conflictPasses: 0 }, [
    fetch,
    { kind: 'retryIn', ms: CONFLICT_PAUSE_MS },
  ]);
}

/** No answer: the tap stays, with its key, and is tried again after a wait that grows to 15 s. */
function wentOffline(state: SyncState, sent: QueuedEvent): SyncStep {
  const attempts = sent.attempts + 1;
  const pending = state.queue.pending.map((queued) =>
    queued.key === sent.key ? { ...queued, attempts } : queued,
  );
  const ms = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
  return step({ ...state, status: 'offline', queue: { ...state.queue, pending } }, [
    { kind: 'retryIn', ms },
  ]);
}

/** Any other 4xx: that tap leaves the queue and did not count; the ledger is fetched again. */
function refused(state: SyncState, sent: QueuedEvent, code: string): SyncStep {
  const pending = state.queue.pending.filter((queued) => queued.key !== sent.key);
  return step({ ...state, status: 'idle', queue: { ...state.queue, pending } }, [
    { kind: 'refused', key: sent.key, code },
    { kind: 'fetchSince', seq: state.tip },
    PERSIST,
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// The ledger moves; so does what is legal
// ---------------------------------------------------------------------------------------------------------------

/**
 * Events fetched, merged into the ledger by seq: the server's version of an event replaces ours, and the tip moves
 * up to the last, never back. The queue, the status and the counts are the answers' to move.
 */
export function onLedger(state: SyncState, events: readonly LedgerEvent[]): SyncState {
  if (events.length === 0) return state;
  const bySeq = new Map<number, LedgerEvent>();
  for (const held of [...state.ledger, ...events]) bySeq.set(held.seq, held);
  const ledger = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const last = ledger[ledger.length - 1];
  return { ...state, ledger, tip: Math.max(state.tip, last.seq) };
}

/**
 * After the ledger or the rules moved: keep the queued taps `legal` names (the fold's `legalQueued`, Task 7), in the
 * queue's own order, and drop the rest, each said once as not counted. A tap the new ledger makes illegal never goes
 * to the server; one nobody queued is never added.
 */
export function revalidate(
  state: SyncState,
  legal: (queued: readonly QueuedEvent[]) => readonly string[],
): SyncStep {
  if (state.queue.pending.length === 0) return step(state, []);
  const keep = new Set(legal(state.queue.pending));
  const dropped = state.queue.pending.filter((queued) => !keep.has(queued.key));
  if (dropped.length === 0) return step(state, []);
  const pending = state.queue.pending.filter((queued) => keep.has(queued.key));
  const refusals = dropped.map((queued): SyncEffect => ({
    kind: 'refused',
    key: queued.key,
    code: NO_LONGER_LEGAL,
  }));
  return step({ ...state, queue: { ...state.queue, pending } }, [...refusals, PERSIST]);
}
