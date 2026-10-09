import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LOADING_MS, SHOWING_MS, type ViewerCheck } from '@/domain/session/viewerCheck';
import { selectPlaybackUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import type { ViewerFeed } from '@/hooks/useViewerFeed';
import type { VideoStatus } from '@/services/surfaces';
import { StageVideo } from '@/ui/components/StageVideo';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

type Open = Exclude<ViewerCheck['kind'], 'idle'>;

type ViewerCoverProps = {
  readonly kind: Open;
  readonly feed: ViewerFeed;
  readonly onClose: () => void;
  readonly onFirstFrame: () => void;
};

/**
 * What viewers see, over the camera box only (D2 §4.3): the status strip stays visible, and Stop is never covered. A
 * tap anywhere on the box closes it, and so does its Hide, drawn in the corner as the Remote scoring panel draws its
 * own (spec §4.3). While loading and showing it carries the honest line, no scoreboard yet: there is no compositor,
 * so the viewers' picture has no score on it. Never blank: a line says what is happening whenever there is no picture.
 *
 * The box is not one accessible element. On Android a Pressable groups its children under one focus (react-native
 * Pressable: `accessible !== false`), and TalkBack would read none of the lines; here they are read on their own,
 * with Hide as a named button.
 */
export const ViewerCover = memo(function ViewerCover(props: ViewerCoverProps) {
  const { t } = useT();
  return (
    <Pressable
      testID="viewer-cover"
      accessible={false}
      onPress={props.onClose}
      style={styles.cover}
    >
      {props.kind === 'notReady' ? (
        <CentreLine text={t('stream.peek.notReady')} />
      ) : (
        <ViewerPicture kind={props.kind} feed={props.feed} onFirstFrame={props.onFirstFrame} />
      )}
      <CoverCorner showing={props.kind === 'showing'} onClose={props.onClose} />
    </Pressable>
  );
});

type PictureProps = {
  readonly kind: 'loading' | 'showing';
  readonly feed: ViewerFeed;
  readonly onFirstFrame: () => void;
};

/**
 * The player while the feed plays, the countdown over it until its first frame, and the honest line. Once showing, a
 * feed that has nothing to play says so; a feed of `none` is the air going, and the view closes in the next render, so
 * that one render draws no line (M53).
 */
const ViewerPicture = memo(function ViewerPicture({ kind, feed, onFirstFrame }: PictureProps) {
  const { t } = useT();
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const report = feed.onStatus;
  const onStatus = useCallback(
    (status: VideoStatus) => {
      report(status);
      if (status === 'ready') onFirstFrame();
    },
    [report, onFirstFrame],
  );
  const playing = feed.feed === 'playing' && playbackUrl !== null;
  const lost = kind === 'showing' && !playing && feed.feed !== 'none';
  return (
    <>
      {playing ? <StageVideo url={playbackUrl} attempt={feed.attempt} onStatus={onStatus} /> : null}
      {kind === 'loading' ? <Countdown total={LOADING_MS} line="stream.peek.loading" /> : null}
      {lost ? <CentreLine text={t('stream.peek.unavailable')} /> : null}
      <View style={styles.honest}>
        <Text variant="metricUnit" numberOfLines={1} style={styles.ink}>
          {t('stream.peek.honest')}
        </Text>
      </View>
    </>
  );
});

type CornerProps = { readonly showing: boolean; readonly onClose: () => void };

/**
 * The bottom-right row, in every phase: the closing countdown while showing, then Hide. The scoring panel's word, as
 * its row ends (B3 review m4); viewerCoverFit.test.ts fits the row at 640 × 360 and 804 × 332.
 */
const CoverCorner = memo(function CoverCorner({ showing, onClose }: CornerProps) {
  const { t } = useT();
  return (
    <View style={styles.corner}>
      {showing ? <Countdown total={SHOWING_MS} line="stream.peek.closesIn" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stream.scoring.hide')}
        onPress={onClose}
        style={styles.hide}
      >
        <Text variant="control">{t('stream.scoring.hide')}</Text>
      </Pressable>
    </View>
  );
});

type CountdownProps = {
  readonly total: number;
  readonly line: 'stream.peek.loading' | 'stream.peek.closesIn';
};

/** Whole seconds down from the phase's length, one tick a second. Its own state, so only it re-renders (AGENTS §8). */
const Countdown = memo(function Countdown({ total, line }: CountdownProps) {
  const { t } = useT();
  const seconds = useSecondsLeft(total / 1000);
  const text = t(line, { seconds });
  return line === 'stream.peek.loading' ? (
    <CentreLine text={text} />
  ) : (
    <View style={styles.closesIn}>
      <Text variant="metricUnit" style={styles.count}>
        {text}
      </Text>
    </View>
  );
});

/** Never shows 0: the hook's timer closes the phase as the last second ends. */
function useSecondsLeft(from: number): number {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    const tick = setInterval(() => setLeft((was) => Math.max(1, was - 1)), 1000);
    return () => clearInterval(tick);
  }, []);
  return left;
}

/**
 * The line in the middle of the box, on the ground: the countdown, no picture, or not ready. Tabular figures, so the
 * countdown's digit does not twitch as it changes (AGENTS §5).
 */
const CentreLine = memo(function CentreLine({ text }: { readonly text: string }) {
  return (
    <View testID="viewer-note" style={styles.centre}>
      <Text variant="body" style={styles.line}>
        {text}
      </Text>
    </View>
  );
});

// RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone.
const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, backgroundColor: colour.stage },
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.md,
    backgroundColor: colour.ground,
  },
  line: { textAlign: 'center', fontVariant: ['tabular-nums'] },
  honest: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colour.ground,
  },
  ink: { color: colour.ink },
  // The row is `space.sm` in from the box's edges, its two plates `space.sm` apart (viewerCoverFit.test.ts).
  corner: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  closesIn: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colour.ground,
  },
  count: { color: colour.ink, fontVariant: ['tabular-nums'] },
  // The scoring panel's Hide, on the night: a 48 dp target with the hairline rule, on the ground so it reads over video.
  hide: {
    minHeight: layout.iconButton,
    minWidth: layout.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    backgroundColor: colour.ground,
  },
});
