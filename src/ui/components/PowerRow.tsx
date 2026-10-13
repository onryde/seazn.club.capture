import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { usePowerState } from '@/hooks/usePowerState';
import type { MessageKey } from '@/i18n/messages';
import type { PowerMode } from '@/services/devicePorts';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/** M5 of the Batch 5 review: each mode in Android's own word for it, so the row and App info agree. */
const MODE_WORD: Readonly<Record<PowerMode, MessageKey>> = {
  unrestricted: 'settings.power.unrestricted',
  optimized: 'settings.power.optimized',
  restricted: 'settings.power.restricted',
};

/**
 * R5, N27: Background activity in its battery mode, with one sentence of why, the way to App info and the path from
 * there (Battery → Unrestricted). Never a prompt and never a nag: the row just says. Absent where the mode is unknown
 * (iOS, where the camera stops in the background anyway, P1). From Arming on the button is disabled with its reason
 * (I3 of the Batch 5 review).
 */
export const PowerRow = memo(function PowerRow() {
  const { t } = useT();
  const { mode, held, open } = usePowerState();
  if (mode === null) return null;
  return (
    <View testID="power-row" style={styles.row}>
      <View style={styles.line}>
        <Text variant="controlInk" style={styles.label}>
          {t('settings.power.background')}
        </Text>
        <Text variant="control" style={mode === 'unrestricted' ? undefined : styles.caution}>
          {t(MODE_WORD[mode])}
        </Text>
      </View>
      <Text variant="metricUnit">{t('settings.power.hint')}</Text>
      <View style={styles.action}>
        <GhostButton label={t('settings.power.open')} onPress={open} compact disabled={held} />
      </View>
      {held ? <Text variant="metricUnit">{t('settings.power.onAir')}</Text> : null}
      <Text variant="metricUnit">{t('settings.power.path')}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { flex: 1 },
  /** The button hugs its box at the column's start, as the licences link below does, never a full-width target. */
  action: { alignItems: 'flex-start' },
  /** Optimized and Restricted are degraded conditions, so caution, never red (AGENTS §5: red means ON AIR). */
  caution: { color: colour.caution },
});
