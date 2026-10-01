import { useCallback, useState, useSyncExternalStore } from 'react';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import { diagnosticsSections, type DiagnosticsSection } from '@/hooks/diagnostics';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import type { SharePort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';
import type { SessionRecord } from '@/services/sessionRecord';

/**
 * D32: the whole snapshot, on purpose. Diagnostics shows ticking values and is
 * not the HUD, so it re-renders at each 1 Hz report; it subscribes through the
 * engine selector, never through Context (AGENTS §8).
 */
const wholeSnapshot = (snapshot: EngineSnapshot): EngineSnapshot => snapshot;

/** Spec §4's link, delivery, phone and heartbeat values, read at the report's own clock. */
export function useDiagnostics(): readonly DiagnosticsSection[] {
  const { t } = useT();
  const { clock } = usePorts();
  const snapshot = useEngineSelector(wholeSnapshot);
  return diagnosticsSections(snapshot, clock().getTime(), t);
}

/**
 * The session record as it grows, and Share record (D21). The record is
 * scrubbed when written (Task 1's allow-list), so sharing sends nothing that
 * was not already safe to keep. A refused share sheet says so and is
 * recorded; the next share that opens clears it.
 */
export function useSessionRecord(): {
  readonly lines: readonly string[];
  readonly shareFailed: boolean;
  share(): void;
} {
  const { record, share, logger } = usePorts();
  const lines = useSyncExternalStore(record.subscribe, record.lines);
  const [shareFailed, setShareFailed] = useState(false);
  const send = useCallback(() => {
    void shareRecord(share, record, logger).then((opened) => setShareFailed(!opened));
  }, [share, record, logger]);
  return { lines, shareFailed, share: send };
}

/** Never rejects; async, so a port that throws before returning a promise lands here too. */
async function shareRecord(
  share: SharePort,
  record: SessionRecord,
  logger: Logger,
): Promise<boolean> {
  const lines = record.lines();
  try {
    await share.share(lines.join('\n'));
  } catch {
    logger.warn('record.share-failed');
    return false;
  }
  // M15: `count` is on the scrub's allow-list; `lines` would be scrubbed.
  logger.info('record.shared', { count: lines.length });
  return true;
}
