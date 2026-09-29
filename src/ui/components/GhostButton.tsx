import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

/** The secondary action beside a lime plate: outlined, never a second lime. */
export const GhostButton = memo(function GhostButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.ghost}>
      <Text variant="control">{label}</Text>
    </Pressable>
  );
});

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
});
