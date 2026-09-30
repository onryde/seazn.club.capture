import { memo } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useHeldPress } from '@/hooks/useHeldPress';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type ViewerPeekProps = {
  /** Nothing to play (carry 13): a press that cannot play lights nothing. */
  readonly disabled: boolean;
  /** Why it is off, said at the control (spec §1's rule for Go live). */
  readonly reason: string | null;
  readonly onPressIn: () => void;
  readonly onPressOut: () => void;
};

/**
 * The control: held, never tapped. It reads as a pair with the action below
 * it (AGENTS §6), so it is set in `actionSecondary`, the role the type scale
 * keeps for it. No press delay to remove: RN's Pressable passes
 * `unstable_pressDelay` (unset) as Pressability's `delayPressIn`, which
 * defaults to 0, and Pressable has no `delayPressIn` prop of its own.
 * `accessibilityHint` reaches TalkBack; react-native-web drops it. If the
 * control unmounts while held it lets go itself (useHeldPress).
 */
export const ViewerPeek = memo(function ViewerPeek(props: ViewerPeekProps) {
  const { t } = useT();
  const { disabled, reason } = props;
  const press = useHeldPress(props.onPressIn, props.onPressOut);
  return (
    <View style={styles.zone}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stream.peek.label')}
        accessibilityHint={t('stream.peek.hint')}
        disabled={disabled}
        onPressIn={press.pressIn}
        onPressOut={press.pressOut}
        style={disabled ? offPeek : peekStyle}
      >
        <Text variant="actionSecondary" style={disabled ? styles.labelOff : null}>
          {t('stream.peek.label')}
        </Text>
      </Pressable>
      {reason === null ? null : <Text variant="metricUnit">{reason}</Text>}
    </View>
  );
});

function peekStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedPeek : styles.peek;
}

const styles = StyleSheet.create({
  zone: { gap: space.xs },
  peek: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colour.ink3,
  },
  pressed: { borderColor: colour.ink },
  off: { borderColor: colour.rule },
  labelOff: { color: colour.ink3 },
});

const pressedPeek = [styles.peek, styles.pressed];
const offPeek = [styles.peek, styles.off];
