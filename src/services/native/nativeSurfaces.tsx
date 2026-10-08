import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import type { WebViewProps } from 'react-native-webview';
import type { Logger } from '@/services/logger';
import {
  NO_MEDIA_CAPTURE,
  OVERLAY_ORIGIN_WHITELIST,
  overlayNavigationGuard,
} from '@/services/overlayGuard';
import type { OverlayProps, Surfaces, VideoProps, VideoStatus } from '@/services/surfaces';

type WebViewPackage = typeof import('react-native-webview');
type VideoPackage = typeof import('expo-video');

/** The engine module's native preview view (Task 39); it fills its parent, the camera box. */
export type PreviewView = ComponentType<{ style?: StyleProp<ViewStyle> }>;

/**
 * Where the two native packages come from. Both are loaded on first draw, not
 * at launch (m3): each one's native half throws on import when the binary
 * lacks it (expo-video's `requireNativeModule('ExpoVideo')`, the WebView's
 * `TurboModuleRegistry.getEnforcing`), and a static import here would take the
 * whole app down at boot instead of one surface.
 */
export type SurfacePackages = {
  readonly webview: () => Promise<WebViewPackage>;
  readonly video: () => Promise<VideoPackage>;
  /** The engine module's view, or null where the module is not in the binary (no failure). */
  readonly preview: () => Promise<PreviewView | null>;
};

/**
 * Task 39: the engine module's default view, behind the optional-module check the engine itself is
 * chosen by (`requireOptionalNativeModule`, CD23): null on iOS in S1, in Expo Go and on web. `expo`
 * comes in on first draw, as the two packages do (m3).
 */
async function installedPreview(): Promise<PreviewView | null> {
  const { requireNativeView, requireOptionalNativeModule } = await import('expo');
  if (requireOptionalNativeModule('CaptureEngine') === null) return null;
  return requireNativeView<{ style?: StyleProp<ViewStyle> }>('CaptureEngine');
}

const INSTALLED: SurfacePackages = {
  webview: () => import('react-native-webview'),
  video: () => import('expo-video'),
  preview: installedPreview,
};

/** A package loaded at most once: `undefined` while loading, `null` if it is missing. */
type Lazy<T> = {
  readonly current: () => T | null | undefined;
  readonly load: () => Promise<T | null>;
};

function lazyPackage<T>(load: () => Promise<T>, onMissing: () => void): Lazy<T> {
  let settled: T | null | undefined;
  let loading: Promise<T | null> | null = null;
  const missing = (): null => {
    onMissing();
    return (settled = null);
  };
  return {
    current: () => settled,
    // `Promise.resolve().then(load)`: a loader that throws synchronously is missing too.
    load: () =>
      (loading ??= Promise.resolve()
        .then(load)
        .then((value) => (settled = value), missing)),
  };
}

function usePackage<T>(lazy: Lazy<T>): T | null | undefined {
  const [value, setValue] = useState(lazy.current);
  useEffect(() => {
    // After an unmount this set is a no-op (React 18+), so it needs no guard.
    void lazy.load().then((loaded) => setValue(() => loaded));
  }, [lazy]);
  return value;
}

/**
 * I1: the page may load its own origin and nothing else. Every URL reaches
 * our guard (see OVERLAY_ORIGIN_WHITELIST for why the whitelist is open);
 * no windows, no file access, no camera or microphone.
 */
const LOCKDOWN = {
  originWhitelist: OVERLAY_ORIGIN_WHITELIST,
  setSupportMultipleWindows: false,
  javaScriptCanOpenWindowsAutomatically: false,
  mediaCapturePermissionGrantType: 'deny',
  mediaPlaybackRequiresUserAction: true,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  injectedJavaScriptBeforeContentLoaded: NO_MEDIA_CAPTURE,
  injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false,
} satisfies WebViewProps;

type ConfinedProps = OverlayProps & {
  readonly WebView: WebViewPackage['WebView'];
  readonly logger: Logger;
};

/**
 * The Tier A route in a transparent WebView (AGENTS §7). It never takes a
 * touch — the controls live in the gutters — and every way it can fail is
 * reported, so the stage can say so instead of going quietly blank.
 */
