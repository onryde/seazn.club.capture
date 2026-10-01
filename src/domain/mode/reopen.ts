import type { Mode } from '@/domain/mode/Mode';
import { isExpired, venueZone, type SavedCode } from '@/domain/mode/savedCode';

/**
 * The engine as the shell sees it. `live` covers connecting, publishing,
 * degraded and reconnecting alike: each is a broadcast the operator must not
 * walk away from. `ended` splits by reason, because a failure keeps its code
 * so the operator can go straight back in.
 */
export type EngineStatus = 'idle' | 'armed' | 'live' | 'stopped' | 'failed';

export type SavedState = {
  readonly active: Mode | null;
  readonly codes: Readonly<Partial<Record<Mode, SavedCode>>>;
};

export type ReopenTarget =
  | { readonly go: 'stream' }
  | {
      readonly go: 'home';
      /** `venueTz` is the saved descriptor's zone, so the notice reads in venue time (spec §2). */
      readonly notice?: {
        readonly mode: Mode;
        readonly expiredAt: Date;
        readonly venueTz: string | null;
      };
    };

/**
 * Where the app lands on launch and on every return to the foreground
 * (spec §4). The engine wins: under the Android foreground service a
 * broadcast can outlive the UI, and hiding it would be the worst lie the app
 * could tell. S0 builds only Live Stream; S2 and S4 widen the union.
 */
export function reopenTarget(input: {
  engine: EngineStatus;
  saved: SavedState;
  now: Date;
}): ReopenTarget {
  const { engine, saved, now } = input;
  if (engine === 'armed' || engine === 'live') return { go: 'stream' };
  if (saved.active !== 'stream') return { go: 'home' };
  const code = saved.codes.stream;
  if (code === undefined) return { go: 'home' };
  if (code.expiresAt !== null && isExpired(code, now)) {
    return {
      go: 'home',
      notice: { mode: 'stream', expiredAt: code.expiresAt, venueTz: venueZone(code) },
    };
  }
  return { go: 'stream' };
}

/**
 * N4 (owner-visible): an ended session is shown only on its own code's Ended
 * screen. Once the phone no longer holds that code — expired, or never saved
 * — nothing can show it, and the next code opened would land on its Ended
 * screen instead of arming. The reopen gate clears it on the way Home. A code
 * still saved, active or not, keeps its session: Continue opens it, truthfully.
 */
export function orphanedSession(input: {
  engine: EngineStatus;
  saved: SavedState;
  now: Date;
}): boolean {
  const { engine, saved, now } = input;
  if (engine !== 'stopped' && engine !== 'failed') return false;
  const code = saved.codes.stream;
  return code === undefined || isExpired(code, now);
}

/** Modes whose saved code has expired. The caller deletes them after reading the target. */
export function expiredModes(saved: SavedState, now: Date): readonly Mode[] {
  return Object.values(saved.codes)
    .filter((code): code is SavedCode => code !== undefined)
    .filter((code) => isExpired(code, now))
    .map((code) => code.mode);
}

export type LeaveRule = 'free' | 'freeAndForget' | 'blockedOnAir';

/**
 * Decision 5. Only Live Stream exists in S0; Scoring's "N scores haven't
 * sent yet" and the Dashboard's rule arrive with their modes.
 */
export function leaveRule(mode: 'stream', engine: EngineStatus): LeaveRule {
  void mode;
  switch (engine) {
    case 'live':
      return 'blockedOnAir';
    case 'stopped':
      return 'freeAndForget';
    case 'idle':
    case 'armed':
    case 'failed':
      return 'free';
  }
}
