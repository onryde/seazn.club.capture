import { judgeOf } from '@/domain/scoring/scoringMatchPump';
import { deadOf, isOutdated, type MatchState } from '@/domain/scoring/scoringMatchState';
import { STALL_AFTER, isAsking, type RefusedRun } from '@/domain/scoring/sync';

/**
 * When the phone has taps it cannot get to the server and nothing on the pad says why (device, 2026-11-02): the pad
 * read "Sending 8 taps" for good while the server refused every send, and the record held one line. A stall is a state
 * of the match, not a clock: the one reading of it, for the record (`scoring.stalled`, `scoringRunner.ts`) and for
 * the pad's "can't send" badge (`syncOf` in `scoringMatchView.ts`, the `stalled` kind of `PadSync`).
 *
 * Not stalls, because the pad already says them: offline, a link the door does not take, a match closed, an app too
 * old, a ledger over the cap. Nothing queued is nothing to send, and the background sends nothing.
 */
export type Stall =
  /** The server answers each send and does not take the tap: a conflict or new rules, `count` times in a row. */
  | ({ readonly kind: 'refused' } & RefusedRun)
  /** The queue is held to be judged on the match, and the match cannot be folded: it is never judged or sent. */
  | { readonly kind: 'fold' };

export function stallOf(state: MatchState): Stall | null {
  const { sync } = state;
  const waiting = sync.queue.pending.length > 0 && state.foreground;
  if (!waiting || deadOf(state) !== null || isOutdated(state) || sync.status === 'tooLarge') {
    return null;
  }
  // The question is the sender's own hold (`scoring.ask`): nothing is being refused while it waits for the scorer.
  if (isAsking(sync)) return null;
  const run = sync.refusedRun;
  if (run !== null && run.count >= STALL_AFTER) return { kind: 'refused', ...run };
  const unjudged =
    sync.hold === 'revalidate' && state.bootstrap !== null && judgeOf(state) === null;
  return unjudged ? { kind: 'fold' } : null;
}
