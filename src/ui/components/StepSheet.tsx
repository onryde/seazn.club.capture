import { memo, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { sheetRow, sheetRowLabel, sheetRowStyles, sheetRowTone } from '@/ui/components/sheetRow';
import { SwitchTrack } from '@/ui/components/SwitchTrack';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * One choice in a step: its id goes back to the caller. Every row that takes a tap is drawn lime, a destructive one
 * (Undo, Remove, End) in caution (`sheetRow.ts`, owner rulings 82 and 85).
 */
export type StepOption = {
  readonly id: string;
  readonly label: string;
  readonly tone: 'standard' | 'destructive';
  /** Not offered now: greyed, with no press. Its reason is `note`. */
  readonly disabled?: boolean;
  /**
   * A second line under the label, in the inert caption: why a row cannot be chosen ("Bowled the last over"), or what a
   * row that can is ("Retired").
   */
  readonly note?: string | null;
  /**
   * The choice already made, or the one suggested, on a list whose tap acts: the heavier lime border on surface, said
   * selected.
   */
  readonly chosen?: boolean;
  /**
   * The pick on a list whose tap only picks and a separate button confirms (the first bowler before Start innings): the
   * lime plate with night ink, said selected (T19 D11, `sheetRow.ts`).
   */
  readonly selected?: boolean;
  /**
   * A row is a `choice` unless it says otherwise: a `heading` names the group under it ("Bench") and takes no press; a
   * `toggle` is a switch the caller turns (`checked`), handing its id back as a choice does (S2-5 design §6.3: Penalty
   * on the scorer step).
   */
  readonly kind?: 'choice' | 'heading' | 'toggle';
  /** A toggle's state; read only by a toggle. */
  readonly checked?: boolean;
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
 * The rows scroll past `layout.sheetListMax`, so a team's sixteen players never push the title or Cancel off the screen.
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
        <ScrollView testID="step-options" style={styles.list} contentContainerStyle={styles.rows}>
          {options.map((option) => (
            <StepRow key={option.id} option={option} onChoose={onChoose} />
          ))}
        </ScrollView>
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </View>
  );
});

/**
 * One choice of a step, a full-width row; the tie-break sheet (`TieBreakSheet`) draws its rows with it too. A row that
 * cannot be chosen now takes no press: `disabled` is its one gate, which Pressable also folds into the state a screen
 * reader reads, on the phone and on the web. Its label and its reason are both read.
 */
export const StepRow = memo(function StepRow({
  option,
  onChoose,
}: {
  readonly option: StepOption;
  readonly onChoose: (id: string) => void;
}) {
  const choose = useCallback(() => onChoose(option.id), [onChoose, option.id]);
  if (option.kind === 'heading') return <HeadingRow label={option.label} />;
  if (option.kind === 'toggle') {
    return <ToggleRow label={option.label} checked={option.checked === true} onPress={choose} />;
  }
  const off = option.disabled === true;
  const tone = sheetRowTone({
    disabled: off,
    chosen: option.chosen,
    selected: option.selected,
    destructive: option.tone === 'destructive',
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      aria-selected={tone === 'chosen' || tone === 'selected' ? true : undefined}
      disabled={off}
      onPress={choose}
      style={ROW[tone]}
    >
      <Text variant="controlInk" style={sheetRowLabel[tone]}>
        {option.label}
      </Text>
      {option.note != null ? <Text variant="metricUnit">{option.note}</Text> : null}
    </Pressable>
  );
});

const ROW = sheetRowStyles(sheetRow.row);

/** The name of the group under it ("Bench"): lilac caps, no border, no press. */
const HeadingRow = memo(function HeadingRow({ label }: { readonly label: string }) {
  return (
    <Text accessibilityRole="header" variant="diagSection" style={styles.heading}>
      {label}
    </Text>
  );
});

/** A switch the caller turns: its label and the pill, one target; a screen reader hears whether it is on. */
const ToggleRow = memo(function ToggleRow({
  label,
  checked,
  onPress,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      // aria-checked, not accessibilityState: react-native-web drops the state object, and React Native's Pressable
      // reads aria-checked into the same checked state (0.86, Pressable.js: `checked: ariaChecked ?? accessibilityState`).
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={onPress}
      style={TOGGLE}
    >
      <Text variant="controlInk" style={styles.toggleLabel}>
        {label}
      </Text>
      <SwitchTrack checked={checked} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  list: { flexGrow: 0, maxHeight: layout.sheetListMax },
  rows: { gap: space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  toggleLabel: { flex: 1, minWidth: 0 },
  heading: { color: colour.ink3, paddingTop: space.xs, paddingHorizontal: space.md },
});

const TOGGLE = sheetRowStyles([sheetRow.row, styles.toggle]).standard;
