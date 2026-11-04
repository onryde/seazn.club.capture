import { memo } from 'react';
import { useTableTennisMatch } from '@/hooks/useTableTennisMatch';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';
import { TableTennisPadScreen } from '@/ui/screens/TableTennisPadScreen';

/**
 * A table tennis match (plan S2-2 Task 8; owner ruling 38: pad per sport): the match through table tennis's own hook,
 * drawn by table tennis's own pad screen, or, when it is not a pad, by the states every sport shares. As badminton's twin,
 * it is all a sport's screen is; the route reaches it through the table in `scoringScreens.ts`, naming no sport.
 */
export const TableTennisMatchScreen = memo(function TableTennisMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useTableTennisMatch(fixtureId);
  if (match.kind === 'pad') return <TableTennisPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
