import { memo } from 'react';
import { useVolleyballMatch } from '@/hooks/useVolleyballMatch';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';
import { VolleyballPadScreen } from '@/ui/screens/VolleyballPadScreen';

/**
 * A volleyball match (S2-6 Task 11; owner ruling 38: pad per sport): the match through volleyball's own hook, drawn by its
 * own pad screen, or, when it is not a pad, by the states every sport shares. The route reaches it through the table in
 * `scoringScreens.ts`, naming no sport.
 */
export const VolleyballMatchScreen = memo(function VolleyballMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useVolleyballMatch(fixtureId);
  if (match.kind === 'pad') return <VolleyballPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
