import { useCallback, useEffect, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { useStableCallback } from '@/hooks/useStableCallback';

type Trouble = 'overlay.failed' | 'overlay.crashed' | 'overlay.absent';

export type OverlayAttempt = {
  /** Once true the WebView comes down, so its own error plate never shows (carry 9). */
  readonly failed: boolean;
  /** For the surface's `onFailed`: stable for the attempt's life (carry 11). */
  readonly fail: () => void;
  /** For the error boundary's `onCatch`. */
  readonly crash: () => void;
};

/**
 * One attempt at drawing the overlay, for one URL and one showing. However
 * many ways it goes wrong — a load error, a refused top frame, a crash, or no
 * URL at all (carry 8) — it is logged once and told to the stage once.
 */
export function useOverlayAttempt(url: string | null, onFailed: () => void): OverlayAttempt {
  const { logger } = usePorts();
  const tell = useStableCallback(onFailed);
  const reported = useRef(false);
  const [failed, setFailed] = useState(false);
  const report = useCallback(
    (trouble: Trouble) => {
      if (reported.current) return;
      reported.current = true;
      if (trouble === 'overlay.crashed') logger.error(trouble);
      else logger.warn(trouble);
      setFailed(true);
      tell();
    },
    [logger, tell],
  );
  const fail = useCallback(() => report('overlay.failed'), [report]);
  const crash = useCallback(() => report('overlay.crashed'), [report]);
  useEffect(() => {
    if (url === null) report('overlay.absent');
  }, [url, report]);
  return { failed, fail, crash };
}
