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
  readonly createdAt: string;
  /**
   * How many sends of this tap were made without a definite answer: counted and saved when a send starts, kept on no
   * answer, back to 0 on an answer that says it was not stored. More than 0, the tap may be in the ledger already.
   */
  readonly attempts: number;
};

/**
 * Why a queue can send no more, and nothing else discards a tap: the link is gone (the three codes the door answers 401
 * with), the match is finalized (the organiser locked it, or RESULT_CARRIED_FORWARD), this link may not write it
 * (another 403), the match is gone (404) or the account behind it needs paying (402). A tap the engine refuses is
 * refused alone, one tap, and the queue goes on (`sync.ts`).
 */
export type QueueDead =
  'LINK_INVALID' | 'LINK_REVOKED' | 'LINK_EXPIRED' | 'finalized' | 'forbidden' | 'gone' | 'payment';

export const QUEUE_DEAD_WORDS: readonly QueueDead[] = [
  'LINK_INVALID',
  'LINK_REVOKED',
  'LINK_EXPIRED',
  'finalized',
  'forbidden',
  'gone',
  'payment',
];

export type MatchQueue = {
  readonly fixtureId: string;
  /** What Home's Continue card names the match by, as typed by the organiser. */
  readonly label: string;
  readonly pending: readonly QueuedEvent[];
  /** The event ids the server returned for this phone's accepted taps: "This phone" in History, and what Undo reaches. */
  readonly ownEventIds: readonly string[];
  readonly dead: QueueDead | null;
};
