import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadAsk, PadAskSide } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

type AskSheetProps = {
  readonly ask: PadAsk;
  readonly onSend: () => void;
  /** Opens the question's own confirm: discarding is never one tap. */
  readonly onDiscard: () => void;
};

/**
 * The reconnect question (owner ruling 43, 2026-11-02): the owner scored offline, someone scored on the web, and the data
 * came back. How many were scored elsewhere (the title, in the plural), the score as the server has it without the
 * phone's taps, how many taps wait, then Send my taps, the lime plate, and Discard them, the outline, which asks again
 * before it deletes. Nothing on the pad closes it: the dim takes no tap, and Back still leaves the pad for Home
 * (the caller's). A plain View on the pad's sheet shape (`padSheet.ts`), as the pad's other sheets.
 */
export const AskSheet = memo(function AskSheet({ ask, onSend, onDiscard }: AskSheetProps) {
  const { t, tp } = useT();
  const [first, second] = ask.score;
  const said = `${t('scoring.ask.score')}. ${first.label} ${first.value}, ${second.label} ${second.value}`;
  return (
    <View style={padSheet.overlay}>
      <View testID="ask-dim" aria-hidden style={padSheet.dim} />
      <View testID="ask-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{tp('scoring.ask.title', ask.foreign)}</Text>
        <View testID="ask-score" accessible accessibilityLabel={said} style={styles.score}>
          <Text variant="status">{t('scoring.ask.score')}</Text>
          <ScoreRow testID="ask-score-first" side={first} />
          <ScoreRow testID="ask-score-second" side={second} />
        </View>
        <Text variant="body">{tp('scoring.ask.body', ask.queued)}</Text>
        <Button label={t('scoring.ask.send')} onPress={onSend} />
        <GhostButton label={t('scoring.ask.discard')} onPress={onDiscard} />
      </View>
    </View>
  );
});

/** A side's name as typed, cut with an ellipsis if it is wider than the row, and its score, whole, in the LED lime. */
const ScoreRow = memo(function ScoreRow({
  testID,
  side,
}: {
  readonly testID: string;
  readonly side: PadAskSide;
}) {
  return (
    <View style={styles.row}>
      <Text variant="label" numberOfLines={1} style={styles.name}>
        {side.label}
      </Text>
      <Text testID={testID} variant="tally">
        {side.value}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  score: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  name: { flexShrink: 1 },
});
