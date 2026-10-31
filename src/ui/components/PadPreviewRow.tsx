import { memo, useCallback } from 'react';
import { type PressableStateCallbackType, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { PreviewChoice } from '@/hooks/useBadmintonPadPreview';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** The row's chips, in order, with their words: the pad, the five state cards, the two sample matches, the sync. */
const CHIPS: readonly { readonly choice: PreviewChoice; readonly label: MessageKey }[] = [
  { choice: 'pad', label: 'scoring.preview.dev.pad' },
  { choice: 'notStarted', label: 'scoring.preview.dev.notStarted' },
  { choice: 'resultRecorded', label: 'scoring.preview.dev.result' },
  { choice: 'viewOnly', label: 'scoring.preview.dev.viewOnly' },
  { choice: 'linkInvalid', label: 'scoring.preview.dev.linkInvalid' },
  { choice: 'updateNeeded', label: 'scoring.preview.dev.updateNeeded' },
  { choice: 'singles', label: 'scoring.preview.dev.singles' },
  { choice: 'doubles', label: 'scoring.preview.dev.doubles' },
  { choice: 'sync', label: 'scoring.preview.dev.sync' },
];

type PadPreviewRowProps = {
  /** The chips that show as chosen: the card (or the pad) and the sample. */
  readonly chosen: readonly PreviewChoice[];
  readonly onPick: (choice: PreviewChoice) => void;
};

/**
 * The design preview's own row (the controller's brief, 2026-10-31), under the pad: one chip per state to look at,
 * scrolled sideways. It is on the preview screen only, which only a dev-twin build opens, so the owner holding a
 * local release build sees it too. Not part of the pad: S2's real screen has no such row.
 */
export const PadPreviewRow = memo(function PadPreviewRow({ chosen, onPick }: PadPreviewRowProps) {
  const { t } = useT();
  return (
    <ScrollView
      horizontal
      testID="preview-row"
      accessibilityLabel={t('scoring.preview.dev.label')}
      contentContainerStyle={styles.row}
    >
      {CHIPS.map((chip) => (
        <PreviewChip
          key={chip.choice}
          choice={chip.choice}
          label={t(chip.label)}
          selected={chosen.includes(chip.choice)}
          onPick={onPick}
        />
      ))}
    </ScrollView>
  );
});

const PreviewChip = memo(function PreviewChip({
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
    <Pressable
      accessibilityRole="button"
      aria-selected={selected}
      onPress={pick}
      style={selected ? chosenStyle : chipStyle}
    >
      <Text variant="controlSmall">{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { gap: space.xs, alignItems: 'center' },
  chip: {
    minHeight: layout.touch,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.rule,
  },
  chosen: { borderColor: colour.lime },
  pressed: { backgroundColor: colour.pressFill },
});

/** Module-level so render allocates no function; pressed takes the press fill, as GhostButton. */
function pressable(rest: object) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const chipStyle = pressable(styles.chip);
const chosenStyle = pressable([styles.chip, styles.chosen]);
