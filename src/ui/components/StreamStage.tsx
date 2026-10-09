import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  selectCharging,
  selectKeepOpen,
  selectPublishing,
  selectShedding,
  topAdvisory,
} from '@/hooks/advisory';
import type { LineTier } from '@/hooks/statusKey';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { ScoringLinkView } from '@/hooks/useScoringLink';
import type { ViewerCheckView } from '@/hooks/useViewerCheck';
import { useViewerFeed } from '@/hooks/useViewerFeed';
import { PreviewBoundary } from '@/ui/components/PreviewBoundary';
import { ScoringLinkPanel } from '@/ui/components/ScoringLinkPanel';
import { StatusStrip } from '@/ui/components/StatusStrip';
import { ViewerCover } from '@/ui/components/ViewerCover';
import { cameraBoxSize, stripReserve, type BoxSize } from '@/ui/theme/cameraBox';
import { colour, layout } from '@/ui/theme/tokens';

type StageProps = {
  /** The status line the strip says under the shot (the column's, once; `StreamScreen` makes it). */
  readonly line: string;
  /** Which tier that line is (`LINE_TIER`): an urgent line always wins the strip's one message line. */
  readonly lineTier: LineTier;
  /**
   * What viewers see (D2 §4.3): open over the camera box, or idle. Null when it is hidden (`FEATURES.viewerCheck`, the
   * owner's ruling of 2026-10-09): then neither its feed nor its cover mounts, and the heat caption does not name it.
   */
  readonly viewer: ViewerCheckView | null;
  /** The Remote scoring panel's state (spec §10), and the seconds it has left (B3). */
  readonly scoring: ScoringLinkView;
  readonly scoringSecondsLeft: number;
  readonly onHideScoring: () => void;
};

/**
 * The camera half (spec §1): the shot as a 16:9 box across the half, with the
 * status strip under it. Nothing is drawn over the shot but What viewers see when it is built in (the
 * camera box only; AGENTS §6, D17) and, for at most 10 s after a tap, the Remote
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
  const live = useEngineSelector(selectPublishing);
  const advisory = topAdvisory({
    shed,
    charging,
    keepOpen,
    live,
    viewerCheck: props.viewer !== null,
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
      <CameraBox size={box} viewer={props.viewer} />
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
  /** Null with What viewers see hidden: the box is the preview alone. */
  readonly viewer: ViewerCheckView | null;
};

/**
 * The shot. Its own memo, so a status line that changes every second re-renders the strip beneath it and never the
 * preview or the viewers' video (M7, AGENTS §8).
 */
const CameraBox = memo(function CameraBox({ size, viewer }: CameraBoxProps) {
  const { surfaces } = usePorts();
  const sized = useSizedStyle(size);
  const { Preview } = surfaces;
  return (
    <View testID="camera-box" style={[styles.box, sized ?? styles.unmeasured]}>
      {/* CD19: the preview alone, in its own boundary. */}
      <PreviewBoundary>
        <Preview />
      </PreviewBoundary>
      {viewer === null ? null : <ViewerLayer viewer={viewer} />}
    </View>
  );
});

/**
 * What viewers see over the box, mounted with the box whenever the view is built in. The viewers' feed is read here
 * for the whole broadcast, so its first window is timed from the start of live, whether or not the view is open. Its
 * player exists only while the view loads or shows: the not-ready line draws none, so a retry that falls due on it is
 * parked, not spent on a player nobody can see (B3 review I1).
 */
const ViewerLayer = memo(function ViewerLayer({ viewer }: { readonly viewer: ViewerCheckView }) {
  const open = viewer.kind !== 'idle';
  const holding = viewer.kind === 'loading' || viewer.kind === 'showing';
  const viewers = useViewerFeed(open, holding);
  if (viewer.kind === 'idle') return null;
  return (
    <ViewerCover
      kind={viewer.kind}
      feed={viewers}
      onClose={viewer.close}
      onFirstFrame={viewer.firstFrame}
    />
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
