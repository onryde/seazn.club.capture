import { memo } from 'react';
import { overlayPreviewUrl } from '@/domain/session/previewUrls';
import { useOverlayAttempt } from '@/hooks/useOverlayAttempt';
import { usePorts } from '@/hooks/usePorts';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

type OverlayPreviewProps = {
  readonly url: string | null;
  readonly visible: boolean;
  /**
   * The stage then shows the failed caption on the top strip (D17). Told once
   * per attempt; a failure holds until the preview is hidden or its URL
   * changes, and the fresh showing tries again and tells again. So the stage
   * may clear its caption whenever it hides the preview or the URL changes.
   */
  readonly onFailed: () => void;
};

/** Never a URL, so it can key the attempt with no overlay (carry 8). */
const NO_OVERLAY = 'no-overlay';

/**
 * The Tier A scorebug over the camera, never re-drawn in React Native
 * (AGENTS §7). Inside its own boundary: an overlay crash never takes the HUD
 * with it, and shows as a caption, never an opaque plate (spec §4).
 */
export const OverlayPreview = memo(function OverlayPreview({
  url,
  visible,
  onFailed,
}: OverlayPreviewProps) {
  if (!visible) return null;
  return <OverlayAttempt key={url ?? NO_OVERLAY} url={url} onFailed={onFailed} />;
});

const OverlayAttempt = memo(function OverlayAttempt({
  url,
  onFailed,
}: {
  url: string | null;
  onFailed: () => void;
}) {
  const { surfaces } = usePorts();
  const attempt = useOverlayAttempt(url, onFailed);
  if (url === null || attempt.failed) return null;
  const { Overlay } = surfaces;
  return (
    <ErrorBoundary fallback={null} onCatch={attempt.crash}>
      <Overlay url={overlayPreviewUrl(url)} onFailed={attempt.fail} />
    </ErrorBoundary>
  );
});
