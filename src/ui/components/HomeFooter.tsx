import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/ui/components/LanguagePicker';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

export const HomeFooter = memo(function HomeFooter({ version }: { version: string }) {
  const { t } = useT();
  return (
    <View style={styles.footer}>
      <LanguagePicker />
      <Text variant="metricUnit">{t('home.footer.version', { version })}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  footer: { gap: space.sm },
});
