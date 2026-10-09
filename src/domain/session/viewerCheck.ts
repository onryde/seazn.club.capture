/**
 * What viewers see as a rule (D2 §4.3, R2, R10): event in, state out, no timers. The hook owns the timers and reads
 * the time; this decides only what follows what. It is the view's, not the session's: native owns the session
 * (AGENTS §2), and nothing here is read by the machine, the snapshot or the heartbeat.
 *
 *   idle --tap--> loading (5 s)
 *   loading --first frame--> showing (20 s, counted from the frame)
 *   loading --5 s, no frame--> notReady (3 s) --> idle
 *   showing --20 s--> idle
 *   any open --tap--> idle: a tap never extends a view, so a phone cannot be left playing
 *   any --close (shed, off air, the scoring panel, no playback URL, the background)--> idle
 */

/** The countdown while the player has no picture yet. */
export const LOADING_MS = 5_000;
/** The view, counted from its first frame, not from the tap. */
export const SHOWING_MS = 20_000;
/** The honest line when no picture came: shown this long, then the view closes. */
export const NOT_READY_MS = 3_000;

export type ViewerCheck =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' | 'showing' | 'notReady'; readonly until: number };

export type ViewerEvent =
  | { readonly kind: 'tap'; readonly at: number }
  | { readonly kind: 'firstFrame'; readonly at: number }
  | { readonly kind: 'deadline'; readonly at: number }
  | { readonly kind: 'close' };

export const IDLE: ViewerCheck = { kind: 'idle' };

export function viewerCheck(state: ViewerCheck, event: ViewerEvent): ViewerCheck {
  switch (event.kind) {
    case 'close':
      return IDLE;
    case 'tap':
      return state.kind === 'idle' ? { kind: 'loading', until: event.at + LOADING_MS } : IDLE;
    case 'firstFrame':
      return state.kind === 'loading' ? { kind: 'showing', until: event.at + SHOWING_MS } : state;
    case 'deadline':
      return deadline(state, event.at);
  }
}

/** A timer firing at `at`. One that fires early, or for a view already gone, changes nothing. */
function deadline(state: ViewerCheck, at: number): ViewerCheck {
  if (state.kind === 'idle' || at < state.until) return state;
  return state.kind === 'loading' ? { kind: 'notReady', until: at + NOT_READY_MS } : IDLE;
}
