import { Redirect } from 'expo-router';
import { useScreenAwake } from '@/hooks/useScreenAwake';
import { usePorts } from '@/hooks/usePorts';
import { BadmintonPadPreviewScreen } from '@/ui/screens/BadmintonPadPreviewScreen';

/**
 * S2's design preview: the badminton pad on a fake, opened from Home's Remote scoring tile in the dev twin only (the
 * controller's brief, 2026-10-31). A store build has no way here; a path that reaches it anyway goes Home.
 */
export default function ScoringPreviewRoute() {
  const { previewScoring } = usePorts();
  return previewScoring ? <PadShown /> : <Redirect href="/" />;
}

/** The screen stays on while the pad shows, and its brightness is left alone (owner rulings, 2026-10-31). */
function PadShown() {
  useScreenAwake();
  return <BadmintonPadPreviewScreen />;
}
