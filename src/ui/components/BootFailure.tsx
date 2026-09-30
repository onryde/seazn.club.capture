import { StyleSheet, Text as RNText, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { colour, status } from '@/ui/theme/tokens';

/**
 * The typefaces did not load, so the scale cannot be trusted: system face,
 * orange (a failure is never red — red is ON AIR). Never a blank screen.
 */
export function BootFailure() {
  const { t } = useT();
  return (
    <View style={styles.root}>
      <RNText style={styles.message}>{t('boot.fontsFailed')}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: colour.ground,
  },
  message: { color: status.failure, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
