import { useEffect, useRef, useState } from 'react';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { selectBroadcastHeld } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';
import type { PowerMode } from '@/services/devicePorts';

type PowerState = {
  readonly mode: PowerMode | null;
  /** I3 of the Batch 5 review: a broadcast is held (from Arming on), so App info must not be opened. */
  readonly held: boolean;
  open(): void;
};

/**
 * R5: the battery mode, read at mount and again at every return to the foreground (the operator may have changed it
 * in App info), and the way to App info. M4 of the Batch 5 review: a return that reads a different mode records it,
 * so the record follows a change the Hold's line could not see.
 */
export function usePowerState(): PowerState {
  const { power, foreground, logger } = usePorts();
  const [mode, setMode] = useState(() => power.mode());
  const last = useRef(mode);
  const held = useEngineSelector(selectBroadcastHeld);
  useEffect(
    () =>
      foreground.subscribe(() => {
        const next = power.mode();
        if (next !== last.current) logger.info('power', { mode: next });
        last.current = next;
        setMode(next);
      }),
    [power, foreground, logger],
  );
  return { mode, held, open: power.openAppSettings };
}
