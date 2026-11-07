import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { HowOptions, type HowOption } from '@/ui/components/HowSheet';
import { padSheet } from '@/ui/components/padSheet';
import { StepRow, type StepOption } from '@/ui/components/StepSheet';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** One choice of a step: its id goes back to the caller as it is. */
export type TieBreakChoice = HowOption;

type TieBreakSheetProps = {
  readonly title: string;
  /** What the step means beside its choices: the player who advances. None on a step that asks only. */
  readonly body: string | null;
  /** A hint under the choices (the lots line on the rung step), or none. */
  readonly hint: string | null;
  /**
   * `rows`: each choice moves the sheet on, as a Card step's does (`StepSheet`). `chips`: one choice is picked, as How's methods
   * are (`HowSheet`), and Record sends. A step with no choices (the confirm) draws neither.
   */
  readonly layout: 'rows' | 'chips';
  readonly options: readonly TieBreakChoice[];
  /** The id picked among chips. Rows have none. */
  readonly picked: string | null;
  /** The label of Record, on the steps that end the sheet; none elsewhere. */
  readonly recordLabel: string | null;
  readonly cancelLabel: string;
  /** A choice made, or none when the picked chip is tapped again. */
  readonly onPick: (id: string | null) => void;
  readonly onRecord: () => void;
  readonly onCancel: () => void;
};

/**
 * One step of the tie-break sheet (S2-3b Task 2; design §3), on the pad's sheet shape (`padSheet.ts`): a title, a line of
 * what the step means, the choices, a hint, Record where the step ends the sheet, and Cancel. The caller holds the steps and
 * every choice and sends nothing until Record. Cancel, the dim and Back (the caller's `useBackCloses`) close it with nothing
 * recorded. A plain View, modal to a screen reader: native reads `accessibilityViewIsModal`, react-native-web `aria-modal`.
 * The dim is a touch target only; Cancel is its name. It reuses the Card steps' rows and How's chips rather than drawing a
 * second layout.
 */
export const TieBreakSheet = memo(function TieBreakSheet({
  title,
  body,
  hint,
  layout,
  options,
  picked,
  recordLabel,
  cancelLabel,
  onPick,
  onRecord,
  onCancel,
}: TieBreakSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable testID="tiebreak-dim" aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="tiebreak-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        {body === null ? null : <Text variant="body">{body}</Text>}
        <Choices layout={layout} options={options} picked={picked} onPick={onPick} />
        {hint === null ? null : <Text variant="body">{hint}</Text>}
        {recordLabel === null ? null : <Button label={recordLabel} onPress={onRecord} />}
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </View>
  );
});

const Choices = memo(function Choices({
  layout,
  options,
  picked,
  onPick,
}: Pick<TieBreakSheetProps, 'layout' | 'options' | 'picked' | 'onPick'>) {
  // A row never gives none back: only a chip can be tapped again.
  const choose = useCallback((id: string) => onPick(id), [onPick]);
  // One object per row for as long as the choices stand, so a row (memo) is drawn again only when its own words change.
  const rows = useMemo<readonly StepOption[]>(
    () => options.map((option) => ({ id: option.id, label: option.label, tone: 'standard' })),
    [options],
  );
  if (options.length === 0) return null;
  if (layout === 'chips') return <HowOptions options={options} picked={picked} onPick={onPick} />;
  return (
    <View style={styles.rows}>
      {rows.map((row) => (
        <StepRow key={row.id} option={row} onChoose={choose} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  rows: { gap: space.sm },
});
