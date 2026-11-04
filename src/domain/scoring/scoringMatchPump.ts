import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import {
  type SyncState,
  markSending,
  nextSend,
  retryRules,
  revalidate,
} from '@/domain/scoring/sync';
import { withSync } from '@/domain/scoring/scoringMatchAnswers';
import { copiesOf } from '@/domain/scoring/scoringMatchAsk';
import { asking, bootstrapDueAt } from '@/domain/scoring/scoringMatchReads';
import { resave } from '@/domain/scoring/scoringMatchSaves';
import {
  deadOf,
  foldOfState,
  isOutdated,
  part,
  type MatchState,
  type Part,
} from '@/domain/scoring/scoringMatchState';

/**
 * The pump (plan S2-1 Task 9): what can be done now, in order, once a handler has run: a failed save tried again, the
 * rules and the bootstrap read again, the queue judged on the ledger, the next tap sent. Foreground only.
 */

type Stage = <S extends SportTypes>(state: MatchState<S>, now: number) => Part<S>;

/** Runs each stage on the state the one before left, in order, collecting what they ask for. */
function chain<S extends SportTypes>(
  state: MatchState<S>,
  stages: readonly Stage[],
  now: number,
): Part<S> {
  return stages.reduce<Part<S>>((acc, stage) => {
    const next = stage(acc.state, now);
    return part(next.state, [...acc.effects, ...next.effects]);
  }, part(state));
}

/** Foreground only: in the background nothing is judged or sent, and the return calls this again. */
export function pump<S extends SportTypes>(state: MatchState<S>, now: number): Part<S> {
  if (!state.foreground) return part(state);
  return chain(state, [resaving, rulesRetry, rereading, revalidating, sending], now);
}

/** A failed save is tried again once it is due. */
function resaving<S extends SportTypes>(state: MatchState<S>, now: number): Part<S> {
  const owed = state.saveOwed;
  if (owed === null || owed.retryAt === null || now < owed.retryAt) return part(state);
  return part({ ...state, saveOwed: { ...owed, retryAt: null } }, [resave(state.sync.queue)]);
}

/** The bootstrap is read again once it is due (`bootstrapDueAt`): a card's poll, or a read a ping owed. */
function rereading<S extends SportTypes>(state: MatchState<S>, now: number): Part<S> {
  const due = bootstrapDueAt(state);
  return due === null || now < due ? part(state) : asking(state, now);
}

/** A rules read that failed is asked for again once due (`retryRules`), even with nothing queued. */
function rulesRetry<S extends SportTypes>(state: MatchState<S>, now: number): Part<S> {
  return withSync(state, retryRules(state.sync, now));
}

type Judge = (queued: readonly QueuedEvent[]) => readonly string[];

/** What can judge the queue: the fold, or (the background sender) nothing, which keeps every tap for the server to judge. */
export function judgeOf<S extends SportTypes>(state: MatchState<S>): Judge | null {
  if (state.judge === 'trust') return (queued) => queued.map((tap) => tap.key);
  const { pending } = state.sync.queue;
  const fold = foldOfState(state, undoneAway(pending));
  if (fold === null || fold.kind !== 'folded') return null;
  return () => [...fold.legalQueued, ...undoPairs(pending)];
}

/** The queue as the fold judges it: a tap an Undo is waiting on, and that Undo, are both left out (they cancel). */
function undoneAway(pending: readonly QueuedEvent[]): readonly QueuedEvent[] {
  const pairs = new Set(undoPairs(pending));
  return pending.filter((tap) => !pairs.has(tap.key));
}

/** The keys of the Undos that wait and of the taps they wait on: kept whole, never judged apart. */
const undoPairs = (pending: readonly QueuedEvent[]): readonly string[] =>
  pending.flatMap((tap) => (tap.voidsKey === undefined ? [] : [tap.key, tap.voidsKey]));

/**
 * The queue judged on the ledger and rules as they stand, when sync asks (hold `revalidate`). A match that cannot be
 * folded is never judged: an empty `legalQueued` would drop the whole queue. The hold then stands, and the pad says why.
 */
function revalidating<S extends SportTypes>(state: MatchState<S>): Part<S> {
  if (state.sync.hold !== 'revalidate') return part(state);
  const judge = judgeOf(state);
  if (judge === null) return part(state);
  return withSync(state, revalidate(state.sync, judge));
}

/**
 * The next send, if one is due. The payload is decided BEFORE the attempt is marked (the sport's `payloadForSend`:
 * badminton's first rally drops its `serving` if a rally already stands), and written into the queued head in the same
 * step that marks the attempt, so the fold and sync see what the server is sent. The sport is told whether the ledger
 * holds the tap's copy (`copiesOf`, the reconnect question's own test; only a tap sent before has one), since only then
 * does the server hold the payload as first sent. The save before the send is the step's own.
 */
function sending<S extends SportTypes>(state: MatchState<S>, now: number): Part<S> {
  const { sync } = state;
  if (state.saving > 0 || deadOf(state) !== null || isOutdated(state)) return part(state);
  const body = nextSend(sync, now);
  const head = sync.queue.pending[0];
  if (body === null || head === undefined) return part(state);
  const copied = copiesOf(state, sync.ledger).has(head.key);
  const payload = state.sport.payloadForSend(head, sync.ledger, copied);
  const decided: SyncState =
    payload === head.payload
      ? sync
      : {
          ...sync,
          queue: { ...sync.queue, pending: [{ ...head, payload }, ...sync.queue.pending.slice(1)] },
        };
  const marked = markSending(decided, now).state;
  const sentTap = marked.queue.pending[0];
  const next: MatchState<S> = {
    ...state,
    sync: marked,
    sent: { key: head.key, expectedSeq: body.expected_seq },
  };
  return part(next, [{ kind: 'send', body: { ...body, payload }, sent: sentTap }]);
}
