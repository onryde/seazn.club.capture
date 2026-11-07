import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PadSide, PadStartSide } from '@/domain/scoring/padView';
import { NameText } from '@/ui/components/NameText';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

/** A side to pick: its seat and its name (a plate, if the sport gives one, is not the picker's). */
type TossOption = Pick<PadStartSide, 'side' | 'label'>;

type TossPickerProps = {
  /** The question, in the operator's language: the group's heading and its name to a screen reader. */
  readonly ask: string;
  readonly sides: readonly [TossOption, TossOption];
  readonly picked: PadSide | null;
  readonly onPick: (side: PadSide) => void;
};

/**
 * Who serves first (owner, 2026-11-01, option A), for any sport with a toss: the question, then the two sides as two
 * big buttons, the names as typed, one choice. The picked one is the lime plate with night ink (AGENTS §5). The
 * question is a heading, drawn as the Rules subheading is; to a screen reader the buttons are a radio group it names,
 * each side a radio, checked or not. The buttons stand side by side while
 * the row holds two of `padTossMin`, and stack when it does not; a name with gaps wraps in its button and is never
 * cut, and one long word is shrunk to one line (`NameText`).
 */
export const TossPicker = memo(function TossPicker({
  ask,
  sides,
  picked,
  onPick,
}: TossPickerProps) {
  return (
    <View style={styles.block}>
      <Text variant="state" accessibilityRole="header" style={styles.ask}>
        {ask}
      </Text>
      <View
        testID="toss"
        accessibilityRole="radiogroup"
        accessibilityLabel={ask}
        style={styles.row}
      >
        {sides.map((side) => (
          <TossSide key={side.side} side={side} checked={picked === side.side} onPick={onPick} />
        ))}
      </View>
    </View>
  );
});

const TossSide = memo(function TossSide({
  side,
  checked,
  onPick,
}: {
  readonly side: TossOption;
  readonly checked: boolean;
  readonly onPick: (side: PadSide) => void;
}) {
  const pick = useCallback(() => onPick(side.side), [onPick, side.side]);
  return (
    <Pressable
      testID={`toss-${side.side}`}
      accessibilityRole="radio"
      // Not accessibilityState: react-native-web drops it, and React Native's Pressable reads aria-checked into the
      // same checked state (0.86, Libraries/Components/Pressable/Pressable.js; ChoiceRow does the same).
      aria-checked={checked}
      onPress={pick}
      style={checked ? pickedStyle : styles.side}
    >
      <NameText variant="label" style={checked ? styles.namePicked : styles.name}>
        {side.label}
      </NameText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.sm },
  ask: { color: colour.ink2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // The border is drawn in both states, so a pick does not move the names.
  side: {
    flexGrow: 1,
    flexBasis: layout.padTossMin,
    minHeight: layout.padTossHeight,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
    backgroundColor: colour.surface,
  },
  picked: { borderColor: colour.lime, backgroundColor: colour.lime },
  name: { textAlign: 'center' },
  namePicked: { textAlign: 'center', color: plateInk },
});

const pickedStyle = [styles.side, styles.picked];
