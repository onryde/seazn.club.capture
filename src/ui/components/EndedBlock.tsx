import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { selectEndedDurationMs, selectEndReason } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { formatElapsed } from '@/i18n/formatElapsed';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * Spec §4's Ended: how long it was on air, then Scan another. How it ended is
 * the status line's; Home is on the bottom strip. The time is native's
 * (plan B's `durationMs`, carry 16), null only for a session that never went
 * live, which says so instead. After the operator's Stop the code is
 * forgotten, so it asks for a rescan (amendment §2); a permanent failure keeps
 * the code, and its line already says so.
 */
export const EndedBlock = memo(function EndedBlock({
  onScanAnother,
}: {
  onScanAnother: () => void;
}) {
  const { t } = useT();
  const durationMs = useEngineSelector(selectEndedDurationMs);
  const reason = useEngineSelector(selectEndReason);
  const summary =
    durationMs === null
      ? t('stream.ended.neverLive')
      : t('stream.ended.duration', { duration: formatElapsed(durationMs) });
  return (
    <View style={styles.block}>
      {/* M25: a sentence, so the status face; Geist Mono carries numerals only. */}
      <Text variant="status">{summary}</Text>
      {reason === 'operator-stopped' ? (
        <Text variant="status">{t('stream.ended.scanAgain')}</Text>
      ) : null}
      <Button label={t('stream.ended.scanAnother')} onPress={onScanAnother} />
    </View>
  );
});

const styles = StyleSheet.create({ block: { gap: space.sm } });
