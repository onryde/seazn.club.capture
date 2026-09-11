import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * A number and its unit. The value is mono so tabular figures hold the column
 * still as it changes; the unit is Archivo, because a unit is a label and
 * labels are not numbers.
 */
export function Metric({ value, unit }: { value: string; unit?: string }) {
  return (
    <View style={styles.row}>
      <Text variant="metricValue">{value}</Text>
      {unit === undefined ? null : (
        <Text variant="metricUnit" style={styles.unit}>
          {unit}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  unit: {
    marginLeft: space.xs,
  },
});
