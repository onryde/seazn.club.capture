import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { usePowerState } from '@/hooks/usePowerState';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * R5, N27: Background activity, Allowed or Restricted, with one line of why and the way to the app's page, where the
 * operator may choose Unrestricted battery. Never a prompt and never a nag: the row just says. Absent where the state
 * is unknown (iOS, where the camera stops in the background anyway, P1).
 */
export const PowerRow = memo(function PowerRow() {
  const { t } = useT();
  const { unrestricted, open } = usePowerState();
  if (unrestricted === null) return null;
  return (
    <View testID="power-row" style={styles.row}>
      <View style={styles.line}>
        <Text variant="controlInk" style={styles.label}>
          {t('settings.power.background')}
        </Text>
        <Text variant="control" style={unrestricted ? undefined : styles.restricted}>
          {t(unrestricted ? 'settings.power.allowed' : 'settings.power.restricted')}
        </Text>
      </View>
      <Text variant="metricUnit">{t('settings.power.hint')}</Text>
      <View style={styles.action}>
        <GhostButton label={t('settings.power.open')} onPress={open} compact />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { flex: 1 },
  /** The button hugs its box at the column's start, as the licences link below does, never a full-width target. */
  action: { alignItems: 'flex-start' },
  /** Restricted is a degraded condition, so caution, never red (AGENTS §5: red means ON AIR). */
  restricted: { color: colour.caution },
});
