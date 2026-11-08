import { memo } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import type { ClockBarAction, ClockBarView } from '@/domain/scoring/clockBarView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';

type ClockBarProps = {
  readonly view: ClockBarView<MessageKey>;
  /** The one button's press: Start or Pause, as the view names it. */
  readonly onAction: () => void;
  /** A tap on the time opens Correct (S2-5 design §7.5); none where the sport offers no Correct now. */
  readonly onCorrect: (() => void) | null;
};

/**
 * A pad's match clock across the top (S2-5 design §6.1): the time in the LED lime with tabular figures, the period in
 * lilac caps under it, and one button at the right, Start while the clock is stopped and Pause while it runs. A kit part
 * with no sport named: the sport fills the view (`ClockBarView`) and the bar decides nothing. The time is a button that
 * opens Correct when the sport offers it; a screen reader hears it as the view says it ("Match clock 34:12"). The time
 * never wraps: it shrinks to fit its one line, down to `layout.clockFloor`, where the phone's font scale would push it
 * past the button (the controller's fix-round ruling d; the clock alone shrinks). The period wraps under it
 * (footballFit.test.ts holds both beside the button at 320 dp).
 */
export const ClockBar = memo(function ClockBar({ view, onAction, onCorrect }: ClockBarProps) {
  const words = usePadText();
  return (
    <View testID="clock-bar" style={styles.bar}>
      <ClockFace time={view.time} said={words(view.said)} onCorrect={onCorrect} />
      {view.action === null ? null : <ClockButton action={view.action} onPress={onAction} />}
      {view.period === null ? null : (
        <Text variant="diagSection" style={styles.period}>
          {words(view.period)}
        </Text>
      )}
    </View>
  );
});

/** The time: a button opening Correct when offered, else the same digits a screen reader reads once. */
const ClockFace = memo(function ClockFace({
  time,
  said,
  onCorrect,
}: {
  readonly time: string;
  readonly said: string;
  readonly onCorrect: (() => void) | null;
}) {
  const digits = (
    <Text
      variant="tally"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={layout.clockFloor}
      aria-hidden
      style={styles.time}
    >
      {time}
    </Text>
  );
  if (onCorrect === null) {
    return (
      <View accessible accessibilityLabel={said} style={styles.face}>
        {digits}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={said}
      onPress={onCorrect}
      style={facePressable}
    >
      {digits}
    </Pressable>
  );
});

/** Start or Pause: the lime plate with night ink (AGENTS §5's primary), a touch target at least. */
const ClockButton = memo(function ClockButton({
  action,
  onPress,
}: {
  readonly action: ClockBarAction<MessageKey>;
  readonly onPress: () => void;
}) {
  const words = usePadText();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={buttonPressable}>
      <Text variant="actionSecondary" numberOfLines={1} style={styles.buttonLabel}>
        {words(action.label)}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // The time and the button on one row; the period on its own row under them, as wide as the bar.
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
  },
  face: { flex: 1, minWidth: 0, minHeight: layout.touch, justifyContent: 'center' },
  facePressed: { opacity: pressedOpacity.link },
  time: { flexShrink: 0 },
  period: { width: '100%', color: colour.ink3 },
  button: {
    flexShrink: 0,
    minWidth: layout.touch,
    minHeight: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.lime,
    backgroundColor: colour.lime,
  },
  buttonPressed: { opacity: pressedOpacity.plate },
  buttonLabel: { color: plateInk },
});

/** Module-level so render allocates no function. */
function pressable(rest: StyleProp<ViewStyle>, pressedStyle: StyleProp<ViewStyle>) {
  const down = [rest, pressedStyle];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const facePressable = pressable(styles.face, styles.facePressed);
const buttonPressable = pressable(styles.button, styles.buttonPressed);
