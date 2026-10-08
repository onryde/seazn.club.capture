import type { EndReason } from '@/domain/session/SessionState';

/** What the Stream ended card remembers about the end it reports (spec §5). */
export type EndedCard = {
  readonly reason: EndReason;
  /** Time on air, or null for a session that never went live (plan B's `durationMs`). */
  readonly durationMs: number | null;
  /** The Ended snapshot's `codeEndedPending` (CaptureEnginePort.ts:96): the 401 deferral's end (D7, F14 a). */
  readonly codeEnded: boolean;
};

/** The card as the lines it says, apart from how they are worded or laid out. */
export type EndedLines = {
  readonly time:
    { readonly kind: 'onAir'; readonly durationMs: number } | { readonly kind: 'neverLive' };
  readonly reason: 'stopped' | 'failed';
  /**
   * Spec §5: only after the operator's own Stop over a code that still works. A fatal end keeps its code, so there is
   * nothing to rescan; a code-ended Stop's code is dead (SessionMachine.kt:111), so rescanning it is wrong (F14 a).
   */
  readonly scanAgain: boolean;
  /**
   * F14 a: an end over a code the server has ended says so (`panel.codeEnded.body`), in place of the scan-again line,
   * and a fatal one says it instead of "Your code is kept", which would not be true.
   */
  readonly codeEnded: boolean;
};

export function endedLines({ reason, durationMs, codeEnded }: EndedCard): EndedLines {
  const stopped = reason === 'operator-stopped';
  return {
    time: durationMs === null ? { kind: 'neverLive' } : { kind: 'onAir', durationMs },
    reason: stopped ? 'stopped' : 'failed',
    scanAgain: stopped && !codeEnded, // F14 a: never send the operator back to a dead code
    codeEnded,
  };
}
