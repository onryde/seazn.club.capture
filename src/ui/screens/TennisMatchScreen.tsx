import { memo } from 'react';
import { useTennisMatch } from '@/hooks/useTennisMatch';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';
import { TennisPadScreen } from '@/ui/screens/TennisPadScreen';

/**
 * A tennis match (S2-7 Task 11; owner ruling 38: pad per sport): the match through tennis's own hook, drawn by its own pad
 * screen, or, when it is not a pad, by the states every sport shares. The route reaches it through the table in
 * `scoringScreens.ts`, naming no sport.
 */
export const TennisMatchScreen = memo(function TennisMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useTennisMatch(fixtureId);
  if (match.kind === 'pad') return <TennisPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
