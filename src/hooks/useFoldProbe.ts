import { useCallback, useMemo, useRef, useState } from 'react';
import { runFoldProbe, type FoldProbeState } from '@/hooks/foldProbe';
import { usePorts } from '@/hooks/usePorts';

const IDLE: FoldProbeState = { kind: 'idle' };
const RUNNING: FoldProbeState = { kind: 'running' };

/**
 * The Fold probe chip's state and its tap (plan S2-1 Task 1 Step 6). One run at a time: a tap while one runs is the
 * same run. The guard is lowered however the run ends, so a later tap always runs again.
 */
export function useFoldProbe(): { readonly state: FoldProbeState; run(): void } {
  const { logger } = usePorts();
  const [state, setState] = useState<FoldProbeState>(IDLE);
  const busy = useRef(false);
  const run = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState(RUNNING);
    void runFoldProbe(logger)
      .then(setState)
      .finally(() => {
        busy.current = false;
      });
  }, [logger]);
  return useMemo(() => ({ state, run }), [state, run]);
}
