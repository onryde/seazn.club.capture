import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { sheetRow, sheetRowLabel, sheetRowStyles, sheetRowTone } from '@/ui/components/sheetRow';
import { Text } from '@/ui/components/Text';

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
  /** The choice already made, or the one suggested: the heavier lime border on surface, said selected. */
  readonly chosen?: boolean;
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
  const off = option.disabled === true;
  const tone = sheetRowTone({
    disabled: off,
    chosen: option.chosen,
    destructive: option.tone === 'destructive',
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      aria-selected={tone === 'chosen' ? true : undefined}
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
