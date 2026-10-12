import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type GhostButtonProps = {
  label: string;
  onPress: () => void;
  /** Set only on a button that shows and hides something, like the language list. */
  expanded?: boolean;
  /**
   * The board's smaller box (Share record): 37 dp tall, 12 dp text. The button is still a `touch` tall target, and
   * the outlined box is drawn inside it, centred: a screen reader reads a node's bounds, so the target is a real
   * 48 dp node and not a hit slop on a smaller one.
   */
  compact?: boolean;
  /**
   * I3 of the Batch 5 review: a ghost that would disturb a live broadcast is disabled, its reason said at the control
   * by its caller. Pressable folds `disabled` into the accessibility state; the label drops to the inert ink.
   */
  disabled?: boolean;
};

/** The secondary action beside a lime plate: outlined, never a second lime. */
export const GhostButton = memo(function GhostButton({
  label,
  onPress,
  expanded,
  compact = false,
  disabled = false,
}: GhostButtonProps) {
  const labelStyle = disabled ? styles.labelOff : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      style={compact ? targetStyle : ghostStyle}
    >
      {compact ? (
        <View testID="ghost-box" style={styles.box}>
          <Text variant="controlSmall" style={labelStyle}>
            {label}
          </Text>
        </View>
      ) : (
        <Text variant="control" style={labelStyle}>
          {label}
        </Text>
      )}
    </Pressable>
  );
});

/** Module-level so render allocates no function; pressed dims the outline, as Button does. */
function ghostStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedGhost : styles.ghost;
}

/** The compact button's target dims as a whole while held, which dims the box drawn inside it. */
function targetStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedTarget : styles.target;
}

const outline = {
  borderWidth: layout.iconBorder,
  borderColor: colour.ink3,
  borderRadius: radius.card,
} as const;

const styles = StyleSheet.create({
  ghost: {
    minHeight: layout.touch,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
  },
  target: { minHeight: layout.touch, alignItems: 'center', justifyContent: 'center' },
  // flexShrink: the box is what gives when its cell is narrow, its label wrapping inside it.
  box: {
    minHeight: layout.ghostCompact,
    flexShrink: 1,
    paddingHorizontal: layout.ghostCompactPadX,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
  },
  pressed: { opacity: 0.85 },
  labelOff: { color: colour.ink3 },
});

const pressedGhost = [styles.ghost, styles.pressed];
const pressedTarget = [styles.target, styles.pressed];
