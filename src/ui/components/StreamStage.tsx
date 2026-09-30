import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ADVISORY_KEY, selectCharging, topAdvisory } from '@/hooks/advisory';
import { selectLabel, selectPlaybackUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import type { Peek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import { useStageOverlay } from '@/hooks/useStageOverlay';
import { EdgeStrip } from '@/ui/components/EdgeStrip';
import { GhostButton } from '@/ui/components/GhostButton';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { StageVideo } from '@/ui/components/StageVideo';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';

type StageProps = {
  readonly armed: boolean;
  readonly overlayOn: boolean;
  readonly peek: Peek;
  readonly canLeave: boolean;
  readonly onHome: () => void;
};

/**
 * The shot, full-bleed. Nothing is drawn over it but the overlay preview, the
 * peek, and the two solid edge strips (AGENTS §6, D17): the top one carries
 * one caption at a time, the bottom one the match label and the way out.
 */
export const StreamStage = memo(function StreamStage(props: StageProps) {
  const { surfaces } = usePorts();
  const overlay = useStageOverlay(props.overlayOn);
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const { Preview } = surfaces;
  return (
    <View style={styles.stage}>
      <Preview />
      <OverlayPreview url={overlay.url} visible={overlay.visible} onFailed={overlay.onFailed} />
      {props.peek.mounted && playbackUrl !== null ? (
        <StageVideo url={playbackUrl} showing={props.peek.showing} />
      ) : null}
      <TopStrip
        shed={overlay.shed}
        overlayFailed={overlay.failed}
        armed={props.armed}
        overlayOn={props.overlayOn}
      />
      <BottomStrip canLeave={props.canLeave} onHome={props.onHome} />
    </View>
  );
});

type TopStripProps = {
  readonly shed: boolean;
  readonly overlayFailed: boolean;
  readonly armed: boolean;
  readonly overlayOn: boolean;
};

/** One caption at a time, most important first (`topAdvisory`); none, no strip. */
const TopStrip = memo(function TopStrip(props: TopStripProps) {
  const { t } = useT();
  const charging = useEngineSelector(selectCharging);
  const advisory = topAdvisory({ ...props, charging });
  if (advisory === null) return null;
  return (
    <EdgeStrip edge="top">
      <Text variant="status">{t(ADVISORY_KEY[advisory])}</Text>
    </EdgeStrip>
  );
});

/** The match label (D29), and Home whenever leaving is allowed (never on air). */
const BottomStrip = memo(function BottomStrip({
  canLeave,
  onHome,
}: {
  canLeave: boolean;
  onHome: () => void;
}) {
  const { t } = useT();
  const label = useEngineSelector(selectLabel);
  return (
    <EdgeStrip edge="bottom">
      <Text variant="metricUnit" numberOfLines={1} style={styles.label}>
        {label ?? ''}
      </Text>
      {canLeave ? <GhostButton label={t('stream.home')} onPress={onHome} /> : null}
    </EdgeStrip>
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colour.stage },
  label: { flex: 1 },
});
