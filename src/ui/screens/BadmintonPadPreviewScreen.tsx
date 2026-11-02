import { useMemo } from 'react';
import { useBadmintonPadPreview } from '@/hooks/useBadmintonPadPreview';
import { PadPreviewRow } from '@/ui/components/PadPreviewRow';
import { BadmintonPadScreen } from '@/ui/screens/BadmintonPadScreen';

/**
 * The badminton pad previewed on a fake (S2's first slice; the controller's brief, 2026-10-31): the real pad screen,
 * drawn from the design preview's model, with the preview's own row of states under it (the pad, Start, the cards, the
 * two samples, the sync, R4's Fold probe). The dev scene wrapper the plan keeps (S2-1 Task 11): no route and no tile
 * opens it any more, since the match the scan saved has the route; a test or a dev scene mounts it.
 */
export function BadmintonPadPreviewScreen() {
  const preview = useBadmintonPadPreview();
  const { chosen, actions } = preview;
  const picked = useMemo(() => [chosen.card, chosen.sample], [chosen.card, chosen.sample]);
  const footer = useMemo(
    () => <PadPreviewRow chosen={picked} onPick={actions.pick} />,
    [picked, actions.pick],
  );
  return <BadmintonPadScreen model={preview} footer={footer} />;
}
