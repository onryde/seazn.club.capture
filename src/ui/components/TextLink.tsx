import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { layout, pressedOpacity } from '@/ui/theme/tokens';

type TextLinkProps = {
  label: string;
  onPress: () => void;
  /** Set only on a link that shows and hides something, like the licences list. */
  expanded?: boolean;
};

/**
 * The owner's board draws "Open-source licences" as a bare underlined line in the muted violet, 12 dp, with no
 * outline. It is still something a thumb must hit on a tripod, and a screen reader reads a node's bounds, so the line
 * is the label of a button `touch` tall (centred in it), which hugs the line's width rather than the column's.
 */
export const TextLink = memo(function TextLink({ label, onPress, expanded }: TextLinkProps) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      onPress={onPress}
      style={linkStyle}
    >
      <Text variant="metricUnit" style={styles.underlined}>
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * Module-level so render allocates no function. Pressed dims the line to `pressedOpacity.link` (the controller's ruling,
 * Batch 17): it is already underlined, so a dim is its signal, where the outlined buttons fill.
 */
function linkStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedLink : styles.link;
}

const styles = StyleSheet.create({
  link: { minHeight: layout.touch, alignSelf: 'flex-start', justifyContent: 'center' },
  underlined: { textDecorationLine: 'underline' },
  pressed: { opacity: pressedOpacity.link },
});

const pressedLink = [styles.link, styles.pressed];
