import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useClockTick } from '@/hooks/useClockTick';

/** CD17: three seconds without a report, from Pairing on, is an engine that has stopped answering. */
export const ENGINE_SILENT_MS = 3_000;

export const selectReportedAtMs = (snapshot: EngineSnapshot): number => snapshot.reportedAtMs;

/**
 * Native holds a pairing from Pairing until Idle or Ended, and reports at 1 Hz
 * all that while (the heartbeat contract, amendment §2). At rest or ended a
 * quiet engine is no news, and `UNREPORTED`'s 0 is idle.
 */
const holdsPairing = (kind: SessionState['kind']): boolean => kind !== 'idle' && kind !== 'ended';

/**
 * CD17. A report from the future (an NTP step) is not silence. A refused
 * snapshot is not either: the native engine keeps the last good facts with the
 * time the refused one arrived (review C4c I-4), so only native saying nothing
 * at all reads here.
 */
export function isEngineSilent(
  kind: SessionState['kind'],
  reportedAtMs: number,
  nowMs: number,
): boolean {
  return holdsPairing(kind) && nowMs - reportedAtMs > ENGINE_SILENT_MS;
}

/**
 * CD17 as the viewfinder reads it: a 1 Hz tick at this hook, and only while
 * native holds a pairing (AGENTS §8: never context). A display rule over the
 * projection; native's state is untouched (AGENTS §2).
 */
export function useEngineSilent(): boolean {
  const kind = useEngineSelector(selectStateKind);
  const reportedAtMs = useEngineSelector(selectReportedAtMs);
  const nowMs = useClockTick(holdsPairing(kind));
  return isEngineSilent(kind, reportedAtMs, nowMs);
}
