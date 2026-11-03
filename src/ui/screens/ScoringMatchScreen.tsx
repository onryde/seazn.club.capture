import { memo } from 'react';
import { useScoringSport } from '@/hooks/useScoringSport';
import { screenFor } from '@/ui/screens/scoringScreens';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';

/**
 * The Remote Scoring match, for the match saved by a scan (plan S2-1 Tasks 10 and 11; owner ruling 38, 2026-11-02: pad
 * per sport). The same for every sport: it asks which sport the match is (`useScoringSport`), draws the sport's own
 * screen from the table (`scoringScreens.ts`), and, until a sport is known or when this build has no screen for it,
 * draws the state in words (`ScoringStateScreen`). The match is opened and focused here, so its sender, its Realtime
 * listener and its dead-link rule run while the route shows.
 */
export const ScoringMatchScreen = memo(function ScoringMatchScreen({
  fixtureId,
}: {
  readonly fixtureId: string;
}) {
  const pick = useScoringSport(fixtureId);
  if (pick.kind !== 'sport') return <ScoringStateScreen fixtureId={fixtureId} state={pick} />;
  const Screen = screenFor(pick.sportKey);
  if (Screen === null) {
    const state = { kind: 'unsupportedSport', sportKey: pick.sportKey } as const;
    return <ScoringStateScreen fixtureId={fixtureId} state={state} />;
  }
  return <Screen fixtureId={fixtureId} />;
});
