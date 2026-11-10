import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { SheetFrame } from '@/ui/components/SheetFrame';
import { sheetRow, sheetRowLabel, sheetRowStyles } from '@/ui/components/sheetRow';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

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
 * `SheetFrame` over the pad, modal to a screen reader, as every pad sheet. A kit part: no sport named.
 */
export const ClockCorrectSheet = memo(function ClockCorrectSheet(props: ClockCorrectSheetProps) {
  const { time, atFloor, floorLine, words, onStep, onSet, onCancel } = props;
  const { t } = useT();
  return (
    <SheetFrame testID="clock-correct-sheet" dimTestID="clock-correct-dim" onDim={onCancel}>
      <Text variant="title">{words.title}</Text>
      <Text variant="tally" style={styles.time}>
        {time}
      </Text>
      <Steppers steps={words.steps} atFloor={atFloor} onStep={onStep} />
      {atFloor ? <Text variant="status">{floorLine}</Text> : null}
      <Button label={words.set} onPress={onSet} />
      <GhostButton label={t('scoring.sheet.cancel')} onPress={onCancel} />
    </SheetFrame>
  );
});

type SteppersProps = {
  readonly steps: ClockCorrectWords['steps'];
  readonly atFloor: boolean;
  readonly onStep: (step: ClockStep) => void;
};

/** The four steppers in a row: the two back ones off at the floor, the two on always live. */
function Steppers({ steps, atFloor, onStep }: SteppersProps) {
  return (
    <View style={styles.steps}>
      {BACK.map((step) => (
        <Stepper key={step} step={step} word={steps[step]} off={atFloor} onStep={onStep} />
      ))}
      {ON.map((step) => (
        <Stepper key={step} step={step} word={steps[step]} off={false} onStep={onStep} />
      ))}
    </View>
  );
}

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
      style={STEPPER[off ? 'off' : 'standard']}
    >
      <Text variant="controlInk" numberOfLines={1} style={sheetRowLabel[off ? 'off' : 'standard']}>
        {word}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  time: { alignSelf: 'center' },
  steps: { flexDirection: 'row', gap: space.sm },
  stepper: { flex: 1, minWidth: 0, alignItems: 'center' },
});

/** A stepper is a sheet row (`sheetRow.ts`: lime border, greyed when off, the press fill), a quarter of the row wide. */
const STEPPER = sheetRowStyles([sheetRow.row, styles.stepper]);
