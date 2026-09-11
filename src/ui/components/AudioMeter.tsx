import { StyleSheet, View } from 'react-native';
import { colour, status } from '@/ui/theme/tokens';

/**
 * Six, not twelve. Twelve segments in a 114px column are 7px wide, so the
 * floor segment — the one that must be seen missing — was below the threshold
 * of anything readable at two metres. Fewer, fatter bars carry further, and the
 * telemetry only arrives at 1 Hz anyway, so finer resolution was false
 * precision.
 */
const SEGMENTS = 6;

/**
 * Always visible, never in Settings (AGENTS.md §6).
 *
 * Nothing downstream normalises: there are two lossy generations after the
 * phone and no gain control anywhere in the chain, so a quiet microphone
 * reaches YouTube quiet. The operator is the only person who can fix that, and
 * only if they can see it.
 *
 * Segmented rather than a continuous fill, which is what an audio desk looks
 * like and therefore needs no label to identify it. A continuous bar at zero
 * level was indistinguishable from a stalled progress bar — and silence is
 * exactly the state that must not look like nothing.
 *
 * Below the floor the strip tints caution and the first segment lights in
 * caution too: an unlit meter then reads as *wrong* rather than as empty. That
 * floor is the level Go Live gates on, so the meter is an instruction, not
 * decoration.
 */
export function AudioMeter({ level, floor = 0.05 }: { level: number; floor?: number }) {
  const clamped = Math.min(1, Math.max(0, level));
  const belowFloor = clamped < floor;
  const lit = Math.round(clamped * SEGMENTS);

  return (
    <View
      style={[styles.strip, belowFloor ? styles.stripBelowFloor : null]}
      accessibilityRole="progressbar"
      accessibilityLabel={belowFloor ? 'No audio reaching the microphone' : 'Audio level'}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, segmentColour(index, lit, belowFloor)]}
        />
      ))}
    </View>
  );
}

function segmentColour(index: number, lit: number, belowFloor: boolean) {
  if (index < lit) return { backgroundColor: status.healthy };
  // The one segment that should always be lit, shown as missing.
  if (belowFloor && index === 0) return { backgroundColor: status.degraded };
  return { backgroundColor: colour.surface2 };
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: 3,
    height: 20,
    alignItems: 'stretch',
  },
  stripBelowFloor: {
    borderBottomWidth: 1,
    borderBottomColor: status.degraded,
    paddingBottom: 2,
  },
  segment: {
    flex: 1,
  },
});
