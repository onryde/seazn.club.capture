import { useCallback, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * Where the camera goes.
 *
 * PLACEHOLDER. When `capture-engine` gains real native code this becomes a
 * Fabric host component wrapping `AVCaptureVideoPreviewLayer` on iOS and
 * StreamPack's preview surface on Android. Frames must never reach JavaScript
 * (AGENTS.md §2), so nothing here will ever hold pixel data.
 *
 * The frame is measured and computed rather than expressed with `width: 100%`
 * plus `aspectRatio`: in React Native, when the height clamps the width does
 * not follow, so on a tall stage that combination silently rendered a box that
 * was not 16:9 at all — which would show the operator a frame that is not the
 * one going out.
 */
export function PreviewSurface({ label }: { label: string }) {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // Fit a 16:9 box inside the stage, whichever axis binds.
    const fittedWidth = Math.min(width, height * layout.previewAspect);
    setFrame({ width: fittedWidth, height: fittedWidth / layout.previewAspect });
  }, []);

  return (
    <View style={styles.surface} onLayout={onLayout}>
      {frame === null ? null : (
        <View style={[styles.frame, frame]}>
          <Text variant="body" style={styles.label}>
            {label}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    backgroundColor: colour.stage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colour.rule,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  label: {
    textAlign: 'center',
  },
});
