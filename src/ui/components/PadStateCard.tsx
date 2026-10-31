import { memo } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import type { PadStateCard as PadCard } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** The cards with a title. An app too old to score is the update banner (`UpdateBanner.tsx`), in the controls' place. */
export type TitledCard = Exclude<PadCard, { readonly kind: 'updateNeeded' }>;

/** Each card's title and sentence: the web pad's own words where it has them (`device.*`). */
const COPY: Readonly<Record<TitledCard['kind'], { title: MessageKey; body: MessageKey }>> = {
  notStarted: { title: 'scoring.card.notStarted.title', body: 'scoring.card.notStarted.body' },
  resultRecorded: {
    title: 'scoring.card.resultRecorded.title',
    body: 'scoring.card.resultRecorded.body',
  },
  viewOnly: { title: 'scoring.card.viewOnly.title', body: 'scoring.card.viewOnly.body' },
  linkInvalid: { title: 'scoring.card.linkInvalid.title', body: 'scoring.card.linkInvalid.body' },
};

/**
 * Why the pad takes no tap, on a card: not started, a recorded result, view only, a dead link. The edge says which
 * kind: caution orange when something is wrong (a dead link), lime for a recorded result, lilac when there is only
 * nothing to do yet. Said politely when it appears.
 */
export const PadStateCard = memo(function PadStateCard({ card }: { readonly card: TitledCard }) {
  const { t } = useT();
  const copy = COPY[card.kind];
  return (
    <View testID="pad-card" accessibilityLiveRegion="polite" style={EDGE[card.kind]}>
      <Text variant="panelTitle">{t(copy.title)}</Text>
      <Text variant="body">{t(copy.body)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    backgroundColor: colour.surface,
  },
  caution: { borderLeftColor: colour.caution },
  lime: { borderLeftColor: colour.lime },
  quiet: { borderLeftColor: colour.ink3 },
});

const EDGE: Readonly<Record<TitledCard['kind'], StyleProp<ViewStyle>>> = {
  notStarted: [styles.card, styles.quiet],
  resultRecorded: [styles.card, styles.lime],
  viewOnly: [styles.card, styles.quiet],
  linkInvalid: [styles.card, styles.caution],
};
