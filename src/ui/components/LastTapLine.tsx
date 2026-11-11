import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadLastTap } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { RefusalBanner } from '@/ui/components/RefusalBanner';
import { Text } from '@/ui/components/Text';
import { UndoButton } from '@/ui/components/UndoButton';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

type LastTapLineProps = {
  readonly lastTap: PadLastTap<MessageKey> | null;
  /** A refusal of the last tap, said in place of the sentence; null when the last tap was recorded. */
  readonly refusal: string | null;
  /**
   * A word under the sentence, which stays: "Counted once" for a repeat within the bounce window, whose first tap did
   * count. One line, in full ink; never caution, since nothing failed.
   */
  readonly note?: string | null;
  /**
   * Whether the line has an Undo at all (default yes). Only a recorded result whose Undo window has closed has none
   * (owner, 2026-11-03: `hasUndoCell`); every other pad keeps it in its place, disabled when it is not offered.
   */
  readonly undoCell?: boolean;
  readonly onUndo: () => void;
};

/**
 * Under the halves: what the last tap did ("Rally recorded — L. Chen"), or that it was not recorded, and the one Undo
 * (owner, 2026-10-31), which steps back through this phone's own taps. Undo is always in its place, enabled only when
 * it is offered, so the sentence beside it never changes width; but for a decided match whose Undo window has closed
 * (`undoCell`), where it is gone. The line reserves `padLineLines` lines (three), so a
 * sentence, a note under it or a refusal never moves the tool row under a thumb; a new sentence or note is announced
 * politely. With a note the sentence takes one line fewer, so the two keep within the reservation.
 */
export const LastTapLine = memo(function LastTapLine({
  lastTap,
  refusal,
  note = null,
  undoCell = true,
  onUndo,
}: LastTapLineProps) {
  const { t } = useT();
  const words = usePadText();
  const sentence = lastTap === null || lastTap.text === null ? '' : words(lastTap.text);
  return (
    <View testID="last-tap" style={styles.line}>
      <View style={styles.message}>
        {refusal !== null ? (
          <RefusalBanner text={refusal} />
        ) : (
          <Sentence sentence={sentence} note={note} />
        )}
      </View>
      {undoCell ? (
        <UndoButton
          label={t('scoring.pad.undo')}
          onPress={onUndo}
          disabled={lastTap?.undo !== true}
        />
      ) : null}
    </View>
  );
});

/** The last tap's sentence, and the note under it when there is one, announced politely as either changes. */
const Sentence = memo(function Sentence({
  sentence,
  note,
}: {
  readonly sentence: string;
  readonly note: string | null;
}) {
  return (
    <View accessibilityLiveRegion="polite">
      <Text
        testID="last-tap-sentence"
        variant="control"
        numberOfLines={note === null ? layout.padLineLines : layout.padLineLines - 1}
      >
        {sentence}
      </Text>
      {note === null ? null : (
        <Text testID="last-tap-note" variant="controlInk" numberOfLines={1}>
          {note}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: Math.max(layout.touch, layout.padLineLines * typeScale.control.lineHeight),
  },
  message: { flex: 1, minWidth: 0 },
});
