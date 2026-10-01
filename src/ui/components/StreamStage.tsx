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
  /** N3: replacing another code's session, so nothing of it is shown: no label, no overlay. */
  readonly replacing: boolean;
  readonly overlayOn: boolean;
  readonly peek: Peek;
  readonly canLeave: boolean;
  readonly onHome: () => void;
  readonly onSettings: () => void;
  readonly onDiagnostics: () => void;
};

/**
 * The shot, full-bleed. Nothing is drawn over it but the overlay preview, the
 * peek, and the two solid edge strips (AGENTS §6, D17): the top one carries
 * one caption at a time, the bottom one the match label, Settings and
 * Diagnostics, and the way out.
 */
export const StreamStage = memo(function StreamStage(props: StageProps) {
  const { surfaces } = usePorts();
  const overlayOn = props.overlayOn && !props.replacing;
  const overlay = useStageOverlay(overlayOn);
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
        overlayOn={overlayOn}
      />
      <BottomStrip
        labelled={!props.replacing}
        canLeave={props.canLeave}
        onHome={props.onHome}
        onSettings={props.onSettings}
        onDiagnostics={props.onDiagnostics}
      />
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

type BottomStripProps = {
  /** False while replacing (N3): the label native holds is the old session's. */
  readonly labelled: boolean;
  readonly canLeave: boolean;
  readonly onHome: () => void;
  readonly onSettings: () => void;
  readonly onDiagnostics: () => void;
};

/**
 * The match label (D29); Settings and Diagnostics in every state, live
 * included (AGENTS §6); and Home whenever leaving is allowed (never on air).
 */
const BottomStrip = memo(function BottomStrip({
  labelled,
  canLeave,
  onHome,
  onSettings,
  onDiagnostics,
}: BottomStripProps) {
  const { t } = useT();
  const label = useEngineSelector(selectLabel);
  return (
    <EdgeStrip edge="bottom">
      <Text variant="metricUnit" numberOfLines={1} style={styles.label}>
        {labelled ? (label ?? '') : ''}
      </Text>
      <GhostButton label={t('stream.link.settings')} onPress={onSettings} />
      <GhostButton label={t('stream.link.diagnostics')} onPress={onDiagnostics} />
      {canLeave ? <GhostButton label={t('stream.home')} onPress={onHome} /> : null}
    </EdgeStrip>
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colour.stage },
  label: { flex: 1 },
});
