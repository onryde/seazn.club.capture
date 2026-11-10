import { memo } from 'react';
import { useCricketMatch } from '@/hooks/useCricketMatch';
import { CricketPadScreen } from '@/ui/screens/CricketPadScreen';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';

/**
 * A cricket match (S2-4 plan Task 8; owner ruling 38: pad per sport): the match through cricket's own hook, drawn by
 * cricket's own pad screen, or, when it is not a pad, by the states every sport shares. As the other sports' twins, it is
 * all a sport's screen is; the route reaches it through the table in `scoringScreens.ts`, naming no sport.
 */
export const CricketMatchScreen = memo(function CricketMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useCricketMatch(fixtureId);
  if (match.kind === 'pad') return <CricketPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
