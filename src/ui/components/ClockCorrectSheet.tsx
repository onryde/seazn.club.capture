import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** A stepper's move, in seconds: back a minute, back ten seconds, on ten, on a minute (the web's four, design §7.5). */
export type ClockStep = -60 | -10 | 10 | 60;

/** The sheet's words, the sport's own: the title, Set, and each stepper's word. */
export type ClockCorrectWords = {
  readonly title: string;
  readonly set: string;
  readonly steps: Readonly<Record<ClockStep, string>>;
};

type ClockCorrectSheetProps = {
  /** The time the clock will be set to, as the match counts it ("34:12"), the caller's: the sheet holds none. */
  readonly time: string;
  /** Whether a step back would go before the last event: the back steppers are then disabled and the floor line shows. */
  readonly atFloor: boolean;
  readonly floorLine: string;
  readonly words: ClockCorrectWords;
  readonly onStep: (step: ClockStep) => void;
  readonly onSet: () => void;
  readonly onCancel: () => void;
};

const BACK: readonly ClockStep[] = [-60, -10];
const ON: readonly ClockStep[] = [10, 60];

/**
 * Correct, a match clock's sheet (S2-5 design §7.5): the time it will be set to, four steppers (−1 min, −10 s, +10 s,
 * +1 min) and Set. A clock cannot be set before the last event (the web would refuse it), so at that floor the back
 * steppers are disabled and the sheet says so. Cancel, the dim and Back (the caller's) close it with nothing set. A
 * plain View over the pad, modal to a screen reader, as every pad sheet (`padSheet.ts`). A kit part: no sport named.
 */
export const ClockCorrectSheet = memo(function ClockCorrectSheet({
  time,
  atFloor,
  floorLine,
  words,
  onStep,
  onSet,
  onCancel,
}: ClockCorrectSheetProps) {
  const { t } = useT();
  return (
    <View style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="clock-correct-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{words.title}</Text>
        <Text variant="tally" style={styles.time}>
          {time}
        </Text>
        <View style={styles.steps}>
          {BACK.map((step) => (
            <Stepper
              key={step}
              step={step}
              word={words.steps[step]}
              off={atFloor}
              onStep={onStep}
            />
          ))}
          {ON.map((step) => (
            <Stepper key={step} step={step} word={words.steps[step]} off={false} onStep={onStep} />
          ))}
        </View>
        {atFloor ? <Text variant="status">{floorLine}</Text> : null}
        <Button label={words.set} onPress={onSet} />
        <GhostButton label={t('scoring.sheet.cancel')} onPress={onCancel} />
      </View>
    </View>
  );
});

/** One stepper, a quarter of the row: lime-edged as every sheet control that takes a tap (owner ruling 85). */
const Stepper = memo(function Stepper({
  step,
  word,
  off,
  onStep,
}: {
  readonly step: ClockStep;
  readonly word: string;
  readonly off: boolean;
  readonly onStep: (step: ClockStep) => void;
}) {
  const press = useCallback(() => onStep(step), [onStep, step]);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={press}
      style={off ? stepperOff : stepperOn}
    >
      <Text variant="controlInk" numberOfLines={1} style={off ? styles.wordOff : undefined}>
        {word}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  time: { alignSelf: 'center' },
  steps: { flexDirection: 'row', gap: space.sm },
  stepper: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.lime,
  },
  off: { borderColor: colour.rule },
  pressed: { backgroundColor: colour.pressFill },
  wordOff: { color: colour.ink3 },
});

/** Module-level so render allocates no function; pressed takes the press fill, as a step row. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const stepperOn = pressable(styles.stepper);
const stepperOff: StyleProp<ViewStyle> = [styles.stepper, styles.off];
