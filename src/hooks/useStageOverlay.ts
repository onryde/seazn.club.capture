import { useCallback, useEffect, useRef, useState } from 'react';
import { selectShedding } from '@/hooks/advisory';
import { selectHasPairing, selectOverlayKnown, selectOverlayUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

export type StageOverlay = {
  readonly url: string | null;
  /** Any step down the ladder sheds the overlay first (AGENTS §8). */
  readonly shed: boolean;
  readonly visible: boolean;
  /** The status strip's overlay-failed caption (D17), for the showing that failed. */
  readonly failed: boolean;
  readonly onFailed: () => void;
};

/** Never a URL: the showing's key while there is no overlay to show (carry 8). */
const NO_OVERLAY = 'no-overlay';

/**
 * Whether the score preview is drawn over the stage, and whether it failed.
 * It is tried only once native holds a pairing: before the pair there is no
 * overlay URL, so no overlay to miss. A failure belongs to one showing (carry
 * 13): hidden (turned off, shed, disarmed) or given a new URL, the caption
 * clears and the next showing tries again, as OverlayPreview's own attempt does.
 */
export function useStageOverlay(overlayOn: boolean): StageOverlay {
  const shed = useEngineSelector(selectShedding);
  const armedWith = useEngineSelector(selectHasPairing);
  const url = useEngineSelector(selectOverlayUrl);
  const known = useEngineSelector(selectOverlayKnown);
  const visible = overlayOn && armedWith && !shed;
  useNoOverlayLine(visible && known && url === null);
  const showing = visible ? (url ?? NO_OVERLAY) : null;
  const [failed, setFailed] = useState(false);
  const [failedShowing, setFailedShowing] = useState(showing);
  // React's "adjusting state while rendering": no effect, so no frame with a stale caption.
  if (failedShowing !== showing) {
    setFailedShowing(showing);
    setFailed(false);
  }
  const onFailed = useCallback(() => setFailed(true), []);
  return { url, shed, visible, failed, onFailed };
}

/**
 * Final review I-2: the server's word that there is no overlay, for an org not
 * entitled to one (spec :61, :400), is one info line each time a showing
 * begins with none: never a caption, never a warn. A null before the
 * pairing's first answer is not yet known (staging evidence, 2026-10-05: an
 * entitled org's pairing read as absent for the half second before its first
 * beat answered), so it says nothing.
 */
function useNoOverlayLine(none: boolean): void {
  const { logger } = usePorts();
  const said = useRef(false);
  useEffect(() => {
    if (!none) {
      said.current = false;
      return;
    }
    if (said.current) return;
    said.current = true;
    logger.info('overlay.none');
  }, [none, logger]);
}
