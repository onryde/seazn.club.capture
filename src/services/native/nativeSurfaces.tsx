import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { OverlayProps, Surfaces, VideoProps } from '@/services/surfaces';

/** Empty until phase 4 hands the engine's native preview in (spec §3 Bridge). */
function NativePreview() {
  return <View style={styles.fill} />;
}

const ORIGINS = ['https://*'];

/**
 * The Tier A route in a transparent WebView (AGENTS §7). It never takes a
 * touch — the controls live in the gutters — and every way it can fail is
 * reported, so the stage can say so instead of going quietly blank.
 */
function NativeOverlay({ url, onFailed }: OverlayProps) {
  return (
    <View pointerEvents="none" style={styles.clear}>
      <WebView
        source={{ uri: url }}
        style={styles.clear}
        containerStyle={styles.clear}
        originWhitelist={ORIGINS}
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction
        onError={onFailed}
        onHttpError={onFailed}
        onRenderProcessGone={onFailed}
        onContentProcessDidTerminate={onFailed}
      />
    </View>
  );
}

function muted(player: VideoPlayer): void {
  player.muted = true;
  player.loop = false;
}

/** ExoPlayer on Android. `useCaching: false`: a manifest is fetched live, never stored (D37). */
function NativeVideo({ url, playing }: VideoProps) {
  const player = useVideoPlayer({ uri: url, useCaching: false }, muted);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  return (
    <VideoView player={player} style={styles.fill} nativeControls={false} contentFit="contain" />
  );
}

export function createNativeSurfaces(): Surfaces {
  return { Preview: NativePreview, Overlay: NativeOverlay, Video: NativeVideo };
}

const styles = StyleSheet.create({
  // RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone (carry 6).
  fill: { ...StyleSheet.absoluteFill },
  // D33: services cannot import theme tokens; 'transparent' is the absence of a colour.
  clear: { ...StyleSheet.absoluteFill, backgroundColor: 'transparent' },
});
