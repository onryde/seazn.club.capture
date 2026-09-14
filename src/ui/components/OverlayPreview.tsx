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

/**
 * The page scales ITSELF: `transform: scale(min(vw/1920, vh/1080))` from the
 * top-left of a fixed 1920×1080 canvas (seazn.club overlay-stage.tsx). So the
 * only thing it needs from us is a 16:9 box the size of the picture — never a
 * second scale of our own.
 *
 * Sizing the view to the canvas and scaling it down was wrong twice over: the
 * box was 1280×720 *dp* (3840px on a 3× phone, four times the pixels it could
 * ever show), and centring a box that large inside the frame put the page's
 * top-left scorebug outside the visible area entirely. On a OnePlus 10 Pro the
 * overlay was invisible, and a plain white test page was too.
 */
const PREVIEW_ASPECT = 16 / 9;

type Props = { url: string; visible: boolean; caption?: string };

// Constant for the life of the app, so the component type never changes and
// the hooks inside each branch keep a stable order.
const IS_WEB = Platform.OS === 'web';

export function OverlayPreview(props: Props) {
  return IS_WEB ? <WebOverlay {...props} /> : <NativeOverlay {...props} />;
}

/**
 * The same 16:9 fit the camera preview uses, so the overlay lands on the
 * picture rather than beside it. Whichever axis binds, binds for both.
 */
function useFittedFrame() {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const fitted = Math.min(width, height * PREVIEW_ASPECT);
    setFrame({ width: fitted, height: fitted / PREVIEW_ASPECT });
  }, []);
  return { onLayout, frame };
}

function WebOverlay({ url, visible, caption }: Props) {
  const { onLayout, frame } = useFittedFrame();

  return (
    <View
      style={[styles.clip, visible ? null : styles.hidden]}
      onLayout={onLayout}
      pointerEvents="none"
    >
      {frame === null ? null : (
        <iframe
          src={url}
          title="Score overlay"
          style={{
            width: frame.width,
            height: frame.height,
            border: 0,
            backgroundColor: 'transparent',
            pointerEvents: 'none',
          }}
        />
      )}
      <Caption caption={caption} />
    </View>
  );
}

type WebViewModule = typeof import('react-native-webview');

const loadWebView = () => import('react-native-webview');

function NativeOverlay({ url, visible, caption }: Props) {
  const webview = useOptionalNativeModule<WebViewModule>(loadWebView);
  const { onLayout, frame } = useFittedFrame();
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
      {frame === null ? null : (
        <Surface
          source={{ uri: url }}
          style={[styles.surface, frame]}
          containerStyle={frame}
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
      )}
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
  // Transparent, so the camera shows through everywhere the page has not
  // painted — which is most of it.
  surface: {
    backgroundColor: 'transparent',
  },
  caption: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
  },
});
