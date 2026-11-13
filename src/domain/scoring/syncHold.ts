import { isHeld, type QueuedEvent } from '@/domain/scoring/queue';
import { isUnresolved, type SyncState, type SyncStep } from '@/domain/scoring/sync';

/**
 * A tap held unsent for a moment (S2-7 ruling 234, Task 17), pure: the one thing a queued tap may change after it is made.
 * A sport holds a tap (`QueuedEvent.holdUntil`) so the scorer can add a detail to it before it goes, as the web's pad does
 * (`HOLD_MS`, apps/web/src/components/v2/scorepad/queue.ts). The idempotency key never changes, and a tap is amended only
 * while it is held and no send of it could have reached the server (`isUnresolved`, the predicate Undo's discard uses):
 * once it may be at the server, what it says is the server's. `nextSend` (sync.ts) waits for a held head. Sport-agnostic:
 * the payload is the caller's, never read here.
 */

/** The tap held at `now` (the runner's clock) that no send has reached: the one a detail may still be added to, or null. */
export function heldTapOf(state: SyncState, now: number): QueuedEvent | null {
  const held = state.queue.pending.find((tap) => isHeld(tap, now));
  return held === undefined || isUnresolved(state, held.key) ? null : held;
}

/**
 * The held tap `key` with `payload` in place of its own, its hold let go so it is sent next, and the queue saved. A tap
 * that is not held at `now`, is on its way or was sent with no answer, or is not queued, changes nothing: a second amend
 * finds the hold already gone.
 */
export function amendQueued(
  state: SyncState,
  key: string,
  payload: unknown,
  now: number,
): SyncStep {
  if (heldTapOf(state, now)?.key !== key) return { state, effects: [] };
  const pending = state.queue.pending.map((tap) =>
    tap.key === key ? { ...withoutHold(tap), payload } : tap,
  );
  return {
    state: { ...state, queue: { ...state.queue, pending } },
    effects: [{ kind: 'persist' }],
  };
}

/**
 * Every held tap let go at once: the next tap was made, the match went to the background, or the sport asked (the scorer
 * turned the details off). The same state when nothing is held. Nothing to save: the queue file never holds a hold.
 */
export function releaseHeld(state: SyncState): SyncState {
  const { pending } = state.queue;
  if (!pending.some((tap) => tap.holdUntil !== undefined)) return state;
  return { ...state, queue: { ...state.queue, pending: pending.map(withoutHold) } };
}

function withoutHold(tap: QueuedEvent): QueuedEvent {
  if (tap.holdUntil === undefined) return tap;
  const { holdUntil: _released, ...rest } = tap;
  return rest;
}
