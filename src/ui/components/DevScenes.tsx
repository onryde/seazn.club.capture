import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDevScenes, type DevScene } from '@/hooks/useDevScenes';
import { useT } from '@/hooks/useLanguage';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** D25: the fake engine's scenes, in a development build only, in place of the old four buttons. */
export const DevScenes = memo(function DevScenes() {
  const { t } = useT();
  const dev = useDevScenes();
  if (dev === null) return null;
  return (
    <View style={styles.block}>
      <Text variant="control">{t('stream.dev.title')}</Text>
      <View style={styles.list}>
        {dev.scenes.map((scene) => (
          <SceneButton key={scene} scene={scene} play={dev.play} />
        ))}
      </View>
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

const styles = StyleSheet.create({
  block: { gap: space.xs },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
