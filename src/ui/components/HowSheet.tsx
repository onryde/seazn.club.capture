import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

/** One way a game can end: its id goes back to the caller as it is. */
export type HowOption = { readonly id: string; readonly label: string };

type HowSheetProps = {
  /** The question, with the player named: "How did A. Sharma win?" */
  readonly title: string;
  readonly options: readonly HowOption[];
  /** The id picked, or none: a method is optional. */
  readonly picked: string | null;
  readonly recordLabel: string;
  readonly cancelLabel: string;
  /** A method picked, or none when the picked one is tapped again. */
  readonly onPick: (id: string | null) => void;
  readonly onRecord: () => void;
  readonly onCancel: () => void;
};

/**
 * The sheet that asks how a game ended (plan S2-3 Task 3; spec §4): a title naming the player, the ways it could have
 * ended as chips of which one may be picked or none, and Record, which is the only thing here that records. The pick is
 * optional, so Record is never disabled; Cancel, the dim and Back (the caller's `useBackCloses`) close it with nothing
 * recorded. A plain View on the pad's sheet shape (`padSheet.ts`), modal to a screen reader: native reads
 * `accessibilityViewIsModal`, react-native-web `aria-modal`. The dim is a touch target only; Cancel is its name. The
 * caller holds the pick and sends nothing until Record.
 */
export const HowSheet = memo(function HowSheet({
  title,
  options,
  picked,
  recordLabel,
  cancelLabel,
  onPick,
  onRecord,
  onCancel,
}: HowSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable testID="how-dim" aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="how-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        <View style={styles.options}>
          {options.map((option) => (
            <HowChip
              key={option.id}
              option={option}
              picked={option.id === picked}
              onPick={onPick}
            />
          ))}
        </View>
        <Button label={recordLabel} onPress={onRecord} />
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </View>
  );
});

/** A method: one choice among them, said to a screen reader as picked or not, and drawn as a lime fill when picked. */
const HowChip = memo(function HowChip({
  option,
  picked,
  onPick,
}: {
  readonly option: HowOption;
  readonly picked: boolean;
  readonly onPick: (id: string | null) => void;
}) {
  const press = useCallback(() => onPick(picked ? null : option.id), [onPick, picked, option.id]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      // Not accessibilityState: react-native-web drops it, and React Native's Pressable reads aria-checked into the same
      // checked state (ChoiceRow).
      aria-checked={picked}
      onPress={press}
      style={picked ? pickedChip : chip}
    >
      <Text variant="controlInk" style={picked ? styles.labelPicked : undefined}>
        {option.label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: layout.touch,
    // A chip wider than the sheet wraps its own words, never past the edge.
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  picked: { backgroundColor: colour.lime, borderColor: colour.lime },
  pressed: { backgroundColor: colour.pressFill },
  labelPicked: { color: plateInk },
});

/** Module-level so render allocates no function; pressed takes the press fill, as GhostButton. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const chip = pressable(styles.chip);
const pickedChip = pressable([styles.chip, styles.picked]);
