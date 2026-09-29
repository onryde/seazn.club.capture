import { useCallback, useEffect, useRef, useState } from 'react';
import { leaveRule, type LeaveRule } from '@/domain/mode/reopen';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { ModeStore } from '@/services/modeStore';

type FreeRule = Exclude<LeaveRule, 'blockedOnAir'>;

/**
 * Leaving Live Stream (spec decision 5). On air it cannot be left: Home is
 * hidden and Back explains how to stop. Stopped means the code is spent and
 * forgotten; anything else keeps it, so a failed broadcast is one tap from
 * being retried. Back is always handled here, so Android never closes the
 * app from this screen.
 */
export function useStreamLeave(): {
  readonly canLeave: boolean;
  readonly blocked: boolean;
  leave(): void;
} {
  const { back } = usePorts();
  const status = useEngineSelector(selectEngineStatus);
  const [blocked, setBlocked] = useState(false);
  const leaveOnce = useLeaveOnce();

  const leave = useCallback(() => {
    const rule = leaveRule('stream', status);
    if (rule === 'blockedOnAir') return setBlocked(true);
    leaveOnce(rule);
  }, [status, leaveOnce]);

  useEffect(() => {
    if (status !== 'live') setBlocked(false);
  }, [status]);

  useEffect(
    () =>
      back.subscribe(() => {
        leave();
        return true;
      }),
    [back, leave],
  );

  return { canLeave: status !== 'live', blocked, leave };
}

/**
 * One leave at a time: a double tap, or Back and Home together, while the
 * first write is pending would otherwise write twice and navigate twice. Set
 * only once a leave is allowed, so a Back refused on air never sets it, and
 * released when the write settles either way, so it can never stick.
 */
function useLeaveOnce(): (rule: FreeRule) => void {
  const { modeStore, navigation } = usePorts();
  const pending = useRef(false);
  return useCallback(
    (rule: FreeRule) => {
      if (pending.current) return;
      pending.current = true;
      void saveLeave(modeStore, rule).then(() => {
        pending.current = false;
        navigation.go('home');
      });
    },
    [modeStore, navigation],
  );
}

/**
 * The leave's one write, which never rejects (R30). A refused write still
 * leaves: the operator asked to go, and a stale active mode only means the
 * next foreground reopens Stream, which is one more leave. Async, so a write
 * that throws before returning a promise lands here too.
 */
async function saveLeave(modeStore: ModeStore, rule: FreeRule): Promise<void> {
  try {
    await (rule === 'freeAndForget' ? modeStore.forget('stream') : modeStore.setActive(null));
  } catch {
    // Gap: S0 has no logger, so a refused leave write is recorded nowhere.
  }
}
