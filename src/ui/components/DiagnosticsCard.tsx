import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDiagnostics, useSessionRecord } from '@/hooks/useDiagnostics';
import { useT } from '@/hooks/useLanguage';
import { settingsDiagRows, type DiagRow } from '@/hooks/settingsDiagnostics';
import { DevScenes } from '@/ui/components/DevScenes';
import { GhostButton } from '@/ui/components/GhostButton';
import { Glyph } from '@/ui/components/Glyph';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * Spec §6's Diagnostics, as a card inside Settings: a header row, the board's lime pulse and the name in the
 * display face, with Share record (a share that fails says so in that button's label, so the card never grows a
 * line), then Q1's rows as section | item | value. It holds `useDiagnostics()` itself and takes no props, so a 1 Hz
 * report re-renders this card and not the switches around it, and a switch does not re-render the card (D32).
 * It is not a ScrollView: the screen decides whether it has room (Task 9).
 */
export const DiagnosticsCard = memo(function DiagnosticsCard() {
  const { t } = useT();
  const rows = settingsDiagRows(useDiagnostics());
  const { share, shareFailed } = useSessionRecord();
  return (
    <View testID="diagnostics-card" style={styles.card}>
      <View style={styles.header}>
        <Glyph name="pulse" tone="lime" size={layout.pulseGlyph} />
        <Text variant="diagTitle" style={styles.title}>
          {t('diag.title')}
        </Text>
        <View style={styles.share}>
          <GhostButton
            label={t(shareFailed ? 'diag.shareFailed' : 'diag.share')}
            onPress={share}
            compact
          />
        </View>
      </View>
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
      <Text variant="diagLabel" style={styles.label} numberOfLines={1} ellipsizeMode="tail">
        {label}
      </Text>
      <Text variant="diagValue" style={styles.value} numberOfLines={1} ellipsizeMode="tail">
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
  // 48 high though the board's Share button is drawn 36: the button's hit slop must lie inside its parents' bounds.
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.touch },
  // The heading keeps its width and takes the line, so the Share button is pushed right; the button's cell is the
  // one that gives when the half is narrow, its label wrapping to a second line inside the same 48 dp (the heading is
  // wider than the Geist 14 it replaced, and "Compartir registro" no longer fits beside it at 640).
  title: { flexGrow: 1, flexShrink: 0 },
  share: { flexShrink: 1, minHeight: layout.touch, justifyContent: 'center' },
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
  // One line each, a backstop only: the shipped copy always fits its row (settingsFit.test.ts), so a
  // string cut at its tail is a number past what that test samples, never static copy.
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
