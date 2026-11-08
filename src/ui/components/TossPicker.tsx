import { memo, useCallback, type ReactNode } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { NameText } from '@/ui/components/NameText';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/** A choice to pick: its id goes back to the caller as it is, and its words are drawn as typed (a side's name, "Bat"). */
export type TossOption<T extends string> = { readonly id: T; readonly label: string };

type TossPickerProps<T extends string> = {
  /** The question, in the operator's language: the group's heading and its name to a screen reader. */
  readonly ask: string;
  readonly options: readonly [TossOption<T>, TossOption<T>];
  readonly picked: T | null;
  readonly onPick: (id: T) => void;
  /**
   * The pair grows to fill its parent's height, its buttons never below `padTossHeight`, and the question keeps
   * `padTossAskLines` lines whatever it says (owner ruling 83: cricket's toss on the whole screen, so nothing moves).
   */
  readonly fill?: boolean;
  /** Not to be answered yet: greyed at the same size, and no press. Said disabled to a screen reader. */
  readonly disabled?: boolean;
};

/**
 * One choice of two as two big buttons (owner, 2026-11-01, option A: who serves first; ruling 83: cricket's toss and its
 * Bat or Bowl): the question, then the two, the names as typed. The picked one is the lime plate with night ink (AGENTS
 * §5). The question is a heading, drawn as the Rules subheading is; to a screen reader the buttons are a radio group it
 * names, each a radio, checked or not. The buttons stand side by side while the row holds two of `padTossMin`, and stack
 * when it does not; a name with gaps wraps in its button and is never cut, and one long word is shrunk to one line
 * (`NameText`). Generic over its ids, so a side, or Bat and Bowl, goes back to the caller typed.
 */
function TossPickerOf<T extends string>({
  ask,
  options,
  picked,
  onPick,
  fill = false,
  disabled = false,
}: TossPickerProps<T>) {
  return (
    <View style={fill ? styles.blockFill : styles.block}>
      <Text
        variant="state"
        accessibilityRole="header"
        numberOfLines={fill ? layout.padTossAskLines : undefined}
        style={ASK[fill ? 'fill' : 'plain'][disabled ? 'off' : 'on']}
      >
        {ask}
      </Text>
      <View
        testID="toss"
        accessibilityRole="radiogroup"
        accessibilityLabel={ask}
        style={fill ? styles.rowFill : styles.row}
      >
        {options.map((option) => (
          <TossSide
            key={option.id}
            option={option}
            checked={picked === option.id}
            disabled={disabled}
            onPick={onPick as (id: string) => void}
          />
        ))}
      </View>
    </View>
  );
}

export const TossPicker = memo(TossPickerOf) as <T extends string>(
  props: TossPickerProps<T>,
) => ReactNode;

const TossSide = memo(function TossSide({
  option,
  checked,
  disabled,
  onPick,
}: {
  readonly option: TossOption<string>;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onPick: (id: string) => void;
}) {
  const pick = useCallback(() => onPick(option.id), [onPick, option.id]);
  const look: Look = disabled ? 'off' : checked ? 'picked' : 'side';
  return (
    <Pressable
      testID={`toss-${option.id}`}
      accessibilityRole="radio"
      // Not accessibilityState: react-native-web drops it, and React Native's Pressable reads aria-checked into the
      // same checked state (0.86, Libraries/Components/Pressable/Pressable.js; ChoiceRow does the same). `disabled` is
      // the one gate, and Pressable folds it into the disabled state on the phone and `aria-disabled` on the web.
      aria-checked={checked}
      disabled={disabled}
      onPress={pick}
      style={SIDE[look]}
    >
      <NameText variant="label" style={NAME[look]}>
        {option.label}
      </NameText>
    </Pressable>
  );
});

/** The question's lines when the picker fills its half: kept whatever it says. */
const ASK_FILL = layout.padTossAskLines * typeScale.state.lineHeight;

const styles = StyleSheet.create({
  block: { gap: space.sm },
  blockFill: { flexGrow: 1, gap: space.sm },
  ask: { color: colour.ink2 },
  askOff: { color: colour.ink3 },
  askFill: { minHeight: ASK_FILL },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // A filled row stretches its line of buttons to its height, which flex-wrap would leave at the buttons' own.
  rowFill: {
    flexGrow: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'stretch',
    gap: space.sm,
  },
  // The border is drawn in every state, so a pick, or the pair enabled, does not move the names. A disabled button has
  // the box alone: no fill, so the ground shows through and it reads as not yet.
  box: {
    flexGrow: 1,
    flexBasis: layout.padTossMin,
    minHeight: layout.padTossHeight,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  side: { backgroundColor: colour.surface },
  picked: { borderColor: colour.lime, backgroundColor: colour.lime },
  name: { textAlign: 'center' },
  namePicked: { textAlign: 'center', color: plateInk },
  nameOff: { textAlign: 'center', color: colour.ink3 },
});

type Look = 'side' | 'picked' | 'off';

const SIDE: Readonly<Record<Look, StyleProp<ViewStyle>>> = {
  side: [styles.box, styles.side],
  picked: [styles.box, styles.picked],
  off: styles.box,
};
const NAME: Readonly<Record<Look, StyleProp<TextStyle>>> = {
  side: styles.name,
  picked: styles.namePicked,
  off: styles.nameOff,
};
type AskLook = Readonly<Record<'on' | 'off', StyleProp<TextStyle>>>;
const ASK: Readonly<Record<'plain' | 'fill', AskLook>> = {
  plain: { on: styles.ask, off: [styles.ask, styles.askOff] },
  fill: { on: [styles.ask, styles.askFill], off: [styles.ask, styles.askOff, styles.askFill] },
};
