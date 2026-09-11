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
 * It rides the bottom edge of the preview stage, not the control column. It was
 * the one variable-height block in a column that has no height to spare, and it
 * is advice rather than state — so it belongs where there is room to say the
 * whole sentence on one line, against an edge, never over the middle third of
 * the shot (§6). The column keeps only what the operator acts on.
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
  const detail = onAir ? liveDetail(window, absences, lastAwayMs) : armedDetail(window);

  return (
    <View style={styles.row}>
      <Text variant="metricUnit" style={styles.label} numberOfLines={1}>
        Keep screen on
      </Text>
      {detail === null ? null : (
        <Text variant="status" style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      )}
    </View>
  );
}

/**
 * One line before air, not the full rule. It shares the strip with the two
 * links and is read at arm's length: "locking pauses the picture" is the whole
 * point, and the seconds say what it costs. The long version told an operator
 * nothing extra and pushed the sentence onto a second line.
 */
function armedDetail(window: string | null): string {
  const rule = 'Locking pauses it.';
  return window === null ? rule : `${rule} ${window} to get back.`;
}

/** On air, once it has happened the operator's own tally is more use than the rule. */
function liveDetail(
  window: string | null,
  absences: number,
  lastAwayMs: number | null,
): string | null {
  if (absences > 0) {
    const last = lastAwayMs === null ? '' : `, last ${Math.round(lastAwayMs / 1000)}s`;
    return `Paused ${absences}×${last}.`;
  }
  return window === null ? null : `${window} to get back if you lock it.`;
}

const styles = StyleSheet.create({
  // A row, not a stack: the strip is as wide as the stage and as short as it
  // can be, so label and sentence sit beside each other on one line.
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  label: {
    color: colour.ink,
  },
  // Shrinks rather than pushing the label off the strip on a narrow stage.
  detail: {
    flexShrink: 1,
  },
});
