import { memo } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

type ViewerPeekProps = {
  /** Nothing to play, or the ladder shed it (D2 §4.2): a tap does nothing. */
  readonly disabled: boolean;
  /** Why it is off, said at the control. */
  readonly reason: string | null;
  /** The view is open: the control reads selected, and a tap closes it. */
  readonly open: boolean;
  readonly onPress: () => void;
};

/**
 * What viewers see (D2 §4.3): a plain tap, never held. Its protection against a billed preview left running is that the
 * view closes by itself, 20 s after its first frame or 3 s after saying there is no picture; a tap never extends it
 * (AGENTS §6). Set in `actionSecondary`, as a pair with the action below it. Not `Button`: the lime plate's 200 dp
 * minimum does not fit the 110 dp cell (PD1). Selected while open, as IconButton says it (B5). `accessibilityHint`
 * reaches TalkBack; react-native-web drops it.
 */
export const ViewerPeek = memo(function ViewerPeek(props: ViewerPeekProps) {
  const { t } = useT();
  const { disabled, reason, open } = props;
  return (
    <View style={styles.zone}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stream.peek.label')}
        accessibilityHint={t('stream.peek.hint')}
        aria-selected={open}
        disabled={disabled}
        onPress={props.onPress}
        style={disabled ? offPeek : open ? openPeek : peekStyle}
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
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  pressed: { borderColor: colour.ink },
  open: { borderWidth: layout.iconBorderOn, borderColor: colour.lime },
  off: { borderColor: colour.rule },
  labelOff: { color: colour.ink3 },
});

const pressedPeek = [styles.peek, styles.pressed];
const openPeek = [styles.peek, styles.open];
const offPeek = [styles.peek, styles.off];
