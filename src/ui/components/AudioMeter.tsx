import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { METER_SEGMENTS, selectMeterSegments } from '@/hooks/engineSelectors';
import { selectSoundReady } from '@/hooks/preflight';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Permanent, never in Settings (AGENTS §6): nothing downstream normalises, so
 * a quiet mic reaches YouTube quiet. Six segments, orange below the floor.
 */
export const AudioMeter = memo(function AudioMeter() {
  const { t } = useT();
  const lit = useEngineSelector(selectMeterSegments);
  const sound = useEngineSelector(selectSoundReady);
  return (
    <View
      style={styles.meter}
      accessibilityRole="progressbar"
      accessibilityLabel={t('stream.meter.label', { level: lit })}
      aria-valuemin={0}
      aria-valuemax={METER_SEGMENTS}
      aria-valuenow={lit}
    >
      {ROWS[sound ? 'ok' : 'low'][lit]?.map(renderSegment)}
    </View>
  );
});

function renderSegment(style: StyleProp<ViewStyle>, index: number) {
  return <View key={index} style={style} />;
}

const styles = StyleSheet.create({
  meter: { flexDirection: 'row', gap: space.xs, height: 12 },
  segment: { flex: 1, backgroundColor: colour.surface2 },
  ok: { backgroundColor: colour.lime },
  low: { backgroundColor: colour.caution },
});

/** Every lit count, precomputed, so a render allocates no style. */
const row = (lit: number, tint: StyleProp<ViewStyle>) =>
  Array.from({ length: METER_SEGMENTS }, (_, i) =>
    i < lit ? [styles.segment, tint] : styles.segment,
  );
const ROWS = {
  ok: Array.from({ length: METER_SEGMENTS + 1 }, (_, lit) => row(lit, styles.ok)),
  low: Array.from({ length: METER_SEGMENTS + 1 }, (_, lit) => row(lit, styles.low)),
};
