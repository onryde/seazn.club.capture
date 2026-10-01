import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useHold } from '@/hooks/useHold';
import { useT } from '@/hooks/useLanguage';
import { HoldFill } from '@/ui/components/HoldFill';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type HoldActionProps = {
  readonly label: string;
  readonly tone: 'go' | 'stop';
  readonly disabled: boolean;
  /** Why it is disabled, said at the control (spec §1). */
  readonly reason: string | null;
  readonly onHeld: () => void;
};

/**
 * Go live and Stop (AGENTS §6): a 3 s hold under a moving fill, because at a
 * ground the costly mistake is a mis-tap, in either direction.
 *
 * `disabled` alone marks it for a screen reader: Pressable folds it into
 * accessibilityState on native (Pressable.js) and into aria-disabled on the
 * web (react-native-web 0.21.2), so no second, inline state object is passed.
 */
export const HoldAction = memo(function HoldAction(props: HoldActionProps) {
  const { t } = useT();
  const { label, tone, disabled, reason, onHeld } = props;
  const hold = useHold(onHeld, !disabled);
  return (
    <View style={styles.zone}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stream.action.holdLabel', { label })}
        disabled={disabled}
        onPressIn={hold.pressIn}
        onPressOut={hold.pressOut}
        style={disabled ? plateOff : styles.plate}
      >
        <HoldFill holding={hold.holding} tone={tone} />
        <Text variant="action" style={disabled ? styles.labelOff : styles.label}>
          {label}
        </Text>
      </Pressable>
      {reason === null ? null : <Text variant="metricUnit">{reason}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  zone: { gap: space.xs },
  plate: {
    minHeight: 64,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 2,
    borderColor: colour.ink,
    backgroundColor: colour.surface2,
  },
  off: { borderColor: colour.rule },
  label: { color: colour.ink },
  labelOff: { color: colour.ink3 },
});

const plateOff = [styles.plate, styles.off];
