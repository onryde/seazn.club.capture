import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * Development builds only (spec §8): drive the fake engine through armed,
 * live, stopped and failed, to exercise the shell's stream rules before S1
 * brings the real engine. `devEngine` is null in release builds.
 */
export const DevEngineControls = memo(function DevEngineControls() {
  const { t } = useT();
  const { devEngine, devTools, clock } = usePorts();
  const status = useEngineSelector(selectEngineStatus);
  const arm = useCallback(() => devEngine?.forceState({ kind: 'armed' }), [devEngine]);
  const live = useCallback(
    () =>
      devEngine?.forceState({
        kind: 'publishing',
        transport: 'srt',
        sinceEpochMs: clock().getTime(),
      }),
    [devEngine, clock],
  );
  const stop = useCallback(
    () => devEngine?.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: null }),
    [devEngine],
  );
  const fail = useCallback(
    () => devEngine?.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }),
    [devEngine],
  );
  if (!devTools || devEngine === null) return null;
  return (
    <View style={styles.panel}>
      <Text variant="metricUnit">{t('stream.dev.title')}</Text>
      <Text variant="control">{t('stream.dev.state', { state: status })}</Text>
      <View style={styles.row}>
        <GhostButton label={t('stream.dev.arm')} onPress={arm} />
        <GhostButton label={t('stream.dev.live')} onPress={live} />
        <GhostButton label={t('stream.dev.stop')} onPress={stop} />
        <GhostButton label={t('stream.dev.fail')} onPress={fail} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
