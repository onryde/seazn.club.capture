import { memo } from 'react';
import { useChessMatch } from '@/hooks/useChessMatch';
import { ChessPadScreen } from '@/ui/screens/ChessPadScreen';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';

/**
 * A chess game (plan S2-3 Task 3; owner ruling 38: pad per sport): the match through chess's own hook, drawn by chess's
 * own pad screen, or, when it is not a pad, by the states every sport shares. As the other sports' twins, it is all a
 * sport's screen is; the route reaches it through the table in `scoringScreens.ts`, naming no sport.
 */
export const ChessMatchScreen = memo(function ChessMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const match = useChessMatch(fixtureId);
  if (match.kind === 'pad') return <ChessPadScreen model={match} />;
  return <ScoringStateScreen fixtureId={fixtureId} state={match} />;
});
