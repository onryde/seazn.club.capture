import { StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';

/**
 * The round line (spec §2): the server's text, one line, never translated or built here. C2 (D2 §4.4): lime and caps,
 * at its existing role and slot, so the strip's fixed 66 dp is unchanged.
 */
export function StageLine({ text }: { text: string }) {
  return (
    <Text variant="metricUnit" numberOfLines={1} style={styles.round} testID="stage-line">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({ round: { color: colour.lime, textTransform: 'uppercase' } });
