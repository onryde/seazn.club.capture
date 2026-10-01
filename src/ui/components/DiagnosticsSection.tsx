import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DiagnosticsRow, DiagnosticsSection as Section } from '@/hooks/diagnostics';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** Values in Geist Mono with tabular figures (AGENTS §5): a column of numbers that does not twitch. */
export const DiagnosticsSection = memo(function DiagnosticsSection({
  section,
}: {
  section: Section;
}) {
  return (
    <View style={styles.section}>
      <Text variant="control">{section.title}</Text>
      {section.rows.map(renderRow)}
    </View>
  );
});

/** Labels in Geist, values in Geist Mono; module-level, so render allocates no function. */
function renderRow(row: DiagnosticsRow) {
  return (
    <View key={row.label} style={styles.row}>
      <Text variant="metricUnit" style={styles.label}>
        {row.label}
      </Text>
      <Text variant="metricValue" style={styles.value}>
        {row.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  label: { flex: 1 },
  value: { fontVariant: ['tabular-nums'] },
});
