import type { PadSide } from '@/domain/scoring/padView';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';
import type { Bootstrap } from '@/domain/scoring/wire';

/**
 * What a phone holds for a match it is scoring (design §6.3, plan S2-1 Task 5): the taps not yet accepted, which of
 * the ledger's events are its own, and why it can send no more. Types only: the durable store is `tapQueueStore` and
 * the rules that move a queue are `sync.ts`. There is no secret here: the scoring link's token stays in the secure
 * store, and a queue never names it.
 */

/** One tap, made at once and kept until the server accepts it or refuses it (design §6.3). */
export type QueuedEvent = {
  /** The idempotency key, made at tap time and never changed: a resend is the same tap, never a second. */
  readonly key: string;
  readonly type: string;
  readonly payload: unknown;
  /** The rules version the tap was made under (the pad's, when it was tapped). */
  readonly rulesVersion: number;
  /** When the tap was made, on the clock `stampedOn` names. */
  readonly createdAt: string;
  /**
   * The clock `createdAt` is on (ruling 149). `'server'`: the server's, the steady clock plus the offset the server clock
   * held at the tap, so it is the same clock as the ledger's `recorded_at` and a wall clock moved after the tap never
   * moves it. Absent: this phone's own clock, for a tap made before any offset was known (a cold start offline, on the
   * steady clock), and for every tap written before ruling 149 (v1.0.6: the wall clock; earlier S2-5 builds: the steady
   * clock), which is what they are. A reader compares it only with a time on the same clock.
   */
  readonly stampedOn?: 'server';
  /**
   * How many sends of this tap were made without a definite answer: counted and saved when a send starts, kept on no
   * answer, back to 0 on an answer that says it was not stored. More than 0, the tap may be in the ledger already.
   */
  readonly attempts: number;
  /**
   * An Undo of a tap whose fate is unknown (it may be at the server already): the key of that tap. The void's payload
   * names no event yet; the tap's answer gives the id, and only then is it a plain `core.void`, sent in its place. Until
   * then it is neither sent nor folded, the tap it takes back is not folded either, and it is kept in the queue file so
   * a kill, or leaving the match, does not lose the Undo.
   */
  readonly voidsKey?: string;
  /**
   * A count the tap was made at, for its sport's send to read (`SportEvent.base`). Table tennis: the score a tap's
   * `serving` was made at, the number of standing score events in the phone's view, and the send drops `serving` if the
   * ledger's count differs. Football's clock taps: the ledger's tip (its newest seq) the phone held, and the send
   * withdraws one that another screen's later clock event overtook (`overtaken`). Absent on a tap that needs none, on a
   * tap of a sport that sets none, and on a queue file written before it existed.
   */
  readonly base?: number;
  /**
   * The phone's own clock reading behind a stamp the sport put in the payload instead, kept here on the phone and never
   * sent (`SportEvent.reading`). Football: a sub that joined a stoppage is queued with the stoppage's stamp, and its send
   * falls back to this reading when the stoppage is gone (ruling 154, review M1). Absent on every other tap, and on a
   * queue file written before it existed (the payload's stamp then stands).
   */
  readonly reading?: TapReading;
  /**
   * Held unsent until this time, on the runner's clock (S2-7 ruling 234: a sport's tap kept back a moment so the scorer can
   * add a detail to it, `amendQueued`). It is folded at once like any tap; only its send waits. Never written to the queue
   * file (`tapQueueStore` writes the fields it names), so a tap read back after a kill or a reopen is never held and goes
   * as it stands. Absent on every tap of a sport that holds none.
   */
  readonly holdUntil?: number;
};

/** Whether `tap` is held unsent at `now` (the runner's clock): it has a hold, and the hold has not run out. */
export const isHeld = (tap: QueuedEvent, now: number): boolean =>
  tap.holdUntil !== undefined && now < tap.holdUntil;

/** A clock reading: seconds into a period, as the engine's `GameTime` (`{ period, elapsed }`). */
export type TapReading = { readonly period: string; readonly elapsed: number };