function ConfinedWebView({ WebView, url, onFailed, logger }: ConfinedProps) {
  const source = useMemo(() => ({ uri: url }), [url]);
  const guard = useMemo(
    () => overlayNavigationGuard({ url, onFailed, logger }),
    [url, onFailed, logger],
  );
  return (
    <View pointerEvents="none" style={styles.clear}>
      <WebView
        {...LOCKDOWN}
        source={source}
        style={styles.clear}
        containerStyle={styles.clear}
        onShouldStartLoadWithRequest={guard}
        onError={onFailed}
        onHttpError={onFailed}
        onRenderProcessGone={onFailed}
        onContentProcessDidTerminate={onFailed}
      />
    </View>
  );
}

type OverlayStageProps = OverlayProps & {
  readonly webview: WebViewPackage | null | undefined;
  readonly logger: Logger;
};

/** Nothing while the package loads; a missing one is an overlay failure (m3). */
function OverlayStage({ webview, url, onFailed, logger }: OverlayStageProps) {
  useEffect(() => {
    if (webview === null) onFailed();
  }, [webview, onFailed]);
  if (!webview) return null;
  return (
    <ConfinedWebView WebView={webview.WebView} url={url} onFailed={onFailed} logger={logger} />
  );
}

function muted(player: VideoPlayer): void {
  player.muted = true;
  player.loop = false;
}

/**
 * expo-video's `statusChange` word, in ours (spec §9). Anything it adds later reads as loading: a new word is
 * never taken for a picture.
 */
const STATUS: Readonly<Record<string, VideoStatus>> = {
  readyToPlay: 'ready',
  error: 'failed',
  loading: 'loading',
  idle: 'loading',
};

/**
 * ExoPlayer on Android. `useCaching: false`: a manifest is fetched live, never stored (D37). It tells the
 * viewer layer what the player says of itself, and plays the moment it is ready while it is wanted (D6).
 */
function MutedVideo({
  url,
  playing,
  onStatus,
  expoVideo,
}: VideoProps & { readonly expoVideo: VideoPackage }) {
  const source = useMemo(() => ({ uri: url, useCaching: false }), [url]);
  const player = expoVideo.useVideoPlayer(source, muted);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const report = (status: string) => {
      // An own key only: a status word named like something on Object is not one of ours.
      const mapped = Object.hasOwn(STATUS, status) ? STATUS[status] : 'loading';
      onStatus?.(mapped);
      // The start fix (D6): a player that became ready while it is wanted plays at once.
      if (mapped === 'ready' && playingRef.current) player.play();
    };
    const subscription = player.addListener('statusChange', ({ status }) => report(status));
    report(player.status); // it may be ready before the listener was attached
    return () => subscription.remove();
  }, [player, onStatus]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  const { VideoView } = expoVideo;
  return (
    <VideoView player={player} style={styles.fill} nativeControls={false} contentFit="contain" />
  );
}

/**
 * The surfaces port on a phone. `surface.unavailable` is logged once per
 * missing package; each overlay drawn without its package reports a failure.
 */
export function createNativeSurfaces(deps: {
  readonly logger: Logger;
  readonly packages?: SurfacePackages;
}): Surfaces {
  const { logger } = deps;
  const packages = deps.packages ?? INSTALLED;
  const unavailable = (kind: 'overlay' | 'video' | 'preview') => () =>
    logger.warn('surface.unavailable', { kind });
  const webview = lazyPackage(packages.webview, unavailable('overlay'));
  const video = lazyPackage(packages.video, unavailable('video'));
  const preview = lazyPackage(packages.preview, unavailable('preview'));

  /** The engine's native preview (spec §3 Bridge, carry 9); an empty stage while loading or absent. */
  function NativePreview() {
    const Preview = usePackage(preview);
    if (!Preview) return <View style={styles.fill} />;
    return <Preview style={styles.fill} />;
  }

  function NativeOverlay(props: OverlayProps) {
    return <OverlayStage {...props} webview={usePackage(webview)} logger={logger} />;
  }
  function NativeVideo(props: VideoProps) {
    const expoVideo = usePackage(video);
    if (!expoVideo) return <View style={styles.fill} />;
    return <MutedVideo {...props} expoVideo={expoVideo} />;
  }
  return { Preview: NativePreview, Overlay: NativeOverlay, Video: NativeVideo };
}

const styles = StyleSheet.create({
  // RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone (carry 6).
  fill: { ...StyleSheet.absoluteFill },
  // D33: services cannot import theme tokens; 'transparent' is the absence of a colour.
  clear: { ...StyleSheet.absoluteFill, backgroundColor: 'transparent' },
});
