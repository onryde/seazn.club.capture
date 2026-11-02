import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useBadmintonPadPreview, type PreviewChoice } from '@/hooks/useBadmintonPadPreview';
import { Text } from '@/ui/components/Text';
import { BadmintonPadScreen } from '@/ui/screens/BadmintonPadScreen';

/**
 * The badminton pad's own screen suite drives the pad through a fake model (`useBadmintonPadPreview`): the pad, Start, the
 * state cards, the two sample matches and the sync steps, each a chip under the pad. Until plan S2-1 Task 11 those chips
 * were the app's dev preview (`PadPreviewRow`, with R4's Fold probe); the real route replaced the preview, and the chips
 * are this harness, for tests only. Literal English labels, since a test presses them by name, whatever language the pad
 * is in; the shipped dictionaries carry none of them.
 */
export const CHIP = {
  pad: 'Pad',
  start: 'Start',
  notStarted: 'Division not open',
  result: 'Result',
  viewOnly: 'View only',
  linkInvalid: 'Bad link',
  updateNeeded: 'Update needed',
  singles: 'Singles',
  doubles: 'Doubles',
  sync: 'Next sync state',
  row: 'Preview states',
} as const;

const CHIPS: readonly { readonly choice: PreviewChoice; readonly label: string }[] = [
  { choice: 'pad', label: CHIP.pad },
  { choice: 'start', label: CHIP.start },
  { choice: 'notStarted', label: CHIP.notStarted },
  { choice: 'resultRecorded', label: CHIP.result },
  { choice: 'viewOnly', label: CHIP.viewOnly },
  { choice: 'linkInvalid', label: CHIP.linkInvalid },
  { choice: 'updateNeeded', label: CHIP.updateNeeded },
  { choice: 'singles', label: CHIP.singles },
  { choice: 'doubles', label: CHIP.doubles },
  { choice: 'sync', label: CHIP.sync },
];

/** The real pad screen on the fake model, with the chips in its footer. */
export function PadWithPreviewChips() {
  const preview = useBadmintonPadPreview();
  const { chosen, actions } = preview;
  const picked = useMemo(() => [chosen.card, chosen.sample], [chosen.card, chosen.sample]);
  const footer = useMemo(
    () => <ChipRow chosen={picked} onPick={actions.pick} />,
    [picked, actions.pick],
  );
  return <BadmintonPadScreen model={preview} footer={footer} />;
}

function ChipRow({
  chosen,
  onPick,
}: {
  readonly chosen: readonly PreviewChoice[];
  readonly onPick: (choice: PreviewChoice) => void;
}) {
  return (
    <ScrollView
      horizontal
      testID="preview-row"
      accessibilityLabel={CHIP.row}
      style={styles.scroller}
    >
      {CHIPS.map((chip) => (
        <Chip
          key={chip.choice}
          choice={chip.choice}
          label={chip.label}
          selected={chosen.includes(chip.choice)}
          onPick={onPick}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  choice,
  label,
  selected,
  onPick,
}: {
  readonly choice: PreviewChoice;
  readonly label: string;
  readonly selected: boolean;
  readonly onPick: (choice: PreviewChoice) => void;
}) {
  const pick = useCallback(() => onPick(choice), [onPick, choice]);
  return (
    <Pressable accessibilityRole="button" aria-selected={selected} onPress={pick}>
      <Text variant="controlSmall">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({ scroller: { flexGrow: 0 } });
