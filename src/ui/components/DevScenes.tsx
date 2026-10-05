import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDevScenes, type DevScene } from '@/hooks/useDevScenes';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { GhostButton } from '@/ui/components/GhostButton';
import { crashPreviewUntilShown } from '@/ui/components/PreviewBoundary';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** CD17's silence on a phone: long enough for the 3 s watchdog to read TROUBLE, short enough to see it clear. */
const PAUSE_MS = 5_000;

/**
 * D25: the fake engine's scenes, in a development build only, in place of the old four buttons; and
 * Task 39's preview controls, which are not the fake's to gate: they matter most with native wired.
 */
export const DevScenes = memo(function DevScenes() {
  const { t } = useT();
  const { devTools } = usePorts();
  const dev = useDevScenes();
  if (!devTools) return null;
  return (
    <View style={styles.block}>
      {dev === null ? null : (
        <>
          <Text variant="control">{t('stream.dev.title')}</Text>
          <View style={styles.list}>
            {dev.scenes.map((scene) => (
              <SceneButton key={scene} scene={scene} play={dev.play} />
            ))}
          </View>
        </>
      )}
      <PreviewControls />
    </View>
  );
});

const SceneButton = memo(function SceneButton({
  scene,
  play,
}: {
  scene: DevScene;
  play: (scene: DevScene) => void;
}) {
  const { t } = useT();
  const onPress = useCallback(() => play(scene), [play, scene]);
  return <GhostButton label={t('stream.dev.scene', { scene })} onPress={onPress} />;
});

/** Crash preview (CD19's boundary, PV41) and Pause engine reports (CD17), the second with native only. */
const PreviewControls = memo(function PreviewControls() {
  const { t } = useT();
  const { nativeEngine } = usePorts();
  const pause = useCallback(() => nativeEngine?.pauseReports(PAUSE_MS), [nativeEngine]);
  return (
    <View style={styles.list}>
      <GhostButton label={t('stream.dev.crashPreview')} onPress={crashPreviewUntilShown} />
      {nativeEngine === null ? null : (
        <GhostButton label={t('stream.dev.pauseReports')} onPress={pause} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
