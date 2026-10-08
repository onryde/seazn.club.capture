import { createElement, useEffect } from 'react';
import type { OverlayProps, Surfaces, VideoProps, VideoStatus } from '@/services/surfaces';

export type FakeSurfaces = Surfaces & {
  /** The WebView on screen reporting a load failure, as onError / onHttpError would. */
  failOverlay(): void;
  /** The overlay throwing while it renders, to reach its error boundary. Set before rendering. */
  crashOverlay(): void;
  /** The preview throwing on every render until `restorePreview`, to reach its own boundary (CD19). */
  crashPreview(): void;
  /** The preview renders again; Show preview then brings it back (I4). */
  restorePreview(): void;
  /** The Video on screen reporting a player status, as the native player's listener would (spec §9). */
  videoStatus(status: VideoStatus): void;
  /** How many Videos have mounted, a remount by key (a retry) included; a re-render is not one. */
  videoMounts(): number;
};

/** Plain elements tests can find; `react` only, so node tests can build ports too. Render them to use them. */
export function createFakeSurfaces(): FakeSurfaces {
  let reportFailure: (() => void) | null = null;
  let reportStatus: ((status: VideoStatus) => void) | null = null;
  let mounts = 0;
  let crashing = false;
  let previewCrashing = false;
  function Preview() {
    if (previewCrashing) throw new Error('preview crashed');
    return createElement('div', { 'data-testid': 'preview' });
  }
  function Overlay({ url, onFailed }: OverlayProps) {
    if (crashing) throw new Error('overlay crashed');
    // Held only while this overlay is on screen: a torn-down WebView reports nothing (m5).
    useEffect(() => {
      reportFailure = onFailed;
      return () => {
        if (reportFailure === onFailed) reportFailure = null;
      };
    }, [onFailed]);
    return createElement('div', { 'data-testid': 'overlay', 'data-url': url });
  }
  function Video({ url, playing, onStatus }: VideoProps) {
    useEffect(() => {
      mounts += 1;
    }, []);
    // Held only while this Video is on screen, as the overlay's is: a torn-down player reports nothing.
    useEffect(() => {
      reportStatus = onStatus ?? null;
      return () => {
        if (reportStatus === onStatus) reportStatus = null;
      };
    }, [onStatus]);
    return createElement('div', {
      'data-testid': 'viewer-video',
      'data-url': url,
      'data-playing': String(playing),
    });
  }
  return {
    Preview,
    Overlay,
    Video,
    failOverlay: () => reportFailure?.(),
    videoStatus: (status) => reportStatus?.(status),
    videoMounts: () => mounts,
    crashOverlay: () => {
      crashing = true;
    },
    crashPreview: () => {
      previewCrashing = true;
    },
    restorePreview: () => {
      previewCrashing = false;
    },
  };
}
