import type { QueuedEvent } from '@/domain/scoring/queue';
import { voidTargetOf, type LedgerEvent } from '@/domain/scoring/wire';

/**
 * What the one Undo takes back (ruling 28, narrowing ruling 6; design §6.2, plan S2-1 Task 7). Sport-agnostic: it reads
 * only the core types, `core.start` and `core.void`.
 *
 * - `queued`: this phone's last tap, still only queued: it leaves the queue and nothing is sent (`discardQueued`).
 * - `awaitAnswer`: this phone's last tap, queued, but a send of it may have reached the server (`canDiscardQueued` says
 *   no): Undo waits for its answer and then voids the event id the answer names (Task 9).
 * - `ledger`: this phone's last event, accepted: Undo queues a `core.void` of it.
 * - `blocked`: `nothing` of this phone's stands in the match; `otherScorer`, another device's event stands after this
 *   phone's last ("Another scorer has scored since"); `startFollowed`, the last is the start and something follows it.
 */
export type UndoTarget =
  | { readonly kind: 'queued'; readonly key: string }
  | { readonly kind: 'awaitAnswer'; readonly key: string }
  | { readonly kind: 'ledger'; readonly eventId: string }
  | { readonly kind: 'blocked'; readonly reason: UndoBlocked };

export type UndoBlocked = 'otherScorer' | 'nothing' | 'startFollowed';

/** One event of the match as Undo reads it: the ledger's in seq order, then this phone's queued taps on top. */
type Entry =
  | {
      readonly from: 'ledger';
      readonly id: string;
      readonly type: string;
      readonly voids: string | null;
      readonly own: boolean;
    }
  | {
      readonly from: 'queue';
      readonly key: string;
      readonly type: string;
      readonly voids: string | null;
      readonly own: true;
    };

const VOID = 'core.void';
const START = 'core.start';

/**
 * The event Undo would take back: this phone's latest still standing (a void never stands, nor an event a void takes
 * back), queued first, then the ledger's, and only while no other device's event stands after it. A start only while
 * nothing at all follows it, an event Undo already took back included (the web voids no start once anything follows).
 * "Own" is `ownEventIds`, never the device link, which a browser on the same link shares (design §6.2). `canDiscard`
 * is sync's `canDiscardQueued` for the queue the caller holds.
 */
export function undoTarget(
  ledger: readonly LedgerEvent[],
  queued: readonly QueuedEvent[],
  ownEventIds: readonly string[],
  canDiscard: (key: string) => boolean,
): UndoTarget {
  const entries = entriesOf(ledger, queued, ownEventIds);
  const standing = standingOf(entries);
  const mine = standing.filter((entry) => entry.own);
  const latest = mine[mine.length - 1];
  if (latest === undefined) return blocked('nothing');
  if (standing[standing.length - 1] !== latest) return blocked('otherScorer');
  if (latest.type === START && entries[entries.length - 1] !== latest) {
    return blocked('startFollowed');
  }
  return targetOf(latest, canDiscard);
}

const blocked = (reason: UndoBlocked): UndoTarget => ({ kind: 'blocked', reason });

function entriesOf(
  ledger: readonly LedgerEvent[],
  queued: readonly QueuedEvent[],
  ownEventIds: readonly string[],
): readonly Entry[] {
  const own = new Set(ownEventIds);
  return [
    ...ledger.map((event): Entry => ({
      from: 'ledger',
      id: event.id,
      type: event.type,
      voids: event.voids,
      own: own.has(event.id),
    })),
    ...queued.map((tap): Entry => ({
      from: 'queue',
      key: tap.key,
      type: tap.type,
      voids: voidTargetOf(tap.type, tap.payload),
      own: true,
    })),
  ];
}

/** The events still in the match: no void, and nothing a void (the ledger's or a queued one) takes back. */
function standingOf(entries: readonly Entry[]): readonly Entry[] {
  const voided = new Set(entries.flatMap((entry) => (entry.voids === null ? [] : [entry.voids])));
  return entries.filter(
    (entry) => entry.type !== VOID && !(entry.from === 'ledger' && voided.has(entry.id)),
  );
}

function targetOf(entry: Entry, canDiscard: (key: string) => boolean): UndoTarget {
  if (entry.from === 'ledger') return { kind: 'ledger', eventId: entry.id };
  return canDiscard(entry.key)
    ? { kind: 'queued', key: entry.key }
    : { kind: 'awaitAnswer', key: entry.key };
}

/** The event Undo queues to take back a recorded one (design §7.3): the web reads its target from `event_id`. */
export const undoEventFor = (eventId: string) => ({
  type: VOID,
  payload: { event_id: eventId },
});
