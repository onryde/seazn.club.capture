import { useCallback, useEffect, useRef, useState } from 'react';
import { leaveRule, type EngineStatus, type LeaveRule } from '@/domain/mode/reopen';
import { selectEngineStatus, selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import { useOwnSession, useSavedStream } from '@/hooks/useSavedStream';
import { isStreamSubRoute } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';
import type { ModeStore } from '@/services/modeStore';

type FreeRule = Exclude<LeaveRule, 'blockedOnAir'>;

const NOTHING = () => undefined;

/** Ruling I2: how long Back's line on air stays, unless the state changes first. */
const REFUSAL_LINE_MS = 4000;

/**
 * Leaving Live Stream (spec decision 5). On air it cannot be left: Home is
 * hidden and Back explains how to stop. Stopped means the code is spent and
 * forgotten; anything else keeps it, so a failed broadcast is one tap from
 * being retried. Back is always handled here, so Android never closes the app
 * from this screen, except on a named stream sub-screen (Settings or
 * Diagnostics, under which this stays mounted): there it is that screen's,
 * which goes back to the camera and never runs the leave rule.
 */
export function useStreamLeave(): {
  readonly canLeave: boolean;
  readonly blocked: boolean;
  leave(): void;
  /** A leave that runs `beforeHome` only if it goes Home, just before it goes (M9). */
  leaveWith(beforeHome: () => void): void;
  /** Whether this visit has started a leave, cancelled or not (ruling I1). Stable. */
  departed(): boolean;
} {
  const status = useEngineSelector(selectEngineStatus);
  // Fix round 3: a stopped session spends this code only if it is this code's.
  const own = useOwnSession(useSavedStream());
  const [blocked, block] = useRefusalLine();
  const left = useRef(false);
  const departed = useCallback(() => left.current, []);
  const leaveOnce = useLeaveOnce(block, left);

  const leaveWith = useCallback(
    (beforeHome: () => void) => {
      const rule = leaveRule('stream', status, own);
      if (rule === 'blockedOnAir') return block();
      leaveOnce(rule, beforeHome);
    },
    [status, own, leaveOnce, block],
  );
  const leave = useCallback(() => leaveWith(NOTHING), [leaveWith]);
  useBackLeaves(leave);
  const canLeave = leaveRule('stream', status, own) !== 'blockedOnAir';
  return { canLeave, blocked, leave, leaveWith, departed };
}

/**
 * Back is a leave, except on a named stream sub-screen (M21). This handler is
 * re-subscribed on every status change, so it is often asked before the
 * sub-screen's own; it gives Back away only on a route `isStreamSubRoute`
 * names, never on a `current()` it did not expect, which on air would hand
 * Back to Android and put the broadcast's app in the background.
 */
function useBackLeaves(leave: () => void): void {
  const { back, navigation } = usePorts();
  useEffect(
    () =>
      back.subscribe(() => {
        if (isStreamSubRoute(navigation.current())) return false;
        leave();
        return true;
      }),
    [back, navigation, leave],
  );
}

/**
 * Ruling I2 (owner-visible): Back's line on air is brief. Each refused Back
 * says it for REFUSAL_LINE_MS again; the engine's next change of state kind
 * ends it sooner, the end of the broadcast included. A change that keeps the
 * kind (another degrade reason or reconnect cause) brings a fault line, which
 * outranks it on screen anyway (`columnLineKey`).
 */
function useRefusalLine(): [boolean, () => void] {
  const kind = useEngineSelector(selectStateKind);
  // 0 is no line; each refusal is a new count, so a second Back restarts the time.
  const [refusal, setRefusal] = useState(0);
  const [seenKind, setSeenKind] = useState(kind);
  if (seenKind !== kind) {
    setSeenKind(kind);
    setRefusal(0);
  }
  useEffect(() => {
    if (refusal === 0) return;
    const timer = setTimeout(() => setRefusal(0), REFUSAL_LINE_MS);
    return () => clearTimeout(timer);
  }, [refusal]);
  const refuse = useCallback(() => setRefusal((count) => count + 1), []);
  return [refusal !== 0, refuse];
}

/**
 * One leave at a time: a double tap, or Back and Home together, while the
 * first write is pending would otherwise write twice and navigate twice. Set
 * only once a leave is allowed, so a Back refused on air never sets it, and
 * released when the write settles either way, so it can never stick.
 *
 * T14 M2: once the write settles the rule is read again, because native may
 * have moved on while the phone was writing. On air now means stay, with the
 * leave-on-air line; the engine is the authority, so nothing is written back
 * — a reopen goes to the stream whatever is saved (spec §1).
 */
function useLeaveOnce(onBlocked: () => void, left: { current: boolean }): FinishLeave {
  const { modeStore, logger } = usePorts();
  const finish = useFinishLeave(onBlocked);
  const pending = useRef(false);
  return useCallback(
    (rule: FreeRule, beforeHome: () => void) => {
      if (pending.current) return;
      pending.current = true;
      left.current = true;
      void saveLeave(modeStore, rule, logger).then(() => {
        pending.current = false;
        finish(rule, beforeHome);
      });
    },
    [modeStore, logger, finish, left],
  );
}

type FinishLeave = (rule: FreeRule, beforeHome: () => void) => void;

/** Once the write settles: stay if native went on air meanwhile (T14 M2), else go Home. */
function useFinishLeave(onBlocked: () => void): FinishLeave {
  const { navigation, engine, logger } = usePorts();
  return useCallback(
    (rule: FreeRule, beforeHome: () => void) => {
      const status = selectEngineStatus(engine.getSnapshot());
      // Only on air matters here, and whose session it is never changes that.
      if (leaveRule('stream', status, false) === 'blockedOnAir') {
        logger.warn('leave.cancelled-on-air', { action: rule });
        return onBlocked();
      }
      beforeHome();
      if (clearsSession(rule, status)) engine.send({ kind: 'reset' });
      navigation.go('home');
    },
    [navigation, engine, logger, onBlocked],
  );
}

/**
 * I1: a stopped session is cleared only if this leave forgot its code — a
 * session that moved on meanwhile is not ours to clear. Left `stopped`, the
 * engine would make the next code's first leave a forget too. D11: a failed
 * one is always cleared; its code is kept, so Continue re-arms instead of
 * landing on Ended. Sent however the write went: a refused forget leaves the
 * spent code saved, and it waits on the Continue card until it expires or is
 * forgotten (spec §4).
 */
function clearsSession(rule: FreeRule, status: EngineStatus): boolean {
  return status === 'failed' || (rule === 'freeAndForget' && status === 'stopped');
}

/**
 * The leave's one write, which never rejects (R30). A refused write still
 * leaves — the operator asked to go — and is recorded (spec §5). A stale
 * active mode only means the next foreground reopens Stream, which is one
 * more leave. Async, so a write that throws before returning a promise lands
 * here too.
 */
async function saveLeave(modeStore: ModeStore, rule: FreeRule, logger: Logger): Promise<void> {
  try {
    await (rule === 'freeAndForget' ? modeStore.forget('stream') : modeStore.setActive(null));
  } catch {
    logger.warn('store.write-refused', { action: 'leave' });
  }
}
