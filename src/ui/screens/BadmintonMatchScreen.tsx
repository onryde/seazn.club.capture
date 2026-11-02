import { memo } from 'react';
import { useBadmintonMatch } from '@/hooks/useBadmintonMatch';
import { BadmintonPadScreen } from '@/ui/screens/BadmintonPadScreen';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';

/**
 * A badminton match (plan S2-1 Task 11; owner ruling 38, 2026-11-02: pad per sport): the match through badminton's own
 * hook, drawn by badminton's own pad screen, or, when it is not a pad, by the states every sport shares. This is all a
 * sport's screen is; the route reaches it through the table in `scoringScreens.ts`, naming no sport.
 */
export const BadmintonMatchScreen = memo(function BadmintonMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useBadmintonMatch(fixtureId);
  if (match.kind === 'pad') return <BadmintonPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
