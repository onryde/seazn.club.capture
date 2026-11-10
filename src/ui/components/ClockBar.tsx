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
import { type BoardTier, TIER_FACES } from '@/ui/theme/columnBoard';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';

type ClockBarProps = {
  readonly view: ClockBarView<MessageKey>;
  /** The one button's press: Start or Pause, as the view names it. */
  readonly onAction: () => void;
  /** A tap on the time opens Correct (S2-5 design §7.5); none where the sport offers no Correct now. */
  readonly onCorrect: (() => void) | null;
  /** A compact board's bar (fix-round 2 ruling R1, `columnBoard.ts`): one row, the period under the time. */
  readonly compact?: boolean;
};

/**
 * A pad's match clock across the top (S2-5 design §6.1): the time in the LED lime with tabular figures, the period in
 * lilac caps under it, and one button at the right, Start while the clock is stopped and Pause while it runs. A kit part
 * with no sport named: the sport fills the view (`ClockBarView`) and the bar decides nothing. The time is a button that
 * opens Correct when the sport offers it; a screen reader hears it as the view says it ("Match clock 34:12"). The time
 * never wraps: it shrinks to fit its one line, down to `layout.clockFloor`, where the phone's font scale would push it
 * past the button (the controller's fix-round ruling d; the clock alone shrinks). The period wraps under it
 * (footballFit.test.ts holds both beside the button at 320 dp). Compact (fix-round 2 ruling R1), the bar is one row of a
 * touch target: the time a step down with the period under it inside the face, which says both.
 */
export const ClockBar = memo(function ClockBar({
  view,
  onAction,
  onCorrect,
  compact,
}: ClockBarProps) {
  const words = usePadText();
  const period = view.period === null ? null : words(view.period);
  const tier: BoardTier = compact === true ? 'compact' : 'full';
  return (
    <View testID="clock-bar" style={styles.bar}>
      <ClockFace
        time={view.time}
        said={words(view.said)}
        tier={tier}
        period={period}
        onCorrect={onCorrect}
      />
      {view.action === null ? null : <ClockButton action={view.action} onPress={onAction} />}
      {tier === 'compact' || period === null ? null : <PeriodLine period={period} />}
    </View>
  );
});

type ClockFaceProps = {
  readonly time: string;
  readonly said: string;
  readonly tier: BoardTier;
  /** The period's words: drawn under the time in a compact face, and said with it. */
  readonly period: string | null;
  readonly onCorrect: (() => void) | null;
};

/** The time: a button opening Correct when offered, else the same digits a screen reader reads once. */
const ClockFace = memo(function ClockFace({ time, said, tier, period, onCorrect }: ClockFaceProps) {
  const under = tier === 'compact' ? period : null;
  const label = under === null ? said : `${said}, ${under}`;
  const digits = <ClockDigits time={time} tier={tier} under={under} />;
  if (onCorrect === null) {
    return (
      <View accessible accessibilityLabel={label} style={styles.face}>
        {digits}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onCorrect}
      style={facePressable}
    >
      {digits}
    </Pressable>
  );
});

type ClockDigitsProps = {
  readonly time: string;
  readonly tier: BoardTier;
  /** The period under the time, in a compact face only. */
  readonly under: string | null;
};

/** The time on its one line, shrinking to fit (ruling d), and in a compact face the period under it. The face says both. */
function ClockDigits({ time, tier, under }: ClockDigitsProps) {
  return (
    <>
      <Text
        variant={TIER_FACES[tier].time}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={layout.clockFloor}
        aria-hidden
        style={styles.time}
      >
        {time}
      </Text>
      {under === null ? null : (
        <Text variant="diagSection" numberOfLines={1} aria-hidden style={styles.periodUnder}>
          {under}
        </Text>
      )}
    </>
  );
}

/** A full bar's period: its own line under the time and the button, as wide as the bar, in lilac caps. */
function PeriodLine({ period }: { readonly period: string }) {
  return (
    <Text variant="diagSection" style={styles.period}>
      {period}
    </Text>
  );
}

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
  periodUnder: { color: colour.ink3 },
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
