import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useEngineProbe } from '@/hooks/useEngineProbe';
import { useT } from '@/hooks/useLanguage';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * CD24: the engine contract on this phone, in a development build with native
 * wired, while idle. The state word is English on purpose, like `DevScenes`'
 * scene names: a developer's readout, never shown in a release build, and not
 * copy. A failure stays until it is pressed away (PV35).
 */
export const DevProbe = memo(function DevProbe() {
  const { t } = useT();
  const probe = useEngineProbe();
  if (probe === null) return null;
  return (
    <View style={styles.block}>
      <GhostButton label={t('stream.dev.probe')} onPress={probe.run} />
      {probe.state === 'failed' ? (
        <GhostButton label={probe.state} onPress={probe.dismiss} />
      ) : (
        <Text variant="control">{probe.state}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
});
