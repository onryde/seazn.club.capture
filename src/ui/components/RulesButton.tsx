import { memo } from 'react';
import { type PressableStateCallbackType, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type RulesButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
};

/**
 * Rules, in the pad's top bar beside the sync status (owner ruling 15, 2026-10-31), for any sport: its word in the
 * tools' condensed type (`actionSecondary`, one line) in an outline, at least a touch target each way. Its side
 * padding is `space.xs`: at 320 dp it shares the bar with Back, the preview's tag and the sync words (padFit.test.ts).
 */
export const RulesButton = memo(function RulesButton({ label, onPress }: RulesButtonProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={buttonStyle}>
      <Text variant="actionSecondary" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    minHeight: layout.touch,
    minWidth: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  pressed: { backgroundColor: colour.pressFill, borderColor: colour.ink },
});

const pressedButton = [styles.button, styles.pressed];

/** Module-level so render allocates no function. Pressed takes the press fill and a cream edge, as GhostButton. */
function buttonStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedButton : styles.button;
}
