import { memo } from 'react';
import { Pressable, StyleSheet, type PressableStateCallbackType } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type ViewerPeekProps = {
  readonly onPressIn: () => void;
  readonly onPressOut: () => void;
};

/**
 * The control: held, never tapped. It reads as a pair with the action below
 * it (AGENTS §6), so it is set in `actionSecondary`, the role the type scale
 * keeps for it. No press delay to remove: RN's Pressable passes
 * `unstable_pressDelay` (unset) as Pressability's `delayPressIn`, which
 * defaults to 0, and Pressable has no `delayPressIn` prop of its own.
 * `accessibilityHint` reaches TalkBack; react-native-web drops it.
 */
export const ViewerPeek = memo(function ViewerPeek({ onPressIn, onPressOut }: ViewerPeekProps) {
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('stream.peek.label')}
      accessibilityHint={t('stream.peek.hint')}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={peekStyle}
    >
      <Text variant="actionSecondary">{t('stream.peek.label')}</Text>
    </Pressable>
  );
});

function peekStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedPeek : styles.peek;
}

const styles = StyleSheet.create({
  peek: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colour.ink3,
  },
  pressed: { borderColor: colour.ink },
});

const pressedPeek = [styles.peek, styles.pressed];
