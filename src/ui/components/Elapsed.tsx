import { memo } from 'react';
import { selectSinceEpochMs } from '@/hooks/engineSelectors';
import { useClockTick } from '@/hooks/useClockTick';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { formatElapsed } from '@/i18n/formatElapsed';
import { Text } from '@/ui/components/Text';

/** Time on air, on air only (spec §4). It survives a drop: the hold keeps the broadcast continuous. */
export const Elapsed = memo(function Elapsed() {
  const { t } = useT();
  const since = useEngineSelector(selectSinceEpochMs);
  const now = useClockTick(since !== null);
  if (since === null) return null;
  const time = formatElapsed(now - since);
  return (
    <Text variant="elapsed" accessibilityLabel={t('stream.elapsed.label', { time })}>
      {time}
    </Text>
  );
});
