import type { Mode } from '@/domain/mode/Mode';
import { isExpired, type SavedCode } from '@/domain/mode/savedCode';

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
  | { readonly go: 'home'; readonly notice?: { readonly mode: Mode; readonly expiredAt: Date } };

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
    return { go: 'home', notice: { mode: 'stream', expiredAt: code.expiresAt } };
  }
  return { go: 'stream' };
}

/** Modes whose saved code has expired. The caller deletes them after reading the target. */
export function expiredModes(saved: SavedState, now: Date): readonly Mode[] {
  return (Object.values(saved.codes) as SavedCode[])
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
