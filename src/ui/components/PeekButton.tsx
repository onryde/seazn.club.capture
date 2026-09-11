import { Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Press and hold to look; release to go back to the picture.
 *
 * Held rather than toggled on purpose: it cannot be left on by accident, and
 * the cost it guards is real — the overlay WebView spends thermal budget and
 * the output player spends radio, battery and billed delivery. A glance costs
 * nothing; three hours of either would matter (N16).
 *
 * Stays available while live, unlike Settings and Diagnostics. Checking the
 * broadcast is exactly what an operator needs mid-match; reconfiguring is not.
 */
export function PeekButton({
  label,
  active,
  disabled = false,
  onPress,
  onRelease,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  onRelease: () => void;
}) {
  return (
    <Pressable
      onPressIn={disabled ? undefined : onPress}
      onPressOut={disabled ? undefined : onRelease}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Press and hold.`}
      accessibilityState={{ disabled, expanded: active }}
      style={[styles.row, active ? styles.active : null]}
    >
      <Text variant="control" style={disabled ? styles.disabled : styles.label} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No rule of its own — the action zone carries the single boundary for this
  // group. Every row having a divider is what made the column read as an
  // undifferentiated list.
  // Fixed height, not minimum: the label wraps to two lines in some states and
  // a row that changes height moves the stop control under the operator's thumb.
  row: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    height: 52,
    justifyContent: 'center',
  },
  active: {
    backgroundColor: colour.surface2,
  },
  label: {
    color: colour.ink2,
  },
  disabled: {
    color: colour.ink3,
  },
});
