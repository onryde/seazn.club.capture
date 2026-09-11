import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space, status } from '@/ui/theme/tokens';

/**
 * A settings row that actually does something.
 *
 * The whole row is the target, not just the switch — cold hands, and a 44px
 * switch is a small thing to hit. React Native ships `Switch`; a component
 * library for one control would not have earned its place.
 */
export function Toggle({
  name,
  detail,
  value,
  disabled = false,
  onChange,
}: {
  name: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={`${name}. ${detail}`}
      style={styles.row}
    >
      <View style={styles.copy}>
        <Text variant="body" style={styles.name}>
          {name}
        </Text>
        <Text variant="status">{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        // Lime plate for "on": the same flip the web uses on night surfaces,
        // where a violet plate fails contrast.
        trackColor={{ false: colour.surface2, true: status.healthy }}
        thumbColor={value ? colour.ground : colour.ink3}
        ios_backgroundColor={colour.surface2}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    borderTopWidth: 1,
    borderTopColor: colour.ruleSoft,
    paddingVertical: space.md,
  },
  copy: {
    flex: 1,
    gap: space.xs,
  },
  name: {
    color: colour.ink,
  },
});
