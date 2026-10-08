import { useEffect, useSyncExternalStore } from 'react';
import type { EndedCard } from '@/domain/session/endedCard';
import {
  selectCodeEndedPending,
  selectEndedDurationMs,
  selectEndReason,
} from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/** The Stream ended card Home shows, or null (spec §5). */
export function useEndedCard(): EndedCard | null {
  const { endedNotice } = usePorts();
  return useSyncExternalStore(endedNotice.subscribe, endedNotice.getSnapshot);
}

/**
 * Spec §5: an Ended (the phone's Stop after live, or a fatal end) leaves for Home by the
 * one leave rule, and shows the card only if that leave really goes Home (M9). A Stop
 * before the first frame is Paired, never Ended, so it stays.
 */
export function useEndedToHome(leaveWith: (beforeHome: () => void) => void): void {
  const { endedNotice } = usePorts();
  const reason = useEngineSelector(selectEndReason);
  const durationMs = useEngineSelector(selectEndedDurationMs);
  const codeEnded = useEngineSelector(selectCodeEndedPending); // F14 a
  useEffect(() => {
    if (reason === null) return;
    leaveWith(() => endedNotice.show({ reason, durationMs, codeEnded }));
  }, [reason, durationMs, codeEnded, leaveWith, endedNotice]);
}
