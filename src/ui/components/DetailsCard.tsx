import { memo, useMemo } from 'react';
import type { PadMatchDetails } from '@/domain/scoring/padView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { MatchCard } from '@/ui/components/MatchCard';

/**
 * The match card (owner, 2026-11-01, option A) with the sport's rule rows in the operator's language: the one drawing
 * of Match details, on the Start screen, the Not started card and the sheet alike. The same for every set-based sport
 * (lifted from badminton's screen, plan S2-2 Task 8): the rows are the sport's own words.
 */
export const DetailsCard = memo(function DetailsCard({
  details,
}: {
  readonly details: PadMatchDetails<MessageKey>;
}) {
  const words = usePadText();
  const rows = useMemo(
    () => details.rules.map((row) => ({ label: words(row.label), value: words(row.value) })),
    [details.rules, words],
  );
  return <MatchCard context={details.context} rows={rows} />;
});
