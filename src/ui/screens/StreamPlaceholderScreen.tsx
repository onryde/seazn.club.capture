import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { useSavedStreamSlot } from '@/hooks/useSavedStreamSlot';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { DevEngineControls } from '@/ui/components/DevEngineControls';
import { GhostButton } from '@/ui/components/GhostButton';
import { StatusLine } from '@/ui/components/StatusLine';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Proves the shell's stream rules before S1 fills this route (spec §8):
 * landscape, Back blocked on air, the code forgotten after a stop and kept
 * after a failure. S1 replaces the contents, not the route.
 */
export function StreamPlaceholderScreen() {
  const { t } = useT();
  const slot = useSavedStreamSlot();
  const { canLeave, blocked, leave } = useStreamLeave();
  const status = blocked
    ? t('stream.leaveOnAir')
    : t('stream.placeholder.body', { slot: slot ?? '–' });
  return (
    <View style={styles.screen}>
      <View style={styles.main}>
        <Text variant="title">{t('stream.placeholder.title')}</Text>
        <StatusLine>{status}</StatusLine>
        <DevEngineControls />
      </View>
      {canLeave ? <GhostButton label={t('stream.home')} onPress={leave} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    backgroundColor: colour.ground,
  },
  main: { flex: 1, gap: space.sm },
});
