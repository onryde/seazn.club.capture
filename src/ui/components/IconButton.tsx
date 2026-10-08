import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Glyph, type GlyphName } from '@/ui/components/Glyph';
import { colour, layout, radius } from '@/ui/theme/tokens';

type IconButtonProps = {
  readonly glyph: GlyphName;
  /** The accessible name: the button draws no word (spec §3). */
  readonly label: string;
  readonly onPress: () => void;
};

/**
 * An icon-row button (spec §3): a 48 dp square, outlined as GhostButton is,
 * holding a glyph in ink2, cream at 80% (the canvas). The name is the label alone, so a screen reader reads
 * "Settings" and a sighted operator reads the picture.
 */
export const IconButton = memo(function IconButton({ glyph, label, onPress }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={iconButtonStyle}
    >
      <Glyph name={glyph} tone="ink2" />
    </Pressable>
  );
});

/** Module-level so render allocates no function; pressed dims the outline, as GhostButton does. */
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
  pressed: { opacity: 0.85 },
});

const pressedButton = [styles.button, styles.pressed];
