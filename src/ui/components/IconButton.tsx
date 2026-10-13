import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Glyph, type GlyphName } from '@/ui/components/Glyph';
import { colour, layout, radius } from '@/ui/theme/tokens';

type IconButtonProps = {
  readonly glyph: GlyphName;
  /** The accessible name: the button draws no word (spec §3). */
  readonly label: string;
  readonly onPress: () => void;
  /**
   * B5 (owner's board): the button's panel is open. A 2 dp lime outline and the selected state a screen reader
   * announces. Left out, the button says nothing about being selected (Settings, Home, Take photo).
   */
  readonly selected?: boolean;
};

/**
 * An icon-row button (spec §3): a 48 dp square, outlined as GhostButton is,
 * holding a glyph in ink2, cream at 80% (the canvas). The name is the label alone, so a screen reader reads
 * "Settings" and a sighted operator reads the picture.
 */
export const IconButton = memo(function IconButton({
  glyph,
  label,
  onPress,
  selected,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // `aria-selected`, not `accessibilityState`: Pressable reads it as the selected state on the phone, and
      // react-native-web renders only this form (it drops the state object).
      aria-selected={selected}
      onPress={onPress}
      style={selected === true ? selectedButtonStyle : iconButtonStyle}
    >
      <Glyph name={glyph} tone="ink2" />
    </Pressable>
  );
});

/**
 * Module-level so render allocates no function. Pressed takes the press fill (cream at 20%, on any ground) and the edge
 * goes cream, as GhostButton's does (the controller's rulings, Batch 17 and P8): never a dim alone, and never a change
 * of the box.
 */
function iconButtonStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedButton : styles.button;
}

const styles = StyleSheet.create({
  button: {
    width: layout.iconButton,
    height: layout.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  pressedFill: { backgroundColor: colour.pressFill },
  pressedEdge: { borderColor: colour.ink },
  selected: { borderWidth: layout.iconBorderOn, borderColor: colour.lime },
});

const pressedButton = [styles.button, styles.pressedFill, styles.pressedEdge];

/**
 * B5: lime and 2 dp in place of the hairline; the box stays 48 square, the border is drawn inside it. Pressed, it keeps
 * the lime edge and takes the fill only.
 */
function selectedButtonStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedSelectedButton : selectedStyles;
}
const selectedStyles = [styles.button, styles.selected];
const pressedSelectedButton = [styles.button, styles.selected, styles.pressedFill];
