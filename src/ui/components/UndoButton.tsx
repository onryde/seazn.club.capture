import { memo } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type UndoButtonProps = {
  /** The word, in the operator's language; drawn in bold caps, and what a screen reader hears. */
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
};

/**
 * The pad's Undo (owner ruling 148, the mockup): an outlined button, an undo arrow before its word in bold caps. The
 * arrow is drawn from boxes (react-native-svg does not load in the tests): a head pointing left and a hook curving back.
 * Disabled it greys, edge and ink, as `GhostButton` does. At least a touch target, at least `padUndoMinWidth` wide.
 */
export const UndoButton = memo(function UndoButton({ label, onPress, disabled }: UndoButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? offStyle : onStyle}
    >
      <UndoGlyph off={disabled} />
      <Text aria-hidden variant="actionSecondary" style={disabled ? styles.labelOff : styles.label}>
        {label}
      </Text>
    </Pressable>
  );
});

/** An arrow head pointing left over the start of a hook that curves down and back to the right. */
const UndoGlyph = memo(function UndoGlyph({ off }: { readonly off: boolean }) {
  return (
    <View testID="undo-glyph" aria-hidden style={styles.glyph}>
      <View style={off ? styles.headOff : styles.head} />
      <View style={off ? styles.hookOff : styles.hook} />
    </View>
  );
});

function pressable(rest: StyleProp<ViewStyle>, pressedStyle: StyleProp<ViewStyle>) {
  const down = [rest, pressedStyle];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.touch,
    minWidth: layout.padUndoMinWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  pressed: { backgroundColor: colour.pressFill, borderColor: colour.ink },
  off: { borderColor: colour.rule },
  label: { color: colour.ink },
  labelOff: { color: colour.ink3 },
  glyph: { flexDirection: 'row', alignItems: 'flex-start' },
  // The head: a box with no width whose right border is the point and whose top and bottom are clear.
  head: {
    width: 0,
    height: 0,
    borderTopWidth: layout.padUndoHalf,
    borderBottomWidth: layout.padUndoHalf,
    borderRightWidth: layout.padUndoHead,
    borderTopColor: colour.clear,
    borderBottomColor: colour.clear,
    borderRightColor: colour.ink,
  },
  headOff: {
    width: 0,
    height: 0,
    borderTopWidth: layout.padUndoHalf,
    borderBottomWidth: layout.padUndoHalf,
    borderRightWidth: layout.padUndoHead,
    borderTopColor: colour.clear,
    borderBottomColor: colour.clear,
    borderRightColor: colour.ink3,
  },
  // The hook: the arrow's shaft along the top, rounded down on the right and back along the bottom.
  hook: {
    width: layout.padUndoBody,
    height: layout.padUndoHeight,
    marginTop: layout.padUndoHalf - layout.padUndoStroke / 2,
    borderTopWidth: layout.padUndoStroke,
    borderRightWidth: layout.padUndoStroke,
    borderBottomWidth: layout.padUndoStroke,
    borderTopRightRadius: layout.padUndoHeight / 2,
    borderBottomRightRadius: layout.padUndoHeight / 2,
    borderColor: colour.ink,
  },
  hookOff: {
    width: layout.padUndoBody,
    height: layout.padUndoHeight,
    marginTop: layout.padUndoHalf - layout.padUndoStroke / 2,
    borderTopWidth: layout.padUndoStroke,
    borderRightWidth: layout.padUndoStroke,
    borderBottomWidth: layout.padUndoStroke,
    borderTopRightRadius: layout.padUndoHeight / 2,
    borderBottomRightRadius: layout.padUndoHeight / 2,
    borderColor: colour.ink3,
  },
});

const onStyle = pressable(styles.button, styles.pressed);
const offStyle: StyleProp<ViewStyle> = [styles.button, styles.off];
