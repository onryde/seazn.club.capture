import { navigationHost, staysOnOverlayOrigin } from '@/domain/credentials/overlayNavigation';
import type { Logger } from '@/services/logger';

/**
 * I1. react-native-webview 13.16.1 checks `originWhitelist` in JS before any
 * handler of ours (lib/WebViewShared.js, `createOnShouldStartLoadWithRequest`),
 * and hands every URL that misses it to `Linking.openURL`: an `intent:` or a
 * foreign page would open another app over a live broadcast, and on iOS the
 * camera stops in the background (P1). So the whitelist lets every URL
 * through, and `overlayNavigationGuard` alone decides, confining the page to
 * its own origin. overlayGuard.test.ts runs the vendor function to prove it.
 */
export const OVERLAY_ORIGIN_WHITELIST: string[] = ['*'];

/**
 * The `onShouldStartLoadWithRequest` for one overlay URL: its own origin
 * loads; anything else is refused, never opened elsewhere, logged by host
 * alone (`overlay.blocked`), and reported as an overlay failure, so the stage
 * says so instead of showing a page nobody vouched for.
 */
export function overlayNavigationGuard(deps: {
  readonly url: string;
  readonly onFailed: () => void;
  readonly logger: Logger;
}): (request: { readonly url: string }) => boolean {
  return (request) => {
    if (staysOnOverlayOrigin(deps.url, request.url)) return true;
    deps.logger.warn('overlay.blocked', { host: navigationHost(request.url) });
    deps.onFailed();
    return false;
  };
}

/**
 * Injected before the page's content (I1). Android grants a page's camera and
 * microphone whenever the app holds those permissions — which a streaming
 * phone always does — and 13.16.1 has no prop to refuse it; iOS has
 * `mediaCapturePermissionGrantType="deny"`. This removes every way to ask, and
 * seals it so the page cannot put it back. Best effort on Android, where
 * 13.16.1 runs it from `onPageStarted` rather than at document start; origin
 * confinement is the control there. `seal` swallows what it cannot define (no
 * `mediaDevices` outside a secure context). Ends on `true`, as the WebView expects.
 */
export const NO_MEDIA_CAPTURE = `(function () {
  function refuse() {
    return Promise.reject(new Error('Media capture is off in the overlay preview'));
  }
  function seal(target, name) {
    try {
      Object.defineProperty(target, name, { value: refuse, writable: false, configurable: false });
    } catch (e) {}
  }
  if (typeof MediaDevices !== 'undefined') {
    seal(MediaDevices.prototype, 'getUserMedia');
    seal(MediaDevices.prototype, 'getDisplayMedia');
  }
  seal(navigator.mediaDevices, 'getUserMedia');
  seal(navigator.mediaDevices, 'getDisplayMedia');
  seal(navigator, 'getUserMedia');
  seal(navigator, 'webkitGetUserMedia');
})();
true;`;
