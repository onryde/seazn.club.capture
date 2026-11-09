import {
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

/**
 * A choice in one of the pad's sheets (owner rulings 82 and 85, 2026-11-07: every sport's sheets, "player tap is not clear
 * or visiable so better to have a lime boder?"). A row that takes a tap has a lime border, so it stands apart from one
 * that cannot. The chosen one (the pick, or the suggestion) has a heavier lime border on `surface`, its padding one less
 * so its label does not move. One that cannot be chosen now is greyed (`ink3` border and label) and takes no press. A
 * destructive row (Undo, Remove, End) keeps the caution border (the controller's ruling F29, 2026-11-08: §5's caution
 * means failure or danger, and an orange border warns before the tap). On a list whose tap only picks and a
 * separate button confirms (the first bowler before Start innings, How's methods before Record), the pick is
 * `selected`: the lime plate with night ink, as the toss's picked half, keeping the heavier border (T19 D11; the
 * owner, "there is no difference when selecting the bowler, highlight it?", and the controller's ruling). A row
 * whose tap acts keeps `chosen` for its suggestion. The step sheet's rows (`StepRow`) and How's chips (`HowSheet`)
 * draw with these, so the rule has one home.
 */
export type SheetRowTone = 'standard' | 'destructive' | 'chosen' | 'selected' | 'off';

/**
 * The tone a row is drawn in: one that cannot be chosen is greyed whatever else it is; then the pick of a list a button
 * confirms, the chosen, then the destructive.
 */
export function sheetRowTone(row: {
  readonly disabled?: boolean;
  readonly chosen?: boolean;
  readonly selected?: boolean;
  readonly destructive?: boolean;
}): SheetRowTone {
  if (row.disabled === true) return 'off';
  if (row.selected === true) return 'selected';
  if (row.chosen === true) return 'chosen';
  return row.destructive === true ? 'destructive' : 'standard';
}

/** The heavier border is drawn inside the row: the padding gives the difference back. */
const HEAVIER = layout.iconBorderOn - layout.iconBorder;

export const sheetRow = StyleSheet.create({
  row: {
    minHeight: layout.touch,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.lime,
  },
  destructive: { borderColor: colour.caution },
  chosen: {
    borderWidth: layout.iconBorderOn,
    borderColor: colour.lime,
    backgroundColor: colour.surface,
    paddingHorizontal: space.md - HEAVIER,
  },
  selected: {
    borderWidth: layout.iconBorderOn,
    borderColor: colour.lime,
    backgroundColor: colour.lime,
    paddingHorizontal: space.md - HEAVIER,
  },
  off: { borderColor: colour.ink3 },
  pressed: { backgroundColor: colour.pressFill },
});

/**
 * The label in each tone: cream, but night on the plate, caution on a destructive row and greyed on one that cannot
 * be chosen.
 */
export const sheetRowLabel: Readonly<Record<SheetRowTone, StyleProp<TextStyle>>> =
  StyleSheet.create({
    standard: { color: colour.ink },
    chosen: { color: colour.ink },
    selected: { color: plateInk },
    destructive: { color: colour.caution },
    off: { color: colour.ink3 },
  });

type RowStyle =
  StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);

/** Module-level so render allocates no function; pressed takes the press fill, as GhostButton. */
function pressable(rest: StyleProp<ViewStyle>) {
  const down = [rest, sheetRow.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

/**
 * A Pressable's style for each tone over a base (`sheetRow.row`, and anything a caller adds to it, a chip's width), built
 * once at module level. A row that cannot be chosen starts no press, so it has no pressed state.
 */
export function sheetRowStyles(
  base: StyleProp<ViewStyle>,
): Readonly<Record<SheetRowTone, RowStyle>> {
  return {
    standard: pressable(base),
    destructive: pressable([base, sheetRow.destructive]),
    chosen: pressable([base, sheetRow.chosen]),
    selected: pressable([base, sheetRow.selected]),
    off: [base, sheetRow.off],
  };
}
