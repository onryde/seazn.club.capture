import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SwitchTrack } from '@/ui/components/SwitchTrack';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type ChoiceRowProps = {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
};

/**
 * A switch as one large row (the owner's Settings board): a filled card, the label on the left and a pill switch on
 * the right. The whole row is the control, easy to hit on a tripod, and its state is said to a screen reader, not
 * only shown; the pill is a picture of that state, so it is hidden from the accessibility tree and is never a
 * second control (`SwitchTrack`).
 */
export const ChoiceRow = memo(function ChoiceRow({ label, checked, onPress }: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      // Not accessibilityState: react-native-web drops it, and React Native's
      // Pressable reads aria-checked into the same checked state (0.86,
      // Libraries/Components/Pressable/Pressable.js).
      aria-checked={checked}
      onPress={onPress}
      style={styles.row}
    >
      <Text variant="controlInk" style={styles.label}>
        {label}
      </Text>
      <SwitchTrack checked={checked} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: layout.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.switchRowPadX,
    paddingVertical: space.sm,
    backgroundColor: colour.surface,
    borderRadius: radius.card,
  },
  // The label takes the line, so the switch is pushed to the right and a long label wraps beside it.
  label: { flex: 1 },
});
