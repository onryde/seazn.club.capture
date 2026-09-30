import { memo } from 'react';
import { selectStateKind } from '@/hooks/engineSelectors';
import { tallyPlateFor } from '@/hooks/preflight';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { TallyPlate } from '@/ui/components/TallyPlate';

/**
 * Beside Back on Settings and Diagnostics (AGENTS §6), so the broadcast is
 * never out of sight. The viewfinder's own plate, so the LIVE gate holds
 * here too: connecting never reads LIVE.
 */
export const LivePlate = memo(function LivePlate() {
  const kind = useEngineSelector(selectStateKind);
  const plate = tallyPlateFor(kind, false);
  const onAir = plate === 'connecting' || plate === 'live' || plate === 'trouble';
  return onAir ? <TallyPlate plate={plate} /> : null;
});