/**
 * Why a queue can send no more, and nothing else discards a tap: the link is gone (the three codes the door answers 401
 * with), the match is finalized (the organiser locked it) or cancelled (the bootstrap's status says either), its result
 * is carried forward (the web answers 403 RESULT_CARRIED_FORWARD: the result has already moved the competition on, and
 * nobody locked anything, so it is not `finalized`), this link may not write it (another 403), the match is gone (404)
 * or the account behind it needs paying (402). A tap the engine refuses is
 * refused alone, one tap, and the queue goes on (`sync.ts`).
 */
export type QueueDead =
  | 'LINK_INVALID'
  | 'LINK_REVOKED'
  | 'LINK_EXPIRED'
  | 'finalized'
  | 'forbidden'
  | 'gone'
  | 'payment'
  | 'cancelled'
  | 'carriedForward';

export const QUEUE_DEAD_WORDS: readonly QueueDead[] = [
  'LINK_INVALID',
  'LINK_REVOKED',
  'LINK_EXPIRED',
  'finalized',
  'forbidden',
  'gone',
  'payment',
  'cancelled',
  'carriedForward',
];

/**
 * The queue is dead because its LINK is: a fresh link for the same match makes it sendable again. The other words
 * (finalized, forbidden, gone, payment, cancelled, carriedForward) are about the match or the writer, and no new link
 * changes them.
 */
export function isLinkDead(dead: QueueDead | null): boolean {
  return dead === 'LINK_INVALID' || dead === 'LINK_REVOKED' || dead === 'LINK_EXPIRED';
}

/**
 * The queue is dead because the match has a RESULT and the server holds it: the organiser finalized it, or the web
 * carried its result forward. The server's ledger is the authority for what that result is (AGENTS §2), so what the
 * phone still queues, a tap the server refused or never took, is not part of it: the pad and Home read the ledger
 * alone. Not `cancelled` (nothing was decided) and not a dead link or writer (they say nothing of the match).
 */
export function resultStands(dead: QueueDead | null): boolean {
  return dead === 'finalized' || dead === 'carriedForward';
}

export type MatchQueue = {
  readonly fixtureId: string;
  /** What Home's Continue card names the match by, as typed by the organiser. */
  readonly label: string;
  readonly pending: readonly QueuedEvent[];
  /** The event ids the server returned for this phone's accepted taps: "This phone" in History, and what Undo reaches. */
  readonly ownEventIds: readonly string[];
  readonly dead: QueueDead | null;
  /**
   * The reconnect question (owner ruling 43, 2026-11-02): the ids of the events another scorer wrote while this phone
   * had taps queued, that the scorer has not yet been asked about. While it is present nothing is sent, and it is kept
   * with the queue so a kill and a reopen find the question still standing. Absent: nothing is asked.
   */
  readonly askedAbout?: readonly string[];
  /**
   * The keys of the taps waiting when the scorer answered the reconnect question with Send (round 4, item 1b): one
   * answer covers the queue as it stood, so while every tap waiting is in this list, events another scorer makes are not
   * asked about again. A tap queued since is not in it. Kept with the queue (a kill mid-drain does not ask again), and
   * dropped when the queue empties. Absent: no such answer.
   */
  readonly answeredSend?: readonly string[];
};

/**
 * How long a phone keeps the ids of its own taps in a match it has left (owner ruling 46, 2026-11-03): a volunteer who
 * scans another court's code by mistake and then scans their own again finds History and Undo as they were. A day.
 */
export const KEPT_OWN_MS = 24 * 60 * 60 * 1000;

/**
 * Whether ids kept since `leftAt` (epoch ms) are still this phone's to use at `now`: not older than a day. A stamp from
 * the future (the phone's clock was set back) counts by its distance, so one a day or more ahead is not kept for ever.
 */
export function keptStillMine(leftAt: number, now: number): boolean {
  return Math.abs(now - leftAt) <= KEPT_OWN_MS;
}

/**
 * What a reopened match needs before the network answers (plan S2-1 Task 9): the bootstrap last read, with the rules
 * the phone has adopted since (`cfg` and `rulesVersion` are the current ones), the side the scorer picked to
 * serve first, which the match's first rally carries until a rally stands, and the scorer's pending picks (S2-4 plan
 * Task 3: cricket's batting order, openers and next bowler), kept until a tap carries them. No secret: the link's token
 * is the secure store's.
 */
export type BootCache = {
  readonly bootstrap: Bootstrap;
  readonly toss: PadSide | null;
  readonly picks: PendingPicks;
};
