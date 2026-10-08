import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  endedLines,
  type EndedCard as EndedCardData,
  type EndedLines,
} from '@/domain/session/endedCard';
import { useT } from '@/hooks/useLanguage';
import { formatElapsed } from '@/i18n/formatElapsed';
import type { MessageKey } from '@/i18n/messages';
import { rowCardPadding, type CardShape } from '@/ui/components/cardShape';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * `stacked` is the portrait card (the board's After-you-stopped): a header, the lines, then OK. `row` lays the same
 * parts in one row for landscape, where Home has no height to spare (spec §7); Home picks it.
 */
export type EndedCardLayout = CardShape;

type EndedCardProps = {
  readonly card: EndedCardData;
  readonly layout?: EndedCardLayout;
  readonly onOk: () => void;
};

/**
 * Spec §5's Stream ended card, on Home: how long it was on air, how it ended, what to do next, and OK. Text wraps
 * where it must and never truncates. A named region, so a screen reader finds it by its title.
 */
export const EndedCard = memo(function EndedCard({
  card,
  layout: shape = 'stacked',
  onOk,
}: EndedCardProps) {
  const { t } = useT();
  const lines = endedLines(card);
  const hints = hintKeys(lines);
  const styles = shape === 'row' ? rowStyles : stackedStyles;
  const time =
    lines.time.kind === 'neverLive'
      ? t('stream.ended.neverLive')
      : t('stream.ended.duration', { duration: formatElapsed(lines.time.durationMs) });
  return (
    <View role="region" aria-label={t('home.ended.title')} style={styles.card}>
      <View style={styles.head}>
        <Text variant="state" style={base.title}>
          {t('home.ended.title')}
        </Text>
        <Text variant="metricValue" style={styles.time}>
          {time}
        </Text>
      </View>
      <View style={styles.lines}>
        <Text variant="control">{t(reasonKey(lines))}</Text>
        {hints.map((hint) => (
          <Text key={hint} variant="metricUnit">
            {t(hint)}
          </Text>
        ))}
      </View>
      <GhostButton label={t('home.ended.ok')} onPress={onOk} />
    </View>
  );
});

/** How it ended. A fatal end over a dead code does not say the code is kept (F14 a). */
function reasonKey(lines: EndedLines): MessageKey {
  if (lines.reason === 'stopped') return 'stream.status.endedOperator';
  return lines.codeEnded ? 'home.ended.failed' : 'stream.status.endedFatal';
}

/**
 * What to do next, each line on its own account: scan again (the operator's Stop over a code that still works), and
 * that the code has ended (F14 a, a fatal end over a dead code too). `endedLines` makes them exclusive; this does
 * not choose between them. Nothing after a fatal end over a code that is kept.
 */
function hintKeys(lines: EndedLines): MessageKey[] {
  const keys: MessageKey[] = [];
  if (lines.scanAgain) keys.push('stream.ended.scanAgain');
  if (lines.codeEnded) keys.push('panel.codeEnded.body');
  return keys;
}

const base = StyleSheet.create({
  // The `state` role sets no colour, and the platform default is black, which is invisible on `surface`.
  title: { color: colour.ink, flexShrink: 0 },
});

const card = {
  borderRadius: radius.card,
  borderWidth: layout.cardBorder,
  borderColor: colour.ink3,
  backgroundColor: colour.surface,
} as const;

const stackedStyles = StyleSheet.create({
  card: { ...card, padding: space.md, gap: space.sm },
  // The time goes under the title when it does not fit beside it (a long language on a narrow phone), whole;
  // `flexShrink` is only the backstop for one longer than the card.
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  time: { flexShrink: 1 },
  lines: { gap: space.sm },
});

const rowStyles = StyleSheet.create({
  card: { ...card, ...rowCardPadding, flexDirection: 'row', alignItems: 'center', gap: space.md },
  head: { flexShrink: 0 },
  time: {},
  lines: { flex: 1, minWidth: 0 },
});
