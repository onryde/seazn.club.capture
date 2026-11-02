import { Redirect } from 'expo-router';
import { useScoringFixture } from '@/hooks/useScoringFixture';
import { useScreenAwake } from '@/hooks/useScreenAwake';
import { ScoringMatchScreen } from '@/ui/screens/ScoringMatchScreen';

/**
 * Remote Scoring (plan S2-1 Tasks 10 and 11): the match saved by a scan, drawn by its sport's own screen
 * (`ScoringMatchScreen`: the same for every sport). A path that reaches the route with no match saved goes Home.
 */
export default function ScoringRoute() {
  const fixtureId = useScoringFixture();
  if (fixtureId !== null) return <MatchShown fixtureId={fixtureId} />;
  return <Redirect href="/" />;
}

/** The screen stays on while the match shows, and its brightness is left alone (owner rulings, 2026-10-31). */
function MatchShown({ fixtureId }: { fixtureId: string }) {
  useScreenAwake();
  return <ScoringMatchScreen fixtureId={fixtureId} />;
}
