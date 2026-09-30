import { createElement } from 'react';
import type { OverlayProps, Surfaces, VideoProps } from '@/services/surfaces';

export type FakeSurfaces = Surfaces & {
  /** The WebView reporting a load failure, as onError / onHttpError would. */
  failOverlay(): void;
  /** The overlay throwing while it renders, to reach its error boundary. Set before rendering. */
  crashOverlay(): void;
};

/** Plain elements tests can find; `react` only, so node tests can build ports too. */
export function createFakeSurfaces(): FakeSurfaces {
  let reportFailure: (() => void) | null = null;
  let crashing = false;
  function Preview() {
    return createElement('div', { 'data-testid': 'preview' });
  }
  function Overlay({ url, onFailed }: OverlayProps) {
    if (crashing) throw new Error('overlay crashed');
    reportFailure = onFailed;
    return createElement('div', { 'data-testid': 'overlay', 'data-url': url });
  }
  function Video({ url, playing }: VideoProps) {
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
    crashOverlay: () => {
      crashing = true;
    },
  };
}
