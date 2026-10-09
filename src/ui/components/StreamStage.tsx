import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { selectCharging, selectKeepOpen, selectShedding, topAdvisory } from '@/hooks/advisory';
import { selectPlaybackUrl } from '@/hooks/engineSelectors';
import type { LineTier } from '@/hooks/statusKey';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import type { Peek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import type { ScoringLinkView } from '@/hooks/useScoringLink';
import { useViewerFeed } from '@/hooks/useViewerFeed';
import { PreviewBoundary } from '@/ui/components/PreviewBoundary';
import { ScoringLinkPanel } from '@/ui/components/ScoringLinkPanel';
import { StageVideo } from '@/ui/components/StageVideo';
import { StatusStrip } from '@/ui/components/StatusStrip';
import { cameraBoxSize, stripReserve, type BoxSize } from '@/ui/theme/cameraBox';
import { colour, layout } from '@/ui/theme/tokens';

type StageProps = {
  /** The status line the strip says under the shot (the column's, once; `StreamScreen` makes it). */
  readonly line: string;
  /** Which tier that line is (`LINE_TIER`): an urgent line always wins the strip's one message line. */
  readonly lineTier: LineTier;
  readonly peek: Peek;
  /** The Remote scoring panel's state (spec §10), and the seconds it has left (B3). */
  readonly scoring: ScoringLinkView;
  readonly scoringSecondsLeft: number;
  readonly onHideScoring: () => void;
};

/**
 * The camera half (spec §1): the shot as a 16:9 box across the half, with the
 * status strip under it. Nothing is drawn over the shot but the viewers' video
 * (AGENTS §6, D17) and, for at most 10 s after a tap, the Remote
 * scoring panel (spec §10), which covers the whole half, strip included, and
 * brings the half's one button: its Hide. The match label and ONE message line (the
 * advisory caption when one is up, the status line otherwise) sit in the strip, below the shot.
 *
 * The strip keeps its content height and the box gives way (`cameraBoxSize`):
 * on a screen too short for a full-width box the box is narrower, centred, on
 * the half's surface colour. The half is what the controls half leaves (owner,
 * 2026-10-08: it is the width its content needs, so this half is the rest).
 *
 * The strip's height is sized from THIS match (owner, 2026-10-08, option A): the
 * match label as it was measured in the half's width (`StatusStrip` reports it),
 * plus fixed room for the padding, the round line, two gaps and ONE message line (`stripReserve`; owner,
 * 2026-10-08, "one single line all the time", the round line always shown: option B). So the picture is one
 * size for the whole match. It is sized
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
  const shed = useEngineSelector(selectShedding);
  const charging = useEngineSelector(selectCharging);
  const keepOpen = useEngineSelector(selectKeepOpen);
  const advisory = topAdvisory({ shed, charging, keepOpen });
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
      <CameraBox size={box} peek={props.peek} />
      <StatusStrip
        line={props.line}
        lineTier={props.lineTier}
        advisory={advisory}
        onLabelHeight={setLabelHeight}
      />
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
  readonly peek: Peek;
};

/**
 * The shot. Its own memo, so a status line that changes every second (the
 * hold's countdown) re-renders the strip beneath it and never the preview or
 * the viewers' video (M7, AGENTS §8). The viewers' video fills the box and
 * nothing else.
 */
const CameraBox = memo(function CameraBox({ size, peek }: CameraBoxProps) {
  const { surfaces } = usePorts();
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const viewers = useViewerFeed(peek.showing, peek.mounted);
  const sized = useSizedStyle(size);
  const { Preview } = surfaces;
  return (
    <View testID="camera-box" style={[styles.box, sized ?? styles.unmeasured]}>
      {/* CD19: the preview alone. */}
      <PreviewBoundary>
        <Preview />
      </PreviewBoundary>
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
