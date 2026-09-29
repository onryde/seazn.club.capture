import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { StatusLine } from '@/ui/components/StatusLine';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

export function HomeScreen() {
  const { t } = useT();
  return (
    <View style={styles.screen}>
      <Text variant="title">{t('brand')}</Text>
      <StatusLine>{t('home.status.idle')}</StatusLine>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: space.md, padding: space.md, backgroundColor: colour.ground },
});
