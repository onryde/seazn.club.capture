import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadLastTap } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { GhostButton } from '@/ui/components/GhostButton';
import { RefusalBanner } from '@/ui/components/RefusalBanner';
import { Text } from '@/ui/components/Text';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

type LastTapLineProps = {
  readonly lastTap: PadLastTap<MessageKey> | null;
  /** A refusal of the last tap, said in place of the sentence; null when the last tap was recorded. */
  readonly refusal: string | null;
  readonly onUndo: () => void;
};

/**
 * Under the halves: what the last tap did ("Rally recorded — L. Chen"), or that it was not recorded, and the one Undo
 * (owner, 2026-10-31), which steps back through this phone's own taps. Undo is always in its place, enabled only when
 * it is offered, so the sentence beside it never changes width. The line reserves its two lines, so a sentence or a
 * refusal never moves the tool row under a thumb, and a new sentence is announced politely.
 */
export const LastTapLine = memo(function LastTapLine({
  lastTap,
  refusal,
  onUndo,
}: LastTapLineProps) {
  const { t } = useT();
  const words = usePadText();
  return (
    <View testID="last-tap" style={styles.line}>
      <View style={styles.message}>
        {refusal !== null ? (
          <RefusalBanner text={refusal} />
        ) : (
          <Text
            variant="control"
            numberOfLines={layout.padLineLines}
            accessibilityLiveRegion="polite"
          >
            {lastTap === null ? '' : words(lastTap.text)}
          </Text>
        )}
      </View>
      <GhostButton
        label={t('scoring.pad.undo')}
        onPress={onUndo}
        disabled={lastTap?.undo !== true}
      />
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
