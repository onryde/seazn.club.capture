import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type GhostButtonProps = {
  label: string;
  onPress: () => void;
  /** Set only on a button that shows and hides something, like the language list. */
  expanded?: boolean;
  /**
   * The board's shorter box (Share record, 36 dp), its touch target kept at 48 by hit slop. The parent must be at
   * least `layout.touch` tall: on Android a slop reaches only as far as the parent's own bounds.
   */
  compact?: boolean;
};

/** The secondary action beside a lime plate: outlined, never a second lime. */
export const GhostButton = memo(function GhostButton({
  label,
  onPress,
  expanded,
  compact = false,
}: GhostButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      onPress={onPress}
      hitSlop={compact ? COMPACT_SLOP : undefined}
      style={compact ? compactStyle : ghostStyle}
    >
      <Text variant="control">{label}</Text>
    </Pressable>
  );
});

/** Module-level so render allocates no function; pressed dims the outline, as Button does. */
function ghostStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedGhost : styles.ghost;
}

function compactStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedCompact : compactGhost;
}

/** What a thumb may hit beyond the 36 dp box, above and below, to make 48 (a stable object: no render allocates it). */
const SLOP = (layout.touch - layout.ghostCompact) / 2;
const COMPACT_SLOP = { top: SLOP, bottom: SLOP } as const;

const styles = StyleSheet.create({
  ghost: {
    minHeight: 48,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  compact: { minHeight: layout.ghostCompact },
  pressed: { opacity: 0.85 },
});

const pressedGhost = [styles.ghost, styles.pressed];
const compactGhost = [styles.ghost, styles.compact];
const pressedCompact = [styles.ghost, styles.compact, styles.pressed];
