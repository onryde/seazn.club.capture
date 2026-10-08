import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Feed } from '@/domain/session/viewerFeed';
import { peekPlaybackUrl } from '@/domain/session/previewUrls';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import type { VideoStatus } from '@/services/surfaces';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type StageVideoProps = {
  /** The descriptor's playback URL; the peek's bandwidth hint is added here. It goes to the player only. */
  readonly url: string;
  readonly showing: boolean;
  /** Never `none`: the stage does not mount the layer then. */
  readonly feed: Exclude<Feed, 'none'>;
  /** The player's remount key: a retry is a fresh player. */
  readonly attempt: number;
  /** Playing, but no picture yet: the layer still says so. */
  readonly starting: boolean;
  readonly onStatus: (status: VideoStatus) => void;
};

const NOTE = {
  waiting: 'stream.peek.loading',
  unavailable: 'stream.peek.unavailable',
} as const;

/**
 * The delivered picture over the stage while the peek is held; invisible but
 * still loaded while it cools, so a second peek is instant. Muted, fetched
 * live, never cached (D37) — the Video surface owns all three. It never takes
 * a touch: the finger holding the peek stays on the control.
 *
 * It says what it is doing (spec §9): a player only exists while the feed is
 * `playing` (D6), and until that player has shown a picture, or when there is
 * none to show, a line says so. The layer is never blank.
 */
export const StageVideo = memo(function StageVideo(props: StageVideoProps) {
  const { surfaces } = usePorts();
  const { t } = useT();
  const { Video } = surfaces;
  const playing = props.feed === 'playing';
  const key = playing ? (props.starting ? NOTE.waiting : null) : NOTE[props.feed];
  return (
    <View
      pointerEvents="none"
      style={props.showing ? styles.shown : styles.hidden}
      aria-hidden={!props.showing}
    >
      {playing ? (
        <Video
          key={props.attempt}
          url={peekPlaybackUrl(props.url)}
          playing={props.showing}
          onStatus={props.onStatus}
        />
      ) : null}
      {key === null ? null : (
        <View testID="viewer-note" style={styles.note}>
          <Text variant="body">{t(key)}</Text>
        </View>
      )}
    </View>
  );
});

// RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone.
const styles = StyleSheet.create({
  shown: { ...StyleSheet.absoluteFill },
  hidden: { ...StyleSheet.absoluteFill, opacity: 0 },
  // Over the player while it loads, and alone when there is none: the stage's own ground, so a line, never a blank.
  note: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.ground,
    padding: space.sm,
  },
});
