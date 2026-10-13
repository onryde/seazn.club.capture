import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, plateInk, pressedOpacity, space } from '@/ui/theme/tokens';

/**
 * The primary action on a screen with no viewfinder: a lime plate with night
 * ink — the web console's "floodlight", its signal for "this is on, go".
 *
 * Lime, never violet. `#7c3aed` on night fails AA; the web flips its primary
 * buttons to a lime plate with night ink for exactly that reason, and so do we
 * (AGENTS.md §5). The viewfinder keeps ActionZone, whose label-only form
 * leaves the plate colour free to mean state.
 */
export function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={disabled ? disabledPlate : plateStyle}
    >
      <Text variant="action" style={disabled ? styles.labelDisabled : styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Module-level so render allocates no function. Pressed dims the plate to `pressedOpacity.plate` (the controller's
 * ruling, Batch 17): a pressed plate would step to a darker lime, which the palette does not have, so it dims until it
 * does. A disabled plate never shows it: its style is not this function, and Pressable starts no press.
 */
function plateStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedPlate : styles.plate;
}

const styles = StyleSheet.create({
  // Square, like the state plate: in this app a plate is an area of signal,
  // not a rounded chip.
  plate: {
    minHeight: 56,
    minWidth: 200,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.lime,
  },
  pressed: {
    opacity: pressedOpacity.plate,
  },
  disabled: {
    backgroundColor: colour.surface,
  },
  label: {
    color: plateInk,
  },
  labelDisabled: {
    color: colour.ink3,
  },
});

const pressedPlate = [styles.plate, styles.pressed];
const disabledPlate = [styles.plate, styles.disabled];
