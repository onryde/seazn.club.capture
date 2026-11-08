import { memo } from 'react';
import { useFootballMatch } from '@/hooks/useFootballMatch';
import { FootballPadScreen } from '@/ui/screens/FootballPadScreen';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';

/**
 * A football match (plan S2-5 P Task 12; owner ruling 38: pad per sport): the match through football's own hook, drawn by
 * football's own pad screen, or, when it is not a pad, by the states every sport shares. As the other sports' twins, it
 * is all a sport's screen is; the route reaches it through the table in `scoringScreens.ts`, naming no sport.
 */
export const FootballMatchScreen = memo(function FootballMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useFootballMatch(fixtureId);
  if (match.kind === 'pad') return <FootballPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
