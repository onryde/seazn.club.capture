import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * The iOS lock warning as a first-class state, not a toast (AGENTS.md §6, P1).
 *
 * Shown only when native reports `survivesBackground === false`. Gated on
 * native's answer rather than on `Platform.OS`, because the UI must not assert
 * a capability native has not confirmed — and an Android foreground service
 * that failed to start is a real case that a platform check would get wrong.
 *
 * Plain ink, not orange. This is a rule of engagement, not a fault, and orange
 * has to stay meaningful for degraded and for failure.
 *
 * Pre-air it is full size, sitting immediately above the action — the last
 * thing read before the thumb lands on Go live. On air it collapses into the
 * slot the Settings and Diagnostics links vacate, so it costs no extra height
 * in a column that has none to give.
 */
export function LockNotice({
  onAir,
  holdWindowSeconds,
  absences,
  lastAwayMs,
}: {
  onAir: boolean;
  holdWindowSeconds: number | null;
  absences: number;
  lastAwayMs: number | null;
}) {
  const window = holdWindowSeconds === null ? null : `${holdWindowSeconds}s`;

  if (!onAir) {
    return (
      <View style={styles.block}>
        <Text variant="metricUnit" style={styles.label}>
          Keep screen on
        </Text>
        <Text variant="status">
          {window === null
            ? 'Locking the phone or leaving the app pauses the picture.'
            : `Locking the phone or leaving the app pauses the picture. You have ${window} to get back.`}
        </Text>
      </View>
    );
  }

  // Once it has happened, the operator's own tally is more use than the rule.
  if (absences > 0) {
    return (
      <View style={styles.block}>
        <Text variant="metricUnit">
          {`Paused ${absences}×${lastAwayMs === null ? '' : `, last ${Math.round(lastAwayMs / 1000)}s`}`}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text variant="metricUnit">
        {window === null ? 'Keep screen on' : `Keep screen on. ${window} to return.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.xs,
  },
  label: {
    color: colour.ink,
  },
});
