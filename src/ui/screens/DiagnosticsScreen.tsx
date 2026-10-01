import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { RECORD_TAIL, type DiagnosticsSection as Section } from '@/hooks/diagnostics';
import { useDiagnostics, useSessionRecord } from '@/hooks/useDiagnostics';
import { useT } from '@/hooks/useLanguage';
import { useBackToViewfinder } from '@/hooks/useStreamLinks';
import { Button } from '@/ui/components/Button';
import { DevScenes } from '@/ui/components/DevScenes';
import { DiagnosticsSection } from '@/ui/components/DiagnosticsSection';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Spec §4's Diagnostics, inside Live Stream so it is reachable on air (AGENTS
 * §6). Re-renders at 1 Hz on purpose: it shows ticking values and is not the
 * HUD (D32). Nothing here touches the broadcast, so nothing is disabled on air.
 */
export function DiagnosticsScreen() {
  const { t } = useT();
  const toCamera = useBackToViewfinder();
  const sections = useDiagnostics();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SubScreenHeader title={t('diag.title')} onBack={toCamera} />
      {sections.map(renderSection)}
      <SessionRecord />
      <DevScenes />
    </ScrollView>
  );
}

function renderSection(section: Section) {
  return <DiagnosticsSection key={section.title} section={section} />;
}

/**
 * The record's latest lines, and Share record, which sends them all. A line is
 * JSON prose, so it is set in Geist, not the numerals' mono (M25).
 */
const SessionRecord = memo(function SessionRecord() {
  const { t } = useT();
  const record = useSessionRecord();
  return (
    <View style={styles.record}>
      <Text variant="control">{t('diag.section.record')}</Text>
      {record.lines.slice(-RECORD_TAIL).map(renderLine)}
      <Button label={t('diag.share')} onPress={record.share} />
      {record.shareFailed ? <Text variant="status">{t('diag.shareFailed')}</Text> : null}
    </View>
  );
});

/** Keyed by its text: each line carries its own instant, and the record only appends. */
function renderLine(line: string, index: number) {
  return (
    <Text key={`${index}:${line}`} variant="metricUnit" numberOfLines={2}>
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  content: { gap: space.md, padding: space.md },
  record: { gap: space.xs },
});
