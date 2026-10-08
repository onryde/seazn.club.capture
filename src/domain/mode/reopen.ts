import { sameCode, savedCodeName, type CodeName } from '@/domain/mode/codeName';
import type { Mode } from '@/domain/mode/Mode';
import { isExpired, venueZone, type SavedCode } from '@/domain/mode/savedCode';

/**
 * The engine as the shell sees it. `live` covers every phase that holds a
 * broadcast, Arming and Armed included: each is a broadcast the operator must
 * not walk away from. `paired` covers Pairing and Paired. `ended` splits by
 * reason, because a failure keeps its code so the operator can go straight
 * back in.
 */
export type EngineStatus = 'idle' | 'paired' | 'live' | 'stopped' | 'failed';

export type SavedState = {
  readonly active: Mode | null;
  readonly codes: Readonly<Partial<Record<Mode, SavedCode>>>;
};

export type ReopenTarget =
  | { readonly go: 'stream' }
  | {
      readonly go: 'home';
      /** `venueTz` is the saved waiting fields' zone, so the notice reads in venue time (spec §2). */
      readonly notice?: {
        readonly mode: Mode;
        readonly expiredAt: Date;
        readonly venueTz: string | null;
      };
    };

/**
 * Where the app lands on launch and on every return to the foreground. The
 * engine wins while its process lives (amendment, Process death and reopen):
 * a held broadcast always reopens into /stream, and a paired engine does
 * while its code is saved (R23: an expired one too; I1: none saved is an
 * orphan, cleared on the way Home). An Idle engine reopens into /stream only
 * when the cold-start re-pair was sent (`resumed`); any other Idle engine with
 * a saved code goes Home, to the Continue card. A permanent failure keeps its
 * code; the viewfinder then leaves for Home with the card (spec §5), and the
 * operator's Stop goes Home. A fatal end over a code the server ended forgets it, so it lands on the `home` branch
 * above once the follow has written. S0 builds only Live Stream; S2 and S4 widen the union.
 */
export function reopenTarget(input: {
  engine: EngineStatus;
  saved: SavedState;
  now: Date;
  resumed: boolean;
}): ReopenTarget {
  const { engine, saved, now } = input;
  const code = saved.codes.stream;
  if (engine === 'live') return { go: 'stream' };
  if (engine === 'paired') return { go: code === undefined ? 'home' : 'stream' };
  if (input.resumed) return { go: 'stream' };
  if (saved.active !== 'stream' || code === undefined) return { go: 'home' };
  if (code.expiresAt !== null && isExpired(code, now)) {
    return {
      go: 'home',
      notice: { mode: 'stream', expiredAt: code.expiresAt, venueTz: venueZone(code) },
    };
  }
  return { go: engine === 'failed' ? 'stream' : 'home' };
}

/**
 * N4 (owner-visible): an ended session is shown only on its own code's Ended
 * screen. Once the phone no longer holds that code — expired, or never saved
 * — nothing can show it, and the next code opened would land on its Ended
 * screen instead of arming. The reopen gate clears it on the way Home. A code
 * still saved, active or not, keeps its session: Continue opens it, truthfully.
 *
 * I1 (final review, owner-visible): a pairing with no code saved is an orphan
 * too, or every foreground would reopen a Ready viewfinder for a code the
 * operator forgot. A pairing's expired code still owns it (R23). Never a
 * broadcast: on air nothing is an orphan; the route rule shows it, and only
 * the operator's Stop ends it.
 */
export function orphanedSession(input: {
  engine: EngineStatus;
  saved: SavedState;
  now: Date;
}): boolean {
  const { engine, saved, now } = input;
  const code = saved.codes.stream;
  if (engine === 'paired') return code === undefined;
  if (engine !== 'stopped' && engine !== 'failed') return false;
  return code === undefined || isExpired(code, now);
}

/** The cold-start re-pair's conditions, on an Idle engine (amendment, Process death and reopen). */
export function resumesAtColdStart(input: {
  engine: EngineStatus;
  unpaired: CodeName | null;
  saved: SavedState;
  now: Date;
}): boolean {
  const code = input.saved.codes.stream;
  if (input.engine !== 'idle' || input.saved.active !== 'stream' || code === undefined)
    return false;
  if (isExpired(code, input.now) || code.stream === null || code.stream.tapToPair) return false;
  // A raw that no longer parses has no pair to send: Home and its Continue card say so.
  const name = savedCodeName(code);
  if (name.code === null) return false;
  return input.unpaired === null || !sameCode(input.unpaired, name);
}

/**
 * JS forgets the saved code when native says its pairing ended (amendment, The
 * engine port): `unpaired` names it, or Ended `operator-stopped` does, or an Ended
 * `fatal-error` over a code the server has ended (the follow calls that `stopped`,
 * ruling M-5). Identity, not a comparison of two snapshots, so it is idempotent.
 */
export function forgetsSaved(input: {
  saved: CodeName;
  unpaired: CodeName | null;
  stopped: CodeName | null;
}): boolean {
  const names = (other: CodeName | null) => other !== null && sameCode(other, input.saved);
  return names(input.unpaired) || names(input.stopped);
}

export type TapMark = 'mark' | 'clear' | null;

/**
 * `tapToPair` (amendment): set when the snapshot shows Ended `fatal-error` for
 * the saved code, so the cold-start re-pair skips it and only Continue re-pairs
 * it; cleared once the snapshot shows that code Paired.
 */
export function tapToPairMark(input: {
  saved: CodeName;
  marked: boolean;
  failed: CodeName | null;
  paired: CodeName | null;
}): TapMark {
  if (!input.marked && input.failed !== null && sameCode(input.failed, input.saved)) return 'mark';
  if (input.marked && input.paired !== null && sameCode(input.paired, input.saved)) return 'clear';
  return null;
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
 * left by another code spends nothing (fix round 3).
 */
export function leaveRule(mode: 'stream', engine: EngineStatus, ownSession: boolean): LeaveRule {
  void mode;
  switch (engine) {
    case 'live':
      return 'blockedOnAir';
    case 'stopped':
      return ownSession ? 'freeAndForget' : 'free';
    case 'idle':
    case 'paired':
    case 'failed':
      return 'free';
  }
}
