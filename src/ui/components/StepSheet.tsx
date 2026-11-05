import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** One choice in a step: its id goes back to the caller; a destructive one is drawn in caution. */
export type StepOption = {
  readonly id: string;
  readonly label: string;
  readonly tone: 'standard' | 'destructive';
};

type StepSheetProps = {
  readonly title: string;
  /** What is already chosen ("A. Sharma", "Warning"), or what the step means. */
  readonly body: string | null;
  readonly options: readonly StepOption[];
  readonly cancelLabel: string;
  readonly onChoose: (id: string) => void;
  readonly onCancel: () => void;
};

/**
 * A bottom sheet of steps over the pad (choose, pick a person, confirm), one step at a time: the caller holds which
 * step it is and hands this its title and choices. A plain View, with no entering animation (`padSheet.ts`). Cancel,
 * the dim and Back (the caller's `useBackCloses`) close it with nothing recorded. Modal to a screen reader: native
 * reads `accessibilityViewIsModal`, react-native-web `aria-modal`. The dim is a touch target only; Cancel is its name.
 */
export const StepSheet = memo(function StepSheet({
  title,
  body,
  options,
  cancelLabel,
  onChoose,
  onCancel,
}: StepSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="step-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        {body === null ? null : <Text variant="body">{body}</Text>}
        {options.map((option) => (
          <StepRow key={option.id} option={option} onChoose={onChoose} />
        ))}
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </View>
  );
});

/** One choice of a step, a full-width row; the tie-break sheet (`TieBreakSheet`) draws its rows with it too. */
export const StepRow = memo(function StepRow({
  option,
  onChoose,
}: {
  readonly option: StepOption;
  readonly onChoose: (id: string) => void;
}) {
  const choose = useCallback(() => onChoose(option.id), [onChoose, option.id]);
  const destructive = option.tone === 'destructive';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={choose}
      style={destructive ? destructiveRow : standardRow}
    >
      <Text variant="controlInk" style={destructive ? styles.labelDestructive : undefined}>
        {option.label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: layout.touch,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  destructive: { borderColor: colour.caution },
  pressed: { backgroundColor: colour.pressFill },
  labelDestructive: { color: colour.caution },
});

/** Module-level so render allocates no function; pressed takes the press fill, as GhostButton. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const standardRow = pressable(styles.row);
const destructiveRow = pressable([styles.row, styles.destructive]);
