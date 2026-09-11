import { useCallback, useState } from 'react';
import { type LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native';
import { useOptionalNativeModule } from '@/hooks/useOptionalNativeModule';
import { PeekNotice } from '@/ui/components/PeekNotice';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * The score overlay, over the operator's own camera (AGENTS.md §7).
 *
 * This renders the **Tier A browser-source route** — the same page the club's
 * OBS and the Fly Machine compositor consume. Never a native reimplementation:
 * that would create a second render path, it would drift, and it would destroy
 * the invariant that a club moving between tiers sees identical output.
 *
 * Not the `/relay` variant, which carries the WHEP video element. Here the
 * camera underneath is already the picture.
 *
 * Two renderers, because `react-native-webview` does not support web at all —
 * it throws an unsupported-view error, and the web build is how this UI gets
 * reviewed on a laptop. On web the same page goes in an `iframe`, which
 * react-native-web can render because it *is* React DOM.
 */

/** The canvas the overlay page is authored against. */
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

type Props = { url: string; visible: boolean; caption?: string };

// Constant for the life of the app, so the component type never changes and
// the hooks inside each branch keep a stable order.
const IS_WEB = Platform.OS === 'web';

export function OverlayPreview(props: Props) {
  return IS_WEB ? <WebOverlay {...props} /> : <NativeOverlay {...props} />;
}

/**
 * Proportional, not responsive. If the scorebug sits 40px from the left edge at
 * 720p it must sit at the same *proportion* here, or the operator frames
 * against a lie. Scale is uniform and both boxes are centred, so no transform
 * origin is needed — which Android would reject anyway.
 */
function useFittedScale() {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);
  return { onLayout, scale: width === 0 ? 0 : width / CANVAS_WIDTH };
}

function WebOverlay({ url, visible, caption }: Props) {
  const { onLayout, scale } = useFittedScale();

  return (
    <View
      style={[styles.clip, visible ? null : styles.hidden]}
      onLayout={onLayout}
      pointerEvents="none"
    >
      {scale > 0 ? (
        <iframe
          src={url}
          title="Score overlay"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            border: 0,
            backgroundColor: 'transparent',
            transform: `scale(${scale})`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <Caption caption={caption} />
    </View>
  );
}

type WebViewModule = typeof import('react-native-webview');

const loadWebView = () => import('react-native-webview');

function NativeOverlay({ url, visible, caption }: Props) {
  const webview = useOptionalNativeModule<WebViewModule>(loadWebView);
  const { onLayout, scale } = useFittedScale();
  const [failed, setFailed] = useState(false);

  if (webview.status !== 'ready' || failed) {
    return (
      <PeekNotice
        visible={visible}
        message={
          failed
            ? 'The score overlay did not load.'
            : webview.status === 'loading'
              ? 'Loading the score overlay…'
              : 'Score preview is not available in this build.'
        }
      />
    );
  }

  const Surface = webview.module.WebView;

  return (
    <View
      style={[styles.clip, visible ? null : styles.hidden]}
      onLayout={onLayout}
      pointerEvents="none"
    >
      {scale > 0 ? (
        <Surface
          source={{ uri: url }}
          style={[styles.canvas, { transform: [{ scale }] }]}
          containerStyle={styles.canvasContainer}
          opaque={false}
          androidLayerType="hardware"
          scrollEnabled={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled
          pointerEvents="none"
          // Without this a 404 or a DNS failure renders a blank transparent
          // box, which is indistinguishable from a match with no score yet.
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
        />
      ) : null}
      <Caption caption={caption} />
    </View>
  );
}

function Caption({ caption }: { caption?: string }) {
  if (caption === undefined) return null;
  return (
    <View style={styles.caption}>
      <Text variant="metricUnit">{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Kept mounted but invisible between peeks so the next look is instant.
  hidden: {
    opacity: 0,
  },
  canvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: 'transparent',
  },
  canvasContainer: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    flexGrow: 0,
    backgroundColor: 'transparent',
  },
  caption: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
  },
});
