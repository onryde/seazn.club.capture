import { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';

/**
 * The version line. Portrait sets it at the foot of Home; landscape sets it in the top row, ahead of the gear, which
 * `HomeScreen` places. Language left it for Settings (owner, 2026-11-02), so it is the whole footer. It never shrinks:
 * the top row wraps instead.
 */
export const HomeFooter = memo(function HomeFooter({ version }: { version: string }) {
  const { t } = useT();
  return (
    <Text variant="metricUnit" style={styles.version}>
      {t('home.footer.version', { version })}
    </Text>
  );
});

const styles = StyleSheet.create({
  version: { flexShrink: 0 },
});
