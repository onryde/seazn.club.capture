import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type ChoiceRowProps = {
  readonly label: string;
  readonly role: 'switch' | 'radio';
  readonly checked: boolean;
  readonly onPress: () => void;
};

/**
 * A switch or a radio as one large row: easy to hit on a tripod, and its
 * state is said to a screen reader, not only shown. Off is an outline like
 * GhostButton's, so it still reads as a control; on is the lime LED.
 */
export const ChoiceRow = memo(function ChoiceRow({
  label,
  role,
  checked,
  onPress,
}: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      // Not accessibilityState: react-native-web drops it, and React Native's
      // Pressable reads aria-checked into the same checked state (0.86,
      // Libraries/Components/Pressable/Pressable.js).
      aria-checked={checked}
      onPress={onPress}
      style={checked ? rowOn : styles.row}
    >
      <Text variant="control">{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 2,
    borderColor: colour.ink3,
  },
  on: { borderColor: colour.lime },
});

const rowOn = [styles.row, styles.on];
