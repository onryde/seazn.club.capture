import { useCallback, useEffect, useRef, useState } from 'react';
import { leaveRule, type EngineStatus, type LeaveRule } from '@/domain/mode/reopen';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { Logger } from '@/services/logger';
import type { ModeStore } from '@/services/modeStore';

type FreeRule = Exclude<LeaveRule, 'blockedOnAir'>;

/**
 * Leaving Live Stream (spec decision 5). On air it cannot be left: Home is
 * hidden and Back explains how to stop. Stopped means the code is spent and
 * forgotten; anything else keeps it, so a failed broadcast is one tap from
 * being retried. Back on the stream route is always handled here, so Android
 * never closes the app from this screen. Back on another route (a stream
 * sub-screen such as Settings, under which this stays mounted) is the
 * navigator's: it goes back, and never runs the leave rule.
 */
export function useStreamLeave(): {
  readonly canLeave: boolean;
  readonly blocked: boolean;
  leave(): void;
} {
  const { back, navigation } = usePorts();
  const status = useEngineSelector(selectEngineStatus);
  const [blocked, setBlocked] = useState(false);
  const block = useCallback(() => setBlocked(true), []);
  const leaveOnce = useLeaveOnce(block);

  const leave = useCallback(() => {
    const rule = leaveRule('stream', status);
    if (rule === 'blockedOnAir') return block();
    leaveOnce(rule);
  }, [status, leaveOnce, block]);

  useEffect(() => {
    if (status !== 'live') setBlocked(false);
  }, [status]);

  useEffect(
    () =>
      back.subscribe(() => {
        if (navigation.current() !== 'stream') return false;
        leave();
        return true;
      }),
    [back, navigation, leave],
  );

  return { canLeave: leaveRule('stream', status) !== 'blockedOnAir', blocked, leave };
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
function useLeaveOnce(onBlocked: () => void): (rule: FreeRule) => void {
  const { modeStore, navigation, engine, logger } = usePorts();
  const pending = useRef(false);
  return useCallback(
    (rule: FreeRule) => {
      if (pending.current) return;
      pending.current = true;
      void saveLeave(modeStore, rule, logger).then(() => {
        pending.current = false;
        const status = selectEngineStatus(engine.getSnapshot());
        if (leaveRule('stream', status) === 'blockedOnAir') {
          logger.warn('leave.cancelled-on-air', { action: rule });
          return onBlocked();
        }
        if (clearsSession(rule, status)) engine.send({ kind: 'reset' });
        navigation.go('home');
      });
    },
    [modeStore, navigation, engine, logger, onBlocked],
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
