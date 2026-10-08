import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDiagnostics, useSessionRecord } from '@/hooks/useDiagnostics';
import { useT } from '@/hooks/useLanguage';
import { settingsDiagRows, type DiagRow } from '@/hooks/settingsDiagnostics';
import { DevScenes } from '@/ui/components/DevScenes';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * Spec §6's Diagnostics, as a card inside Settings: a header row with Share record, then Q1's rows as
 * section | item | value. It holds `useDiagnostics()` itself and takes no props, so a 1 Hz report
 * re-renders this card and not the switches around it, and a switch does not re-render the card (D32).
 * It is not a ScrollView: the screen decides whether it has room (Task 9).
 */
export const DiagnosticsCard = memo(function DiagnosticsCard() {
  const { t } = useT();
  const rows = settingsDiagRows(useDiagnostics());
  const { share, shareFailed } = useSessionRecord();
  return (
    <View testID="diagnostics-card" style={styles.card}>
      <View style={styles.header}>
        <Text variant="control" style={styles.title}>
          {t('diag.title')}
        </Text>
        <GhostButton label={t('diag.share')} onPress={share} />
      </View>
      {shareFailed ? <Text variant="status">{t('diag.shareFailed')}</Text> : null}
      <View>{rows.map(renderRow)}</View>
      <DevScenes />
    </View>
  );
});

/** Module-level, so render allocates no function. The first row has no rule above it. */
function renderRow(row: DiagRow, index: number) {
  return (
    <DiagRowView
      key={row.key}
      section={row.section}
      label={row.label}
      value={row.value}
      first={index === 0}
    />
  );
}

/** Primitives only, so a row whose value did not change does not render. Values in Geist Mono (AGENTS §5). */
const DiagRowView = memo(function DiagRowView({
  section,
  label,
  value,
  first,
}: {
  section: string | null;
  label: string;
  value: string;
  first: boolean;
}) {
  return (
    <View testID="diag-row" style={rowStyle(first, section !== null)}>
      <Text variant="diagSection" style={styles.section}>
        {section}
      </Text>
      <Text variant="metricUnit" style={styles.label}>
        {label}
      </Text>
      <Text variant="metricValue" style={styles.value} numberOfLines={1} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: layout.diagGap,
    paddingHorizontal: layout.diagPad,
    paddingVertical: layout.diagPadV,
    backgroundColor: colour.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.diagRow,
    borderTopWidth: layout.iconBorder,
    borderTopColor: colour.ruleSoft,
  },
  sectionStart: { borderTopColor: colour.rule },
  firstRow: { borderTopWidth: 0 },
  section: { width: layout.diagSection, paddingRight: layout.diagPad },
  label: { flex: 1, paddingRight: layout.diagPad },
  // One line, shrinkable: the shipped copy always fits (settingsFit.test.ts); a value that ever did not
  // is cut at its tail and never wraps the row taller than the card's budget.
  value: { flexShrink: 1, fontVariant: ['tabular-nums'], textAlign: 'right' },
});

const plainRow = styles.row;
const startRow = [styles.row, styles.sectionStart];
const topRow = [styles.row, styles.firstRow];

/** The first row has no rule; a section's first row has the stronger one. */
function rowStyle(first: boolean, startsSection: boolean) {
  if (first) return topRow;
  return startsSection ? startRow : plainRow;
}
