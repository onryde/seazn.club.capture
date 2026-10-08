import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { selectCharging, selectKeepOpen, topAdvisory } from '@/hooks/advisory';
import { selectPlaybackUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import type { Peek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import { useStageOverlay } from '@/hooks/useStageOverlay';
import type { ScoringLinkView } from '@/hooks/useScoringLink';
import { useViewerFeed } from '@/hooks/useViewerFeed';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { PreviewBoundary } from '@/ui/components/PreviewBoundary';
import { ScoringLinkPanel } from '@/ui/components/ScoringLinkPanel';
import { StageVideo } from '@/ui/components/StageVideo';
import { StatusStrip } from '@/ui/components/StatusStrip';
import { cameraBoxSize, stripReserve, type BoxSize } from '@/ui/theme/cameraBox';
import { colour, layout } from '@/ui/theme/tokens';

type StageProps = {
  /** The status line the strip says under the shot (the column's, once; `StreamScreen` makes it). */
  readonly line: string;
  /** Framing a shot, before any broadcast. */
  readonly paired: boolean;
  readonly overlayOn: boolean;
  readonly peek: Peek;
  /** The Remote scoring panel's state (spec §10), and the seconds it has left (B3). */
  readonly scoring: ScoringLinkView;
  readonly scoringSecondsLeft: number;
  readonly onHideScoring: () => void;
};

/**
 * The camera half (spec §1): the shot as a 16:9 box across the half, with the
 * status strip under it. Nothing is drawn over the shot but the overlay preview
 * and the peek (AGENTS §6, D17) and, for at most 10 s after a tap, the Remote
 * scoring panel (spec §10), which covers the whole half, strip included, and
 * brings the half's one button: its Hide. The match label, the status line and
 * the one advisory caption sit in the strip, below the shot.
 *
 * The strip keeps its content height and the box gives way (`cameraBoxSize`):
 * on a screen too short for a full-width box the box is narrower, centred, on
 * the half's surface colour. The half is what the controls half leaves (owner,
 * 2026-10-08: it is the width its content needs, so this half is the rest).
 *
 * The strip's height is sized from THIS match (owner, 2026-10-08, option A): the
 * match label as it was measured in the half's width (`StatusStrip` reports it),
 * plus fixed room for the status line, the caption and the padding and gaps
 * (`stripReserve`). So the picture is one size for the whole match. It is sized
 * again when the label's text changes (a new match remounts the label, which is
 * measured again) or when the label wraps differently in the half (its measured
 * height moves), and when the half's width or height changes; for nothing else:
 * a status line, a caption or the round line coming and going changes none of
 * `half` or `labelHeight`. Before the label is measured (0) the reserve is the
 * worst case, so the strip is never short. The half reports its size once laid
 * out; until then the box is the full-width 16:9 one, for the frame before the
 * first layout.
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
  const [half, setHalf] = useState<BoxSize | null>(null);
  // The match label's measured height, 0 until it has been (and while it is going): `stripReserve` reads 0 as the worst case.
  const [labelHeight, setLabelHeight] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // A layout of nothing is not a measurement: keep what was there.
    if (width <= 0 || height <= 0) return;
    setHalf((was) => (was?.width === width && was.height === height ? was : { width, height }));
  }, []);
  const box = useMemo(
    () =>
      half === null
        ? null
        : cameraBoxSize({
            halfWidth: half.width,
            height: half.height,
            stripContent: stripReserve(labelHeight),
            aspect: layout.previewAspect,
          }),
    [half, labelHeight],
  );
  return (
    <View testID="camera-half" style={styles.half} onLayout={onLayout}>
      <CameraBox
        size={box}
        url={overlay.url}
        visible={overlay.visible}
        onFailed={overlay.onFailed}
        peek={props.peek}
      />
      <StatusStrip line={props.line} advisory={advisory} onLabelHeight={setLabelHeight} />
      {/* Last, so it paints over the box and the strip (Q-C2). */}
      <ScoringLinkPanel
        view={props.scoring}
        secondsLeft={props.scoringSecondsLeft}
        onHide={props.onHideScoring}
      />
    </View>
  );
});

type CameraBoxProps = {
  /** Null until the half is measured. */
  readonly size: BoxSize | null;
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
const CameraBox = memo(function CameraBox({ size, url, visible, onFailed, peek }: CameraBoxProps) {
  const { surfaces } = usePorts();
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const viewers = useViewerFeed(peek.showing, peek.mounted);
  const sized = useSizedStyle(size);
  const { Preview } = surfaces;
  return (
    <View testID="camera-box" style={[styles.box, sized ?? styles.unmeasured]}>
      {/* CD19: the preview alone; the overlay keeps its own boundary (AGENTS §7). */}
      <PreviewBoundary>
        <Preview />
      </PreviewBoundary>
      <OverlayPreview url={url} visible={visible} onFailed={onFailed} />
      {peek.mounted && playbackUrl !== null && viewers.feed !== 'none' ? (
        <StageVideo
          url={playbackUrl}
          showing={peek.showing}
          feed={viewers.feed}
          attempt={viewers.attempt}
          starting={viewers.starting}
          onStatus={viewers.onStatus}
        />
      ) : null}
    </View>
  );
});

/** The measured size as a stylesheet, made once per size: a style object is never written inline. */
function useSizedStyle(size: BoxSize | null) {
  return useMemo(
    () =>
      size === null
        ? null
        : StyleSheet.create({ sized: { width: size.width, height: size.height } }).sized,
    [size],
  );
}

const styles = StyleSheet.create({
  // The surface either side of a box narrower than the half.
  half: { flex: 1, backgroundColor: colour.surface },
  box: { alignSelf: 'center', backgroundColor: colour.stage, overflow: 'hidden' },
  unmeasured: { width: '100%', aspectRatio: layout.previewAspect },
});
