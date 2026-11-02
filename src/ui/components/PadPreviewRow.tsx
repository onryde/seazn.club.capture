import { memo, useCallback } from 'react';
import { type PressableStateCallbackType, Pressable, ScrollView, StyleSheet } from 'react-native';
import { foldProbeLine } from '@/hooks/foldProbe';
import type { PreviewChoice } from '@/hooks/useBadmintonPadPreview';
import { useFoldProbe } from '@/hooks/useFoldProbe';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * The row's chips, in order, with their words: the pad, Start (the sample afresh, not started), the five state cards
 * (Not started's says "Division not open", so it never reads as Start), the two sample matches, the sync.
 */
const CHIPS: readonly { readonly choice: PreviewChoice; readonly label: MessageKey }[] = [
  { choice: 'pad', label: 'scoring.preview.dev.pad' },
  { choice: 'start', label: 'scoring.preview.dev.start' },
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
 * local release build sees it too. Not part of the pad: S2's real screen has no such row. It ends with R4's Fold probe
 * (plan S2-1 Task 1), which needs exactly that reach: the engine timed under Hermes in a release build.
 */
export const PadPreviewRow = memo(function PadPreviewRow({ chosen, onPick }: PadPreviewRowProps) {
  const { t } = useT();
  return (
    <ScrollView
      horizontal
      testID="preview-row"
      accessibilityLabel={t('scoring.preview.dev.label')}
      style={styles.scroller}
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
      <FoldProbeChip />
    </ScrollView>
  );
});

/**
 * R4 (plan S2-1 Task 1 Step 6): folds the 76-event badminton match 50 times on the engine and shows the events and the
 * fastest, median and slowest fold in ms beside the chip; the record gets `scoring.foldProbe`. Its own state, so a run
 * re-renders this chip and not the row.
 */
const FoldProbeChip = memo(function FoldProbeChip() {
  const { t } = useT();
  const { state, run } = useFoldProbe();
  const line = foldProbeLine(state);
  return (
    <>
      <Pressable accessibilityRole="button" onPress={run} style={chipStyle}>
        <Text variant="controlSmall">{t('scoring.preview.dev.foldProbe')}</Text>
      </Pressable>
      {line === null ? null : (
        <Text variant="controlSmall" testID="fold-probe-line" style={styles.reading}>
          {line}
        </Text>
      )}
    </>
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
  // A horizontal ScrollView grows by default on native (flexGrow 1), which took half the pad's height from the
  // halves on the phone; react-native-web does not, so only a device shows it.
  scroller: { flexGrow: 0 },
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
  // Numbers that change as the probe reads must not twitch (AGENTS §5).
  reading: { fontVariant: ['tabular-nums'] },
});

/** Module-level so render allocates no function; pressed takes the press fill, as GhostButton. */
function pressable(rest: object) {
  const down = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const chipStyle = pressable(styles.chip);
const chosenStyle = pressable([styles.chip, styles.chosen]);
