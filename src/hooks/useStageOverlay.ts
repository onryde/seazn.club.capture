import { useCallback, useState } from 'react';
import { selectShedding } from '@/hooks/advisory';
import { selectHasDescriptor, selectOverlayUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';

export type StageOverlay = {
  readonly url: string | null;
  /** Any step down the ladder sheds the overlay first (AGENTS §8). */
  readonly shed: boolean;
  readonly visible: boolean;
  /** The top strip's overlay-failed caption (D17). */
  readonly failed: boolean;
  readonly onFailed: () => void;
};

/**
 * Whether the score preview is drawn over the stage, and whether it failed.
 * It is tried only once native holds a session: before the arm there is no
 * descriptor, so no overlay to miss.
 */
export function useStageOverlay(overlayOn: boolean): StageOverlay {
  const shed = useEngineSelector(selectShedding);
  const armedWith = useEngineSelector(selectHasDescriptor);
  const url = useEngineSelector(selectOverlayUrl);
  const [failed, setFailed] = useState(false);
  const onFailed = useCallback(() => setFailed(true), []);
  const visible = overlayOn && armedWith && !shed && !failed;
  return { url, shed, visible, failed, onFailed };
}
