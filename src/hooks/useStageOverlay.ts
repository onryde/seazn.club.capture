import { useCallback, useState } from 'react';
import { selectShedding } from '@/hooks/advisory';
import { selectHasDescriptor, selectOverlayUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';

export type StageOverlay = {
  readonly url: string | null;
  /** Any step down the ladder sheds the overlay first (AGENTS §8). */
  readonly shed: boolean;
  readonly visible: boolean;
  /** The top strip's overlay-failed caption (D17), for the showing that failed. */
  readonly failed: boolean;
  readonly onFailed: () => void;
};

/** Never a URL: the showing's key while there is no overlay to show (carry 8). */
const NO_OVERLAY = 'no-overlay';

/**
 * Whether the score preview is drawn over the stage, and whether it failed.
 * It is tried only once native holds a session: before the arm there is no
 * descriptor, so no overlay to miss. A failure belongs to one showing (carry
 * 13): hidden (turned off, shed, disarmed) or given a new URL, the caption
 * clears and the next showing tries again, as OverlayPreview's own attempt does.
 */
export function useStageOverlay(overlayOn: boolean): StageOverlay {
  const shed = useEngineSelector(selectShedding);
  const armedWith = useEngineSelector(selectHasDescriptor);
  const url = useEngineSelector(selectOverlayUrl);
  const visible = overlayOn && armedWith && !shed;
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
