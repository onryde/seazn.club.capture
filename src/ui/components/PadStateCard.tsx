import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadStateCard as PadCard } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { EdgeCard, type Edge } from '@/ui/components/EdgeCard';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** The cards with a title. An app too old to score is the update banner (`UpdateBanner.tsx`), in the controls' place. */
export type TitledCard = Exclude<PadCard, { readonly kind: 'updateNeeded' }>;
type ResultCard = Extract<TitledCard, { readonly kind: 'resultRecorded' }>;

/** Each card's title and sentence: the web pad's own words where it has them (`device.*`). A recorded result is its own. */
const COPY: Readonly<
  Record<Exclude<TitledCard['kind'], 'resultRecorded'>, { title: MessageKey; body: MessageKey }>
> = {
  notStarted: { title: 'scoring.card.notStarted.title', body: 'scoring.card.notStarted.body' },
  viewOnly: { title: 'scoring.card.viewOnly.title', body: 'scoring.card.viewOnly.body' },
  linkInvalid: { title: 'scoring.card.linkInvalid.title', body: 'scoring.card.linkInvalid.body' },
};

/**
 * Why the pad takes no tap, on a card: not started, a recorded result, view only, a dead link. The edge says which
 * kind: caution orange when something is wrong (a dead link), lime for a recorded result, lilac when there is only
 * nothing to do yet. Said politely when it appears. What the caller gives it stands between the title and the sentence:
 * Not started's Match details (owner, 2026-11-01). A recorded result is `RecordedResult`.
 */
export const PadStateCard = memo(function PadStateCard({
  card,
  children,
}: {
  readonly card: TitledCard;
  readonly children?: ReactNode;
}) {
  const { t } = useT();
  if (card.kind === 'resultRecorded') return <RecordedResult card={card} />;
  const words = COPY[card.kind];
  return (
    <EdgeCard testID="pad-card" edge={EDGE[card.kind]}>
      <Text variant="panelTitle">{t(words.title)}</Text>
      {children}
      <Text variant="body">{t(words.body)}</Text>
    </EdgeCard>
  );
});

/**
 * A recorded result and its Undo window (owner, 2026-11-03). The title and the sentence are the card's live region: said
 * politely once when the card appears, and once more when the window closes and the sentence changes in the same
 * node. The seconds are outside it, so the card is not read out every second; the card itself is no live region. A
 * screen reader reaches the digits by a swipe, and whether it says the card as described is the device check's.
 */
const RecordedResult = memo(function RecordedResult({ card }: { readonly card: ResultCard }) {
  const { t } = useT();
  const { undoLeft } = card;
  const sentence =
    undoLeft === null
      ? 'scoring.card.resultRecorded.bodyClosed'
      : 'scoring.card.resultRecorded.bodyOpen';
  return (
    <EdgeCard testID="pad-card" edge="lime" live="none">
      <View testID="pad-card-said" accessibilityLiveRegion="polite" style={styles.said}>
        <Text variant="panelTitle">{t('scoring.card.resultRecorded.title')}</Text>
        <Text variant="body">{t(sentence)}</Text>
      </View>
      {undoLeft === null ? null : (
        <Text testID="pad-card-countdown" variant="body" style={styles.digits}>
          {t('scoring.card.resultRecorded.undoCountdown', { seconds: undoLeft })}
        </Text>
      )}
    </EdgeCard>
  );
});

const styles = StyleSheet.create({
  said: { gap: space.sm },
  digits: { fontVariant: ['tabular-nums'] },
});

const EDGE: Readonly<Record<TitledCard['kind'], Edge>> = {
  notStarted: 'quiet',
  resultRecorded: 'lime',
  viewOnly: 'quiet',
  linkInvalid: 'caution',
};
