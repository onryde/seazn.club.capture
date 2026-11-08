import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { sheetRow, sheetRowLabel, sheetRowStyles } from '@/ui/components/sheetRow';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

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
        <HowOptions options={options} picked={picked} onPick={onPick} />
        <Button label={recordLabel} onPress={onRecord} />
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </View>
  );
});

/**
 * The ways a game could have ended, as chips that wrap to the sheet's width; one is picked, or none. The tie-break sheet's
 * score step draws its choices with it too (`TieBreakSheet`).
 */
export const HowOptions = memo(function HowOptions({
  options,
  picked,
  onPick,
}: {
  readonly options: readonly HowOption[];
  readonly picked: string | null;
  readonly onPick: (id: string | null) => void;
}) {
  return (
    <View style={styles.options}>
      {options.map((option) => (
        <HowChip key={option.id} option={option} picked={option.id === picked} onPick={onPick} />
      ))}
    </View>
  );
});

/**
 * A method: one choice among them, said to a screen reader as picked or not. It is a row that takes a tap, drawn as every
 * sport's sheet rows are (owner rulings 82 and 85, `sheetRow.ts`): lime, and the picked one the heavier lime on surface.
 */
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
  const tone = picked ? 'chosen' : 'standard';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      // Not accessibilityState: react-native-web drops it, and React Native's Pressable reads aria-checked into the same
      // checked state (ChoiceRow).
      aria-checked={picked}
      onPress={press}
      style={CHIP[tone]}
    >
      <Text variant="controlInk" style={sheetRowLabel[tone]}>
        {option.label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // A chip wider than the sheet wraps its own words, never past the edge.
  chip: { maxWidth: '100%' },
});

const CHIP = sheetRowStyles([sheetRow.row, styles.chip]);
