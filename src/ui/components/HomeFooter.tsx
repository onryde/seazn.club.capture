import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenLayout } from '@/domain/mode/homeLayout';
import { useT } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/ui/components/LanguagePicker';
import { Text } from '@/ui/components/Text';
import { layout as metrics, space } from '@/ui/theme/tokens';

/**
 * Language and the version. Portrait stacks them at the foot of Home; landscape sets them in a row at the end of
 * the top row (spec §7), which `HomeScreen` places.
 */
export const HomeFooter = memo(function HomeFooter({
  version,
  layout = 'portrait',
}: {
  version: string;
  layout?: ScreenLayout;
}) {
  const { t } = useT();
  return (
    <View style={layout === 'landscape' ? styles.row : styles.footer}>
      <LanguagePicker />
      <Text variant="metricUnit">{t('home.footer.version', { version })}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  // The board's gap between Language and the version is 12. It does not shrink: the top row wraps instead.
  row: { flexDirection: 'row', alignItems: 'center', gap: metrics.homeGap, flexShrink: 0 },
});
