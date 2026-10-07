import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { selectCharging, selectKeepOpen, topAdvisory } from '@/hooks/advisory';
import { selectPlaybackUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import type { Peek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import { useStageOverlay } from '@/hooks/useStageOverlay';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { PreviewBoundary } from '@/ui/components/PreviewBoundary';
import { StageVideo } from '@/ui/components/StageVideo';
import { StatusStrip } from '@/ui/components/StatusStrip';
import { colour, layout } from '@/ui/theme/tokens';

type StageProps = {
  /** The status line the strip says under the shot (the column's, once; `StreamScreen` makes it). */
  readonly line: string;
  /** Framing a shot, before any broadcast. */
  readonly paired: boolean;
  readonly overlayOn: boolean;
  readonly peek: Peek;
};

/**
 * The camera half (spec §1): the shot as a 16:9 box across the half, with the
 * status strip under it. Nothing is drawn over the shot but the overlay preview
 * and the peek (AGENTS §6, D17); the match label, the status line and the one
 * advisory caption sit in the strip, below it. It keeps no buttons.
 */
export const StreamStage = memo(function StreamStage(props: StageProps) {
  const overlay = useStageOverlay(props.overlayOn);
  const charging = useEngineSelector(selectCharging);
  const keepOpen = useEngineSelector(selectKeepOpen);
  const advisory = topAdvisory({
    shed: overlay.shed,
    overlayFailed: overlay.failed,
    paired: props.paired,
    // Final review I-2: with no overlay URL there is no score preview to be
    // ahead of viewers or to fail, so the strip says nothing of one.
    overlayOn: props.overlayOn && overlay.url !== null,
    charging,
    keepOpen,
  });
  return (
    <View testID="camera-half" style={styles.half}>
      <CameraBox
        url={overlay.url}
        visible={overlay.visible}
        onFailed={overlay.onFailed}
        peek={props.peek}
      />
      <StatusStrip line={props.line} advisory={advisory} />
    </View>
  );
});

type CameraBoxProps = {
  readonly url: string | null;
  readonly visible: boolean;
  readonly onFailed: () => void;
  readonly peek: Peek;
};

/**
 * The shot. Its own memo, so a status line that changes every second (the
 * hold's countdown) re-renders the strip beneath it and never the preview, the
 * overlay or the peek (M7, AGENTS §8). The overlay and the peek's video fill
 * the box and nothing else.
 */
const CameraBox = memo(function CameraBox({ url, visible, onFailed, peek }: CameraBoxProps) {
  const { surfaces } = usePorts();
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const { Preview } = surfaces;
  return (
    <View testID="camera-box" style={styles.box}>
      {/* CD19: the preview alone; the overlay keeps its own boundary (AGENTS §7). */}
      <PreviewBoundary>
        <Preview />
      </PreviewBoundary>
      <OverlayPreview url={url} visible={visible} onFailed={onFailed} />
      {peek.mounted && playbackUrl !== null ? (
        <StageVideo url={playbackUrl} showing={peek.showing} />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  half: { flex: 1 },
  box: {
    width: '100%',
    aspectRatio: layout.previewAspect,
    backgroundColor: colour.stage,
    overflow: 'hidden',
  },
});
