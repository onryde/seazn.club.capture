import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  selectBitrateKbps,
  selectDroppedFrames,
  selectRttMs,
  selectShed,
  selectStateKind,
  selectTransport,
} from '@/hooks/engineSelectors';
import { useEngineSelector, useSnapshotFreshness } from '@/hooks/useCaptureEngine';
import { Metric } from '@/ui/components/Metric';
import { Text } from '@/ui/components/Text';
import { formatBitrate, formatRtt, formatTransport } from '@/ui/format';
import { colour, space } from '@/ui/theme/tokens';

/**
 * What actually happened, for the person who has to explain it afterwards.
 *
 * A three-hour outdoor stream fails by degrading, not crashing (AGENTS.md §11),
 * so this is the screen that matters after a bad afternoon — not a crash report.
 */
export function DiagnosticsScreen({ onBack }: { onBack: () => void }) {
  const stateKind = useEngineSelector(selectStateKind);
  const bitrate = useEngineSelector(selectBitrateKbps);
  const rtt = useEngineSelector(selectRttMs);
  const dropped = useEngineSelector(selectDroppedFrames);
  const transport = useEngineSelector(selectTransport);
  const shed = useEngineSelector(selectShed);
  const stale = useSnapshotFreshness();

  // Stale numbers are worse than no numbers: somebody will read them as current
  // and troubleshoot the wrong thing.
  const value = (text: string) => (stale ? '—' : text);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <Text variant="control">Back to viewfinder</Text>
      </Pressable>

      <Text variant="title">Diagnostics</Text>

      {stale ? (
        <Text variant="status">
          The camera has stopped reporting, so these readings are not current.
        </Text>
      ) : null}

      <View style={styles.grid}>
        <Row label="Session" value={sessionLabel(stateKind)} />
        <Row label="Link" value={transport === null ? 'Not connected' : formatTransport(transport)} />
        <Row label="Reduced" value={shedLabel(shed)} />
      </View>

      <View style={styles.grid}>
        <Text variant="metricUnit">Bitrate</Text>
        <Metric value={value(formatBitrate(bitrate))} unit="kbps" />
        <Text variant="metricUnit">Round trip</Text>
        <Metric value={value(formatRtt(rtt))} unit="ms" />
        <Text variant="metricUnit">Dropped frames</Text>
        <Metric value={value(String(dropped))} />
      </View>

      <Text variant="body">
        A structured post-match record — every transition, thermal reading, fallback and reconnect,
        timestamped — is what makes a bad afternoon explainable. It lands with the real engine.
      </Text>
    </ScrollView>
  );
}

/** Identifiers are for logs; this screen is read by people. */
function sessionLabel(kind: string): string {
  switch (kind) {
    case 'idle':
      return 'Not started';
    case 'armed':
      return 'Ready to go live';
    case 'connecting':
      return 'Opening the link';
    case 'publishing':
      return 'Live';
    case 'degraded':
      return 'Live, impaired';
    case 'reconnecting':
      return 'Signal lost, holding';
    default:
      return 'Ended';
  }
}

function shedLabel(shed: string | null): string {
  switch (shed) {
    case 'overlay-preview':
      return 'Score preview paused';
    case 'preview-framerate':
      return 'Preview slowed';
    case 'encode':
      return 'Picture quality reduced';
    default:
      return 'Nothing';
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="metricUnit">{label}</Text>
      <Text variant="body" style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.ground,
  },
  content: {
    padding: space.xl,
    gap: space.lg,
  },
  back: {
    minHeight: 44,
    justifyContent: 'center',
  },
  grid: {
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colour.ruleSoft,
    paddingTop: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowValue: {
    color: colour.ink,
  },
});
