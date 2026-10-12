import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { selectBroadcastHeld } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { RecordSendView } from '@/services/recordSendFlight';

export type { SendState } from '@/services/recordSendFlight';

export type RecordSend = RecordSendView & {
  /** A broadcast is held (from Arming on): Send waits, so up to 1 MB never rides its uplink (Minor 8, Batch 6 review). */
  readonly held: boolean;
  send(): void;
};

/**
 * R3 of the D3 findings design (owner, 2026-10-11): Send record to Seazn, on the operator's tap only. The request is
 * the ports' (`RecordSendFlight`), so the row's remounts keep it; this reads it, and asks for the credential again at
 * every mount and every return to the foreground.
 */
export function useRecordSend(): RecordSend {
  const { recordSendFlight: flight, foreground } = usePorts();
  const view = useSyncExternalStore(flight.subscribe, flight.getSnapshot);
  const held = useEngineSelector(selectBroadcastHeld);
  useEffect(() => {
    flight.refresh();
    return foreground.subscribe(flight.refresh);
  }, [flight, foreground]);
  return useMemo(() => ({ ...view, held, send: flight.send }), [view, held, flight]);
}
