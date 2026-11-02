import { memo, type ReactNode } from 'react';
import type { PadStateCard as PadCard } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { EdgeCard, type Edge } from '@/ui/components/EdgeCard';
import { Text } from '@/ui/components/Text';

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
 * nothing to do yet. Said politely when it appears. What the caller gives it stands between the title and the sentence:
 * Not started's Match details (owner, 2026-11-01).
 */
export const PadStateCard = memo(function PadStateCard({
  card,
  children,
}: {
  readonly card: TitledCard;
  readonly children?: ReactNode;
}) {
  const { t } = useT();
  const copy = COPY[card.kind];
  return (
    <EdgeCard testID="pad-card" edge={EDGE[card.kind]}>
      <Text variant="panelTitle">{t(copy.title)}</Text>
      {children}
      <Text variant="body">{t(copy.body)}</Text>
    </EdgeCard>
  );
});

const EDGE: Readonly<Record<TitledCard['kind'], Edge>> = {
  notStarted: 'quiet',
  resultRecorded: 'lime',
  viewOnly: 'quiet',
  linkInvalid: 'caution',
};
