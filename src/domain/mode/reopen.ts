import type { Mode } from '@/domain/mode/Mode';
import { sameCode, type CodeName } from '@/domain/mode/codeName';
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

/** What a viewfinder visit does with the engine it finds (I1). */
export type VisitArm = 'arm' | 'adopt' | 'replace';

/**
 * I1 (owner-visible): a visit adopts native's session only when it is this
 * code's (`sameCode`): the same match, the same slot (C7: another camera
 * position with its own credential) and the same issue (N2: a re-issued code
 * carries a new token and credentials). Any other armed or ended session, or
 * one native cannot name, is `replace`d (`replaceStep`), then this code armed.
 * Adopting it would show the old session's label and Ended screen, and Go live
 * would publish on the old credentials. Live is always adopted: it cannot
 * reach Home, and replacing it would end a broadcast.
 */
export function visitArm(input: {
  engine: EngineStatus;
  held: CodeName;
  code: CodeName;
}): VisitArm {
  const { engine, held, code } = input;
  if (engine === 'idle') return 'arm';
  if (engine === 'live') return 'adopt';
  return sameCode(held, code) ? 'adopt' : 'replace';
}

/** The one intent that moves another code's session toward this code's arm. */
export type ReplaceStep = 'stop' | 'reset' | 'arm' | null;

/**
 * N1 (plan B's contract, SessionMachine.kt): native resets only from Ended and
 * arms only from Idle. So a replace takes the documented path, one intent per
 * snapshot, each reconciled against the next (intents, not RPC): an armed
 * session is stopped, an ended one reset, and idle is armed. Nothing on air:
 * a replace never ends a broadcast.
 */
export function replaceStep(engine: EngineStatus): ReplaceStep {
  switch (engine) {
    case 'armed':
      return 'stop';
    case 'stopped':
    case 'failed':
      return 'reset';
    case 'idle':
      return 'arm';
    case 'live':
      return null;
  }
}

/**
 * N3 (owner-visible): whether a replacing visit is still on its way to this
 * code's arm. Until it arrives the viewfinder shows not ready ("Waiting for
 * the session details."), never the session it is replacing: not its label,
 * overlay or Ended screen. It arrives when native holds this code's session
 * (`own`) or, for a code the phone cannot use, once the old session is cleared
 * to idle. Never over a broadcast: on air, Stop is always shown.
 */
export function stillReplacing(input: {
  plan: VisitArm;
  own: boolean;
  unusable: boolean;
  engine: EngineStatus;
}): boolean {
  const { plan, own, unusable, engine } = input;
  if (plan !== 'replace' || own || engine === 'live') return false;
  return !(unusable && engine === 'idle');
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
 * sent yet" and the Dashboard's rule arrive with their modes. A stopped
 * session spends the code only when it is this code's (`ownSession`): one
 * left by another code, as a replace finds it on its way through Ended, spends
 * nothing (fix round 3).
 */
export function leaveRule(mode: 'stream', engine: EngineStatus, ownSession: boolean): LeaveRule {
  void mode;
  switch (engine) {
    case 'live':
      return 'blockedOnAir';
    case 'stopped':
      return ownSession ? 'freeAndForget' : 'free';
    case 'idle':
    case 'armed':
    case 'failed':
      return 'free';
  }
}
