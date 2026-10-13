import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
} from 'react-native';
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
  const compactBox = useCompactBox(label, labelStyle);
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      style={compact ? styles.target : ghostStyle}
    >
      {compact ? (
        compactBox
      ) : (
        <Text variant="control" style={labelStyle}>
          {label}
        </Text>
      )}
    </Pressable>
  );
});

/**
 * The compact form's child. Its outline is the box inside the target, so the box reads the target's press: Pressable
 * hands a function child its state, on the phone as on the web. One function per label and state, not per render.
 */
function useCompactBox(label: string, labelStyle: StyleProp<TextStyle>) {
  return useCallback(
    ({ pressed }: PressableStateCallbackType) => (
      <View testID="ghost-box" style={pressed ? pressedBox : styles.box}>
        <Text variant="controlSmall" style={labelStyle}>
          {label}
        </Text>
      </View>
    ),
    [label, labelStyle],
  );
}

/**
 * Module-level so render allocates no function. Pressed takes the press fill (cream at 20%, on any ground: the sheet's
 * surface2, a card's surface, night) and the edge goes cream, as IconButton's does (the controller's rulings, Batch 17
 * and P8): never a dim alone, and never a change of the box. A disabled ghost never
 * shows it: Pressable starts no press while disabled, on the phone (Pressability refuses the responder) as on the web.
 */
function ghostStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedGhost : styles.ghost;
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
  pressed: { backgroundColor: colour.pressFill, borderColor: colour.ink },
  labelOff: { color: colour.ink3 },
});

const pressedGhost = [styles.ghost, styles.pressed];
/** The compact form: the box fills and its edge goes cream; the 48 dp target around it still draws nothing. */
const pressedBox = [styles.box, styles.pressed];
