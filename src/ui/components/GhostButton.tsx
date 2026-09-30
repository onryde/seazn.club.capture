import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

type GhostButtonProps = {
  label: string;
  onPress: () => void;
  /** Set only on a button that shows and hides something, like the language list. */
  expanded?: boolean;
};

/** The secondary action beside a lime plate: outlined, never a second lime. */
export const GhostButton = memo(function GhostButton({
  label,
  onPress,
  expanded,
}: GhostButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      onPress={onPress}
      style={ghostStyle}
    >
      <Text variant="control">{label}</Text>
    </Pressable>
  );
});

/** Module-level so render allocates no function; pressed dims the outline, as Button does. */
function ghostStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedGhost : styles.ghost;
}

const styles = StyleSheet.create({
  ghost: {
    minHeight: 48,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  pressed: { opacity: 0.85 },
});

const pressedGhost = [styles.ghost, styles.pressed];
