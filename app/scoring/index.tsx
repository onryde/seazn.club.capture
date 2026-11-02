import { Redirect } from 'expo-router';
import { useScoringFixture } from '@/hooks/useScoringFixture';
import { useScreenAwake } from '@/hooks/useScreenAwake';
import { usePorts } from '@/hooks/usePorts';
import { BadmintonPadPreviewScreen } from '@/ui/screens/BadmintonPadPreviewScreen';
import { ScoringMatchScreen } from '@/ui/screens/ScoringMatchScreen';

/**
 * Remote Scoring (plan S2-1 Task 10): the match saved by a scan, or, with none saved, the S2 design preview on a fake
 * in the dev twin only (the controller's brief, 2026-10-31), which no tile opens now and Task 11 removes. A path that
 * reaches the route with neither goes Home.
 */
export default function ScoringRoute() {
  const fixtureId = useScoringFixture();
  const { previewScoring } = usePorts();
  if (fixtureId !== null) return <MatchShown fixtureId={fixtureId} />;
  return previewScoring ? <PadShown /> : <Redirect href="/" />;
}

/** The screen stays on while the match shows, and its brightness is left alone (owner rulings, 2026-10-31). */
function MatchShown({ fixtureId }: { fixtureId: string }) {
  useScreenAwake();
  return <ScoringMatchScreen fixtureId={fixtureId} />;
}

/** The screen stays on while the pad shows, and its brightness is left alone (owner rulings, 2026-10-31). */
function PadShown() {
  useScreenAwake();
  return <BadmintonPadPreviewScreen />;
}
